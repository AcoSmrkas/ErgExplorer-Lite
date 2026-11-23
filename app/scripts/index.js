// Homepage, read from the selected node: height and protocol info from /info and /emission,
// ERG price from the oracle pool box, top tokens from the DEX pool boxes (prices.js), the 24h stats
// from the last day's block headers, and the big transfers from the newest blocks.

const DAY_MS = 24 * 60 * 60 * 1000;
const DAY_BLOCKS = 720;
const MAX_SUPPLY_NANOERG = '97739924000000000';
const REFRESH_MS = 5 * 60 * 1000;
const TOP_TOKENS = 10;
// Big transfers: the largest ERG moves in this many newest blocks, read this many blocks a request
const SCAN_BLOCKS = 30;
const SCAN_BATCH = 10;
const BIG_TXS_SHOWN = 10;
const ORACLE_BOX_PAGE = 100;

// The token tables wait for the icon list: drawn before it, their icons stay blank
var tokenIconsLoaded;
// Full blocks already read, by header id: a refresh reads only the new ones
const scannedBlocks = new Map();
let newestTxCount = null;

$(function() {
	if (!LiteNode.getUrl()) return;

	tokenIconsLoaded = new Promise(resolve => getTokenIcons(resolve));
	refresh();
});

function refresh() {
	getPrices(onGotPrices);
	getNetworkInfo();
	getDayStats();
	getBigTransfers();

	setTimeout(refresh, REFRESH_MS);
}

function onGotPrices() {
	showErgPrice();
	showTopTokens();
	showMarketCap();
}

function decimalString(value) {
	return value == null ? '0' : value.toString();
}

function ergNumber(nanoErg) {
	return Number(new BigNumber(decimalString(nanoErg)).dividedBy(1e9).toString());
}

/* Height, version, supply */

let circulatingNanoErg = null;

async function getNetworkInfo() {
	try {
		const info = await LiteNode.get('info');
		const height = Number(info.fullHeight);

		setCountUpHtml('#blockHeight', height.toLocaleString('en-US'));
		$('#ergVersion').removeClass('skeleton').text(String(info.appVersion || '').split('-')[0]).addClass('count-up-in');

		const emission = await LiteNode.emissionAt(height);
		circulatingNanoErg = decimalString(emission.totalCoinsIssued);

		setCountUpHtml('#ergSupply', formatErgValueString(circulatingNanoErg, 0, true, true));
		setCountUpHtml('#ergTotal', formatErgValueString(MAX_SUPPLY_NANOERG, 0, true, true));
		showMarketCap();
	} catch (e) {
		console.warn('Network info failed', e);
	}
}

function showMarketCap() {
	if (circulatingNanoErg == null || !(prices['ERG'] > 0)) return;

	setCountUpHtml('#marketCap', '$' + (prices['ERG'] * ergNumber(circulatingNanoErg)).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }));
}

/* ERG price and its 24h change, both from the ERG/USD oracle pool */

async function showErgPrice() {
	const price = prices['ERG'];

	if (!(price > 0)) {
		$('#ergPrice').removeClass('skeleton').html('<span class="text-light">&mdash;</span>');
		return;
	}

	const priceHtml = '$' + formatValue(price, 2);
	setCountUpHtml('#ergPrice', priceHtml);

	try {
		const dayAgo = await oracleRateDayAgo();
		if (!(dayAgo > 0)) return;

		const difference = (price / dayAgo - 1) * 100;
		const classString = difference < 0 ? 'text-danger' : 'text-success';
		setCountUpHtml('#ergPrice', priceHtml + ' (<span class="' + classString + '">' + formatValue(difference, 2) + '%</span> 24h)');
	} catch (e) {
		console.warn('No 24h ERG price', e);
	}
}

