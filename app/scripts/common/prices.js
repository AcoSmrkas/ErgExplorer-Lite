// Prices in USD, all read from the selected node:
// - ERG from the ERG/USD oracle pool box (LiteNode.ergUsd)
// - tokens from Spectrum AMM pool boxes, the same way api.ergexplorer.com's price feed builds them:
//   N2T (ERG/token) pools price a token directly, from its deepest pool; T2T (token/token) pools
//   price the other side once one side has a price. Liquidity = 2 x the ERG side, summed over pools.
// Same globals as before (prices by token id, pricesNames by ticker), so pages keep calling
// getPrices(callback). An unpriced token simply has no entry.

var prices = {};
var pricesNames = {};
var gotPrices = false;
var callbackCalled = false;
var theCallback;

const CACHE_KEY = 'litePriceCache';
const FORCE_CACHE_KEY = 'litePriceCacheFull';
const CACHE_TIME = 5 * 60 * 1000;
const MIN_LIQUIDITY_ERG = 2000;
const POOL_PAGE = 100;
const T2T_ROUNDS = 3;

const SPECTRUM_N2T_ADDRESS = '5vSUZRZbdVbnk4sJWjg2uhL94VZWRg4iatK9VgMChufzUgdihgvhR8yWSUEJKszzV7Vmi6K8hCyKTNhUaiP8p5ko6YEU9yfHpjVuXdQ4i5p4cRCzch6ZiqWrNukYjv7Vs5jvBwqg5hcEJ8u1eerr537YLWUoxxi1M4vQxuaCihzPKMt8NDXP4WcbN6mfNxxLZeGBvsHVvVmina5THaECosCWozKJFBnscjhpr3AJsdaL8evXAvPfEjGhVMoTKXAb2ZGGRmR8g1eZshaHmgTg2imSiaoXU5eiF3HvBnDuawaCtt674ikZ3oZdekqswcVPGMwqqUKVsGY4QuFeQoGwRkMqEYTdV2UDMMsfrjrBYQYKUBFMwsQGMNBL1VoY78aotXzdeqJCBVKbQdD3ZZWvukhSe4xrz8tcF3PoxpysDLt89boMqZJtGEHTV9UBTBEac6sDyQP693qT3nKaErN8TCXrJBUmHPqKozAg9bwxTqMYkpmb9iVKLSoJxG7MjAj72SRbcqQfNCVTztSwN3cRxSrVtz4p87jNFbVtFzhPg7UqDwNFTaasySCqM';
const SPECTRUM_T2T_ADDRESS = '3gb1RZucekcRdda82TSNS4FZSREhGLoi1FxGDmMZdVeLtYYixPRviEdYireoM9RqC6Jf4kx85Y1jmUg5XzGgqdjpkhHm7kJZdgUR3VBwuLZuyHVqdSNv3eanqpknYsXtUwvUA16HFwNa3HgVRAnGC8zj8U7kksrfjycAM1yb19BB4TYR2BKWN7mpvoeoTuAKcAFH26cM46CEYsDRDn832wVNTLAmzz4Q6FqE29H9euwYzKiebgxQbWUxtupvfSbKaHpQcZAo5Dhyc6PFPyGVFZVRGZZ4Kftgi1NMRnGwKG7NTtXsFMsJP6A7yvLy8UZaMPe69BUAkpbSJdcWem3WpPUE7UpXv4itDkS5KVVaFtVyfx8PQxzi2eotP2uXtfairHuKinbpSFTSFKW3GxmXaw7vQs1JuVd8NhNShX6hxSqCP6sxojrqBxA48T2KcxNrmE3uFk7Pt4vPPdMAS4PW6UU82UD9rfhe3SMytK6DkjCocuRwuNqFoy4k25TXbGauTNgKuPKY3CxgkTpw9WfWsmtei178tLefhUEGJueueXSZo7negPYtmcYpoMhCuv4G1JZc283Q7f3mNXS';

// Every token priced, with liquidity in ERG; filled by getPrices
var tokenPriceList = [];

function readPriceCache(key) {
	try {
		const cache = JSON.parse(localStorage.getItem(key));
		return cache && cache.node === LiteNode.getUrl() ? cache : null;
	} catch (e) {
		return null;
	}
}

function applyPriceCache(cache) {
	prices = {};
	pricesNames = {};

	for (let i = 0; i < cache.keys.length; i++) {
		prices[cache.keys[i]] = cache.values[i];
	}

	for (let i = 0; i < cache.names.length; i++) {
		pricesNames[cache.names[i]] = cache.nameValues[i];
	}

	tokenPriceList = cache.list || [];
	gotPrices = true;
}

function getPrices(callback, force = false) {
	theCallback = callback;
	callbackCalled = false;

	const cache = readPriceCache(force ? FORCE_CACHE_KEY : CACHE_KEY);

	if (cache && Date.now() - cache.timestamp < CACHE_TIME) {
		applyPriceCache(cache);
		doCallback();
		return;
	}

	buildPrices(force).then(doCallback, function(e) {
		console.warn('Prices from the node failed', e);

		if (cache) {
			applyPriceCache(cache);
		}

		doCallback();
	});
}