function oracleBoxRate(box) {
	const r4 = box && box.additionalRegisters && box.additionalRegisters.R4;
	const serialized = typeof r4 === 'string' ? r4 : (r4 && r4.serializedValue);
	const nanoErgPerUsd = Number(qfleetSDK.SConstant.from(serialized).data);

	return nanoErgPerUsd > 0 ? 1e9 / nanoErgPerUsd : undefined;
}

function oracleBoxPage(offset) {
	return LiteNode.get('blockchain/box/byTokenId/' + ERG_USD_ORACLE_POOL_NFT + '?offset=' + Math.max(0, Math.round(offset)) + '&limit=' + ORACLE_BOX_PAGE)
		.then(page => (page && page.items) || []);
}

// The pool box's history is newest first, a few rows a block: one page shows how many, which says
// where the box of a day ago sits. Up to three pages.
let dayAgoRatePromise = null;

function oracleRateDayAgo() {
	if (!dayAgoRatePromise) {
		dayAgoRatePromise = findOracleRateDayAgo().catch(e => {
			dayAgoRatePromise = null;
			throw e;
		});
	}

	return dayAgoRatePromise;
}

async function findOracleRateDayAgo() {
	let page = await oracleBoxPage(0);
	if (page.length < 2) return undefined;

	const target = Number(page[0].inclusionHeight) - DAY_BLOCKS;
	const rowsPerBlock = (page.length - 1) / Math.max(1, Number(page[0].inclusionHeight) - Number(page[page.length - 1].inclusionHeight));
	let pageOffset = 0;

	for (let attempt = 0; attempt < 3; attempt++) {
		const heights = page.map(box => Number(box.inclusionHeight));
		const newest = heights[0];
		const oldest = heights[heights.length - 1];

		if (target <= newest && target >= oldest) {
			return oracleBoxRate(page.find(box => Number(box.inclusionHeight) <= target));
		}

		pageOffset = target > newest
			? pageOffset - (target - newest) * rowsPerBlock - ORACLE_BOX_PAGE / 2
			: pageOffset + (newest - target) * rowsPerBlock - ORACLE_BOX_PAGE / 2;
		pageOffset = Math.max(0, pageOffset);
		page = await oracleBoxPage(pageOffset);

		if (page.length == 0) return undefined;
	}

	return undefined;
}

/* Top tokens by DEX liquidity */

function showTopTokens() {
	tokenIconsLoaded.then(() => {
		const ergUsd = prices['ERG'];
		const top = tokenPriceList.slice(0, TOP_TOKENS);
		let rows = '';

		for (const token of top) {
			const priceUsd = ergUsd > 0 ? token.price_erg * ergUsd : null;

			rows += '<tr>';
			rows += '<td><a href="' + getTokenUrl(token.id) + '">' + getAssetTitleParams(null, token.id, token.ticker, true) + '</a></td>';
			rows += '<td>' + (priceUsd != null
				? '$' + formatValue(priceUsd, getDecimals(priceUsd))
				: formatValue(token.price_erg, getDecimals(token.price_erg)) + ' ERG') + '</td>';
			rows += '<td>' + (ergUsd > 0
				? '$' + Math.round(token.liquidity_erg * ergUsd).toLocaleString('en-US')
				: Math.round(token.liquidity_erg).toLocaleString('en-US') + ' ERG') + '</td>';
			rows += getBuyCell(token.id);
			rows += '</tr>';
		}

		if (top.length == 0) {
			rows = '<tr><td colspan="4" class="p-2 text-light">No pools found.</td></tr>';
		}

		$('#tokensLiquidityTableBody').html(rows);
		$('#tokenView').show();
		$('#tokenLoading').hide();
	});
}

function getBuyCell(tokenId) {
	if (!/^[0-9a-f]{64}$/i.test(tokenId)) {
		return '<td></td>';
	}

	let buyUrl = 'https://dex.mewfinance.com/ergo/swap?base=0000000000000000000000000000000000000000000000000000000000000000&quote=' + tokenId;

	return '<td class="index-buy-cell"><a target="_new" rel="noopener" class="btn btn-info index-buy-btn" href="' + buyUrl + '">Buy</a></td>';
}

/* 24h stats: the last day's headers, emission at both ends, tx counts from global indexes */

async function getDayStats() {
	try {
		const headers = (await LiteNode.lastHeaders(DAY_BLOCKS + 1)).slice().sort((a, b) => a.height - b.height);
		const newest = headers[headers.length - 1];
		const since = Number(newest.timestamp) - DAY_MS;
		const day = headers.filter(header => Number(header.timestamp) > since);
		const first = day[0];
		// The block before the window ends it on the other side
		const before = headers[headers.indexOf(first) - 1] || first;
		const spanMs = Number(newest.timestamp) - Number(before.timestamp);
		const blocks = day.length;
		const averageMs = spanMs / Math.max(1, blocks);
		const averageDifficulty = day.reduce((total, header) => total + Number(header.difficulty), 0) / Math.max(1, blocks);

		setCountUpHtml('#statsBlocksMined', '<p>' + blocks.toLocaleString('en-US') + '</p>');
		setCountUpHtml('#statsAverageMiningTime', '<p>' + millisToMinutesAndSeconds(averageMs) + '</p>');
		setCountUpHtml('#statsDifficulty', '<p title="Average hashes needed to find a block: ' + Number(newest.difficulty).toLocaleString('en-US') + '">' + (Number(newest.difficulty) / 1e12).toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 }) + ' T</p>');
		setCountUpHtml('#statsHashRate', '<p>' + formatHashRateString(Math.round(averageDifficulty / (averageMs / 1000))) + '</p>');

		// The index can be a block or two behind the tip: count txs up to its newest block
		const indexed = await LiteNode.get('blockchain/indexedHeight');
		const newestIndexed = day.filter(header => header.height <= Number(indexed.indexedHeight)).pop() || newest;

		const [emissionNow, emissionBefore, newestBlock, firstBlock] = await Promise.all([
			LiteNode.emissionAt(newest.height),
			LiteNode.emissionAt(before.height),
			LiteNode.get('blockchain/block/byHeaderId/' + newestIndexed.id),
			LiteNode.get('blockchain/block/byHeaderId/' + first.id)
		]);

		const mined = new BigNumber(decimalString(emissionNow.totalCoinsIssued)).minus(decimalString(emissionBefore.totalCoinsIssued));
		setCountUpHtml('#statsCoinsMined', formatStatsErgHtml(mined.toFixed(), 0));

		const newestTxs = newestBlock.transactions || [];
		const firstTxs = firstBlock.transactions || [];

		if (newestTxs.length > 0 && firstTxs.length > 0) {
			const total = Number(newestTxs[newestTxs.length - 1].globalIndex) + 1;
			const dayCount = total - Number(firstTxs[0].globalIndex);

			showTotalTransactions(total);
			setCountUpHtml('#statsNumberOfTransactions', '<p>' + dayCount.toLocaleString('en-US') + '</p>');
		}
	} catch (e) {
		console.warn('24h stats failed', e);
		$('#statsHolder .skeleton, #totalTransactions').removeClass('skeleton');
	}
}

function showTotalTransactions(total) {
	if (newestTxCount != null && total < newestTxCount) return;

	newestTxCount = total;
	setCountUpHtml('#totalTransactions', total.toLocaleString('en-US'));
}

/* Big transfers: in each tx of the newest blocks, what every address gained or gave in ERG */