async function fetchPoolBoxes(address) {
	const boxes = [];

	for (let offset = 0; ; offset += POOL_PAGE) {
		const page = await LiteNode.get('blockchain/box/unspent/byAddress/' + address + '?offset=' + offset + '&limit=' + POOL_PAGE);
		boxes.push(...(page || []));

		if (!page || page.length < POOL_PAGE) {
			return boxes;
		}
	}
}

async function buildPrices(force) {
	const ergUsdPromise = LiteNode.ergUsd();
	const [n2t, t2t] = networkType == 'testnet'
		? [[], []]
		: await Promise.all([fetchPoolBoxes(SPECTRUM_N2T_ADDRESS), fetchPoolBoxes(SPECTRUM_T2T_ADDRESS)]);
	const ergUsd = await ergUsdPromise;

	await LiteNode.withTokens([...n2t, ...t2t]);

	const tokens = {};
	const init = asset => tokens[asset.tokenId] || (tokens[asset.tokenId] = {
		id: asset.tokenId, ticker: asset.name, decimals: asset.decimals,
		ergSum: 0, bestErg: 0, priceErg: null, pools: 0, source: null
	});

	for (const box of n2t) {
		if (!box.assets || box.assets.length < 3) continue;

		const asset = box.assets[2];
		const ergReserve = Number(box.value);
		const reserve = Number(asset.amount);
		if (!(ergReserve > 0 && reserve > 0)) continue;

		const priceErg = (ergReserve / 1e9) / (reserve / Math.pow(10, asset.decimals || 0));
		if (!isFinite(priceErg) || priceErg <= 0) continue;

		const token = init(asset);
		token.ergSum += ergReserve;
		token.pools++;

		// Only the deepest pool sets the price: dust pools are often far off
		if (ergReserve > token.bestErg) {
			token.bestErg = ergReserve;
			token.priceErg = priceErg;
			token.source = 'n2t';
		}
	}

	const deriveT2t = (known, target) => {
		const knownToken = tokens[known.tokenId];
		if (!knownToken || knownToken.priceErg == null) return false;
		if (tokens[target.tokenId] && tokens[target.tokenId].source == 'n2t') return false;

		const knownAmount = Number(known.amount) / Math.pow(10, known.decimals || 0);
		const targetAmount = Number(target.amount) / Math.pow(10, target.decimals || 0);
		if (!(knownAmount > 0 && targetAmount > 0)) return false;

		const knownSideErg = knownAmount * knownToken.priceErg;
		const priceErg = knownSideErg / targetAmount;
		const poolErg = knownSideErg * 1e9;
		if (!isFinite(priceErg) || priceErg <= 0) return false;

		const token = init(target);
		if (poolErg <= token.bestErg) return false;

		const isNew = token.priceErg == null;
		token.bestErg = poolErg;
		token.priceErg = priceErg;
		token.source = 't2t';

		if (isNew) {
			token.ergSum += poolErg;
			token.pools++;
		}

		return isNew;
	};

	for (let round = 0; round < T2T_ROUNDS; round++) {
		let changed = false;

		for (const box of t2t) {
			if (!box.assets || box.assets.length < 4) continue;
			if (deriveT2t(box.assets[2], box.assets[3])) changed = true;
			if (deriveT2t(box.assets[3], box.assets[2])) changed = true;
		}

		if (!changed) break;
	}

	const list = Object.values(tokens)
		.filter(token => token.priceErg > 0)
		.map(token => ({ id: token.id, ticker: token.ticker, decimals: token.decimals, price_erg: token.priceErg, liquidity_erg: 2 * token.ergSum / 1e9, pools: token.pools }))
		.sort((a, b) => b.liquidity_erg - a.liquidity_erg);

	prices = {};
	pricesNames = {};

	if (ergUsd > 0) {
		prices['ERG'] = ergUsd;
		pricesNames['ERG'] = ergUsd;

		for (const token of list) {
			if (token.liquidity_erg < MIN_LIQUIDITY_ERG && !force) continue;

			prices[token.id] = ergUsd * token.price_erg;

			if (token.ticker && pricesNames[token.ticker] === undefined) {
				pricesNames[token.ticker] = prices[token.id];
			}
		}
	}

	tokenPriceList = list;
	gotPrices = true;

	try {
		localStorage.setItem(force ? FORCE_CACHE_KEY : CACHE_KEY, JSON.stringify({
			node: LiteNode.getUrl(),
			keys: Object.keys(prices),
			values: Object.values(prices),
			names: Object.keys(pricesNames),
			nameValues: Object.values(pricesNames),
			list: list.slice(0, 300),
			timestamp: Date.now()
		}));
	} catch (e) {}
}

function doCallback() {
	if (callbackCalled || !theCallback) return;
	callbackCalled = true;
	theCallback();
}