async function getBigTransfers() {
	try {
		const [lastHeaders, indexed] = await Promise.all([LiteNode.lastHeaders(SCAN_BLOCKS), LiteNode.get('blockchain/indexedHeight')]);
		// Blocks past the node's index are read on the next refresh
		const headers = lastHeaders
			.filter(header => header.height <= Number(indexed.indexedHeight))
			.sort((a, b) => b.height - a.height);
		const wanted = headers.map(header => header.id);

		for (const id of Array.from(scannedBlocks.keys())) {
			if (!wanted.includes(id)) scannedBlocks.delete(id);
		}

		const missing = wanted.filter(id => !scannedBlocks.has(id));

		for (let i = 0; i < missing.length; i += SCAN_BATCH) {
			const blocks = await LiteNode.post('blockchain/block/byHeaderIds', missing.slice(i, i + SCAN_BATCH));

			for (const block of blocks || []) {
				scannedBlocks.set(block.header.id, blockTransfers(block));
				noteNewestTxCount(block);
			}

			showBigTransfers(headers.length);
		}

		showBigTransfers(headers.length);
	} catch (e) {
		console.warn('Big transfers failed', e);

		if (scannedBlocks.size == 0) {
			$('#txView').hide();
		}
	}
}

function noteNewestTxCount(block) {
	const txs = block.transactions || [];
	if (txs.length == 0) return;

	showTotalTransactions(Number(txs[txs.length - 1].globalIndex) + 1);
}

// Only what the table needs is kept from each block
function blockTransfers(block) {
	const transfers = [];

	for (const tx of block.transactions || []) {
		const net = new Map();
		const add = (box, sign) => {
			const address = box.address || getBoxAddress(box);
			if (!address || address == FEE_ADDRESS) return;

			net.set(address, (net.get(address) || 0) + sign * Number(decimalString(box.value)));
		};

		(tx.inputs || []).forEach(box => add(box, -1));
		(tx.outputs || []).forEach(box => add(box, 1));

		const from = [];
		const to = [];
		let value = 0;

		for (const [address, change] of net) {
			if (change > 0) {
				to.push({ address, change });
				value += change;
			} else if (change < 0) {
				from.push({ address, change });
			}
		}

		if (value > 0) {
			transfers.push({ id: tx.id, time: Number(tx.timestamp || block.header.timestamp), value: value, from: from, to: to });
		}
	}

	return transfers;
}

function showBigTransfers(blockCount) {
	const all = [];

	for (const transfers of scannedBlocks.values()) all.push(...transfers);

	const shown = all
		.sort((a, b) => b.value - a.value)
		.slice(0, BIG_TXS_SHOWN)
		.sort((a, b) => b.time - a.time);

	let rows = '';

	for (const transfer of shown) {
		rows += '<tr>';
		rows += '<td><span class="d-lg-none"><strong>Tx: </strong></span><a href="' + getTransactionsUrl(transfer.id) + '"><i class="fas fa-link text-info"></i></a><span class="d-inline d-lg-none text-white float-end">' + formatDateString(transfer.time) + '</span></td>';
		rows += '<td class="d-none d-lg-table-cell">' + formatDateString(transfer.time) + '</td>';
		rows += '<td><span class="d-lg-none"><strong>From: </strong></span>' + formatTransferParties(transfer.from, 'sending') + '</td>';
		rows += '<td><span class="d-lg-none"><strong>To: </strong></span>' + formatTransferParties(transfer.to, 'receiving') + '</td>';
		rows += '<td><span class="d-lg-none"><strong>Value: </strong></span>' + formatErgValueString(transfer.value) + ' <span class="text-light">' + formatAssetDollarPriceString(transfer.value, ERG_DECIMALS, 'ERG') + '</span></td>';
		rows += '</tr>';
	}

	if (shown.length == 0) {
		rows = '<tr><td colspan="5" class="p-2 text-light">No transfers yet.</td></tr>';
	}

	$('#bigTxBlocks').text(blockCount);
	$('#transactionsTableBody').html(rows);
	$('#txView').show();

	getAddressesInfo();
}

function formatTransferParties(parties, side) {
	if (parties.length == 0) {
		return '<span class="text-light">&mdash;</span>';
	}

	if (parties.length > 1) {
		return '<span class="text-light" title="This transaction has multiple ' + side + ' addresses. Check transaction link for more details.">' + AddressType.Multiple + '</span>';
	}

	const address = parties[0].address;
	addAddress(address);

	return '<a class="address-string" addr="' + address + '" href="' + getWalletAddressUrl(address) + '" >' + formatAddressString(address, 10) + '</a>';
}

//Sets html and counts every number in it up to its value. On a refresh it
//counts from the previously shown numbers instead of from zero.
//Numbers glued to a letter ("24h") are left alone.
const COUNT_UP_NUMBER_REGEX = /\d[\d,]*(?:\.\d+)?(?![\d\w])/g;
const COUNT_UP_DURATION = 1000;

function setCountUpHtml(selector, html) {
	const $el = $(selector);
	const el = $el[0];

	if (el == undefined) {
		return;
	}

	const isFirstFill = el.childNodes.length == 0;
	cancelAnimationFrame($el.data('countUpFrame'));
	clearTimeout($el.data('countUpTimeout'));
	$el.html(html);

	if (isFirstFill) {
		$el.addClass('count-up-in');
	}

	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
	const parts = [];
	let node;

	while ((node = walker.nextNode())) {
		const text = node.nodeValue;
		const numbers = [];
		let match;

		COUNT_UP_NUMBER_REGEX.lastIndex = 0;
		while ((match = COUNT_UP_NUMBER_REGEX.exec(text)) !== null) {
			const raw = match[0];
			const [intPart, decPart] = raw.split('.');
			numbers.push({
				index: match.index,
				raw: raw,
				value: parseFloat(raw.replace(/,/g, '')),
				decimals: decPart ? decPart.length : 0,
				grouping: raw.includes(','),
				zeroPadded: intPart.length > 1 && intPart[0] == '0',
				intDigits: intPart.length
			});
		}

		if (numbers.length > 0) {
			parts.push({ node: node, text: text, numbers: numbers });
		}
	}

	const finalValues = parts.flatMap(p => p.numbers.map(n => n.value));
	const previousValues = $el.data('countUpValues');
	$el.data('countUpValues', finalValues);

	if (finalValues.length == 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
		return;
	}

	let fromValues = finalValues.map(() => 0);
	if (previousValues != undefined && previousValues.length == finalValues.length) {
		fromValues = previousValues;
	}

	const startTime = performance.now();

	function render(progress) {
		let valueIndex = 0;

		for (const part of parts) {
			let text = '';
			let cursor = 0;

			for (const number of part.numbers) {
				const from = fromValues[valueIndex++];
				const current = from + (number.value - from) * progress;
				let formatted = progress >= 1 ? number.raw : current.toLocaleString('en-US', {
					minimumFractionDigits: number.decimals,
					maximumFractionDigits: number.decimals,
					useGrouping: number.grouping
				});

				//Keeps the zero padding of values like "02 sec"
				if (number.zeroPadded) {
					formatted = formatted.padStart(number.intDigits, '0');
				}

				text += part.text.slice(cursor, number.index) + formatted;
				cursor = number.index + number.raw.length;
			}

			part.node.nodeValue = text + part.text.slice(cursor);
		}
	}

	function step(now) {
		const t = Math.min((now - startTime) / COUNT_UP_DURATION, 1);
		render(1 - Math.pow(1 - t, 3));

		if (t < 1) {
			$el.data('countUpFrame', requestAnimationFrame(step));
		}
	}

	render(0);
	$el.data('countUpFrame', requestAnimationFrame(step));

	//Animation frames pause in background tabs; never leave a half-counted value
	$el.data('countUpTimeout', setTimeout(function() {
		cancelAnimationFrame($el.data('countUpFrame'));
		render(1);
	}, COUNT_UP_DURATION + 100));
}

function formatStatsErgHtml(value, maxDecimals = 4) {
	return '<p class="text-white">' + formatErgValueString(value, maxDecimals, false, true) + ' <span class="text-light">' + formatAssetDollarPriceString(value, ERG_DECIMALS, 'ERG') + '</span></p>';
}
