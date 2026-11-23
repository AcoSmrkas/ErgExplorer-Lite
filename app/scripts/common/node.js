// The only code in ErgExplorer Lite that talks to the network. Every request goes to the indexed
// node the visitor picked on the connect screen; scripts/check-no-foreign-fetch.js fails the build
// if a page fetches anything another way.
//
// Node answers differ from the explorer API the pages were written for: box assets carry only
// tokenId and amount, heights are inclusionHeight, an input's creating tx is transactionId. The
// normalise* helpers fill in what the renderers in main.js expect (names, decimals, settlement
// heights), so pages can keep using them.
var LiteNode = (function () {
	const URL_KEY = 'liteNodeUrl';
	const NETWORK_KEY = 'liteNodeNetwork';
	const SAVED_KEY = 'liteNodeUrls';
	const TOKEN_CACHE_KEY = 'liteTokenMeta';
	const TOKEN_CACHE_MAX = 4000;
	const TIMEOUT_MS = 20000;
	const TOKEN_BATCH = 100;

	function storeGet(key) {
		try { return localStorage.getItem(key); } catch (e) { return null; }
	}

	function storeSet(key, value) {
		try {
			if (value === null) localStorage.removeItem(key);
			else localStorage.setItem(key, value);
		} catch (e) {}
	}

	class NodeError extends Error {
		// kind: none | mixed | unreachable | timeout | notfound | noindex | syncing | http | bad
		constructor(kind, message, status) {
			super(message || kind);
			this.kind = kind;
			this.status = status;
		}
	}

	function isLocalHost(hostname) {
		return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname.endsWith('.localhost');
	}

	// "node.example.com", "192.168.1.5:9053/", "https://x/info" -> "https://node.example.com"
	function normalizeUrl(raw) {
		let text = String(raw || '').trim();

		if (text === '') {
			throw new NodeError('bad', 'Enter a node address.');
		}

		if (!/^https?:\/\//i.test(text)) {
			const host = text.split(/[/:]/)[0];
			const plain = isLocalHost(host) || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || /:\d+/.test(text);
			text = (plain ? 'http://' : 'https://') + text;
		}

		let parsed;

		try {
			parsed = new URL(text);
		} catch (e) {
			throw new NodeError('bad', 'That is not a valid address.');
		}

		let path = parsed.pathname.replace(/\/+$/, '').replace(/\/(info|panel|swagger)$/i, '');

		return parsed.protocol + '//' + parsed.host + path;
	}

	// An https page cannot call a plain-http node, except one on this computer
	function isBlockedAsMixed(url) {
		if (window.location.protocol !== 'https:') return false;

		const parsed = new URL(url);

		return parsed.protocol === 'http:' && !isLocalHost(parsed.hostname);
	}

	let nodeUrl = storeGet(URL_KEY) || '';
	let infoPromise = null;

	function getUrl() {
		return nodeUrl;
	}

	function getSavedNetwork() {
		return storeGet(NETWORK_KEY) === 'testnet' ? 'testnet' : 'mainnet';
	}

	function getSaved() {
		try {
			const list = JSON.parse(storeGet(SAVED_KEY) || '[]');
			return Array.isArray(list) ? list.filter(item => typeof item === 'string') : [];
		} catch (e) {
			return [];
		}
	}

	function use(url, network) {
		nodeUrl = url;
		infoPromise = null;
		storeSet(URL_KEY, url);
		storeSet(NETWORK_KEY, network === 'testnet' ? 'testnet' : 'mainnet');

		const saved = getSaved().filter(item => item !== url);
		saved.unshift(url);
		storeSet(SAVED_KEY, JSON.stringify(saved.slice(0, 8)));
	}

	function forget(url) {
		storeSet(SAVED_KEY, JSON.stringify(getSaved().filter(item => item !== url)));

		if (url === nodeUrl) {
			nodeUrl = '';
			infoPromise = null;
			storeSet(URL_KEY, null);
		}
	}

	async function requestAt(base, path, options = {}) {
		if (!base) {
			throw new NodeError('none', 'No node selected.');
		}

		const url = base + '/' + path.replace(/^\/+/, '');

		if (isBlockedAsMixed(url)) {
			throw new NodeError('mixed', 'This page is served over https, so the browser blocks a plain-http node.');
		}

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), options.timeout || TIMEOUT_MS);
		const init = { method: options.method || 'GET', cache: 'no-store', signal: controller.signal };

		if (options.body !== undefined) {
			init.body = JSON.stringify(options.body);
			init.headers = { 'Content-Type': 'application/json' };
		}

		if (options.signal) {
			options.signal.addEventListener('abort', () => controller.abort(), { once: true });
		}

		let response;
		let text;

		try {
			response = await fetch(url, init);
			text = await response.text();
		} catch (e) {
			if (options.signal && options.signal.aborted) throw e;
			throw controller.signal.aborted
				? new NodeError('timeout', 'The node did not answer in time.')
				: new NodeError('unreachable', 'Could not reach the node.');
		} finally {
			clearTimeout(timer);
		}

		if (response.status === 404) {
			throw new NodeError('notfound', 'Not found.', 404);
		}

		if (response.status === 503) {
			throw new NodeError('syncing', 'The node is still building its index.', 503);
		}

		if (!response.ok) {
			throw new NodeError('http', 'The node answered HTTP ' + response.status + '.', response.status);
		}

		try {
			return text === '' ? null : JSONbig.parse(text);
		} catch (e) {
			throw new NodeError('bad', 'The node sent something that is not JSON.');
		}
	}

	function get(path, options) {
		return requestAt(nodeUrl, path, options);
	}

	function post(path, body, options = {}) {
		return requestAt(nodeUrl, path, Object.assign({}, options, { method: 'POST', body: body }));
	}

	// Checks a node before it is used: reachable, indexed, and how far its index has got
	async function probe(rawUrl) {
		const url = normalizeUrl(rawUrl);
		const info = await requestAt(url, 'info', { timeout: 10000 });

		if (!info || info.fullHeight == null) {
			throw new NodeError('bad', 'That does not look like an Ergo node.');
		}

		let indexed;

		try {
			indexed = await requestAt(url, 'blockchain/indexedHeight', { timeout: 10000 });
		} catch (e) {
			if (e.kind === 'notfound') {
				throw new NodeError('noindex', 'This node has no index (extraIndex is off).');
			}

			throw e;
		}

		return {
			url: url,
			network: info.network === 'testnet' ? 'testnet' : 'mainnet',
			version: info.appVersion,
			height: Number(info.fullHeight),
			indexedHeight: Number(indexed.indexedHeight),
			info: info
		};
	}

	function info() {
		if (!infoPromise) {
			infoPromise = get('info').catch(e => {
				infoPromise = null;
				throw e;
			});
		}

		return infoPromise;
	}

	async function height() {
		return Number((await info()).fullHeight);
	}

	// Token metadata never changes once minted, so it is kept across visits
	const tokenMeta = new Map();

	(function loadTokenCache() {
		try {
			const saved = JSON.parse(storeGet(TOKEN_CACHE_KEY) || '[]');
			for (const entry of saved) tokenMeta.set(entry.id, entry);
		} catch (e) {}
	})();

	function saveTokenCache() {
		const entries = Array.from(tokenMeta.values()).filter(entry => !entry.missing).slice(-TOKEN_CACHE_MAX);
		storeSet(TOKEN_CACHE_KEY, JSON.stringify(entries));
	}

	function toMeta(token) {
		return {
			id: token.id,
			boxId: token.boxId,
			name: token.name == null ? '' : String(token.name),
			decimals: token.decimals == null ? 0 : Number(token.decimals),
			description: token.description == null ? '' : String(token.description),
			emissionAmount: token.emissionAmount == null ? null : String(token.emissionAmount)
		};
	}

	const tokenInflight = new Map();

	async function tokens(ids) {
		const wanted = Array.from(new Set(ids.filter(id => typeof id === 'string' && id.length === 64)));
		const missing = wanted.filter(id => !tokenMeta.has(id) && !tokenInflight.has(id));

		for (let i = 0; i < missing.length; i += TOKEN_BATCH) {
			const batch = missing.slice(i, i + TOKEN_BATCH);
			const request = post('blockchain/tokens', batch).then(list => {
				for (const token of list || []) tokenMeta.set(token.id, toMeta(token));
				for (const id of batch) {
					if (!tokenMeta.has(id)) tokenMeta.set(id, { id: id, name: '', decimals: 0, missing: true });
				}
				saveTokenCache();
			}).catch(e => {
				console.warn('Token lookup failed', e);
			}).finally(() => {
				for (const id of batch) tokenInflight.delete(id);
			});

			for (const id of batch) tokenInflight.set(id, request);
		}

		await Promise.all(wanted.map(id => tokenInflight.get(id)).filter(Boolean));

		const result = new Map();
		for (const id of wanted) {
			if (tokenMeta.has(id)) result.set(id, tokenMeta.get(id));
		}

		return result;
	}

	async function token(id) {
		if (tokenMeta.has(id) && !tokenMeta.get(id).missing && tokenMeta.get(id).description !== undefined) {
			return tokenMeta.get(id);
		}

		const meta = toMeta(await get('blockchain/token/byId/' + id));
		tokenMeta.set(id, meta);
		saveTokenCache();

		return meta;
	}

	function boxesOf(things) {
		const boxes = [];

		for (const thing of things) {
			if (!thing) continue;
			if (Array.isArray(thing.inputs) || Array.isArray(thing.outputs)) {
				boxes.push(...(thing.inputs || []), ...(thing.dataInputs || []), ...(thing.outputs || []));
			} else {
				boxes.push(thing);
			}
		}

		return boxes;
	}

	function normalizeBox(box) {
		if (!box) return box;

		if (box.settlementHeight == null && box.inclusionHeight != null) {
			box.settlementHeight = box.inclusionHeight;
		}

		if (box.ergoTree && typeof getBoxAddress === 'function') {
			box.address = getBoxAddress(box);
		}

		return box;
	}

	// Inputs as the explorer listed them: the tx that made the box, and where it settled
	function normalizeTx(tx) {
		if (!tx) return tx;

		for (const input of tx.inputs || []) {
			normalizeBox(input);
			if (input.outputTransactionId == null && input.transactionId != null && input.transactionId !== tx.id) {
				input.outputTransactionId = input.transactionId;
			}
			if (input.outputSettledAt == null && input.inclusionHeight != null) {
				input.outputSettledAt = input.inclusionHeight;
			}
		}

		for (const box of [...(tx.dataInputs || []), ...(tx.outputs || [])]) {
			normalizeBox(box);
		}

		if (tx.inclusionHeight != null && tx.height == null) {
			tx.height = tx.inclusionHeight;
		}

		return tx;
	}

	// Puts name and decimals on every asset of the given txs and boxes
	async function withTokens(things) {
		const list = Array.isArray(things) ? things : [things];
		const boxes = boxesOf(list);
		const ids = [];

		for (const box of boxes) {
			for (const asset of box.assets || []) ids.push(asset.tokenId);
		}

		const meta = await tokens(ids);

		for (const box of boxes) {
			for (const asset of box.assets || []) {
				const m = meta.get(asset.tokenId);
				if (asset.name == null) asset.name = m ? m.name : '';
				if (asset.decimals == null) asset.decimals = m ? m.decimals : 0;
			}
		}

		return things;
	}

	async function withTokensNormalized(things) {
		const list = Array.isArray(things) ? things : [things];

		for (const thing of list) {
			if (thing && (thing.inputs || thing.outputs)) normalizeTx(thing);
			else normalizeBox(thing);
		}

		return withTokens(things);
	}

	function bytesHex(bytes) {
		return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
	}

	// A raw register as the explorer API gave it: { serializedValue, sigmaType, renderedValue }.
	// renderedValue is hex for Coll[Byte] and "[hex,hex]" for Coll[Coll[Byte]], as nft.js reads it.
	function explorerRegister(serialized) {
		const out = { serializedValue: serialized, sigmaType: undefined, renderedValue: undefined };

		try {
			const constant = qfleetSDK.SConstant.from(serialized);
			const type = constant.type.toString();
			const data = constant.data;
			out.sigmaType = type;

			if (data instanceof Uint8Array) {
				out.renderedValue = bytesHex(data);
			} else if (Array.isArray(data) && data.every(item => item instanceof Uint8Array)) {
				out.renderedValue = '[' + data.map(bytesHex).join(',') + ']';
			} else if (typeof data === 'bigint' || typeof data === 'number' || typeof data === 'boolean') {
				out.renderedValue = String(data);
			} else if (Array.isArray(data)) {
				out.renderedValue = JSON.stringify(data, (key, value) => typeof value === 'bigint' ? value.toString() : value);
			}
		} catch (e) {}

		return out;
	}

	function explorerRegisters(registers) {
		const out = {};

		for (const key of Object.keys(registers || {})) {
			const value = registers[key];
			out[key] = typeof value === 'string' ? explorerRegister(value) : value;
		}

		return out;
	}

	// A token with its minting box merged in, the shape nft.js expects: id, name, description,
	// decimals, emissionAmount, boxId, transactionId, address, additionalRegisters (explorer form)
	async function tokenWithIssuingBox(id) {
		const meta = await token(id);
		const issuing = meta.boxId ? await get('blockchain/box/byId/' + meta.boxId) : null;
		const merged = Object.assign({}, issuing || {}, {
			id: meta.id,
			tokenId: meta.id,
			name: meta.name,
			description: meta.description,
			decimals: meta.decimals,
			emissionAmount: meta.emissionAmount
		});

		if (issuing) {
			normalizeBox(merged);
			merged.additionalRegisters = explorerRegisters(issuing.additionalRegisters);
		}

		return merged;
	}

	// A confirmed tx, else the same id in the node's mempool (flagged pending)
	async function transaction(id) {
		try {
			return await withTokensNormalized(await get('blockchain/transaction/byId/' + id));
		} catch (e) {
			if (e.kind !== 'notfound') throw e;
		}

		const tx = await get('transactions/unconfirmed/byTransactionId/' + id);
		tx.pending = true;

		return withTokensNormalized(tx);
	}

	async function box(id) {
		try {
			return await withTokensNormalized(await get('blockchain/box/byId/' + id));
		} catch (e) {
			if (e.kind !== 'notfound') throw e;
		}

		const pending = await get('transactions/unconfirmed/outputs/byBoxId/' + id);
		pending.pending = true;

		return withTokensNormalized(pending);
	}

	// Newest first, as the node lists them. Answers { items, total }
	async function addressTransactions(address, offset, limit) {
		const data = await get('blockchain/transaction/byAddress/' + address + '?offset=' + offset + '&limit=' + limit);
		await withTokensNormalized(data.items);

		return data;
	}

	function addressBalance(address) {
		return get('blockchain/balanceForAddress/' + address);
	}

	async function addressUnspent(address, offset, limit, options = {}) {
		const query = '?offset=' + offset + '&limit=' + limit
			+ '&sortDirection=' + (options.ascending ? 'asc' : 'desc')
			+ '&includeUnconfirmed=' + (options.includeUnconfirmed ? 'true' : 'false')
			+ '&excludeMempoolSpent=' + (options.excludeMempoolSpent ? 'true' : 'false');

		return withTokensNormalized(await get('blockchain/box/unspent/byAddress/' + address + query));
	}

	async function addressMempool(address) {
		const tree = qfleetSDKcore.ErgoAddress.fromBase58(address).ergoTree;
		const list = await post('transactions/unconfirmed/byErgoTree?offset=0&limit=100', tree);

		for (const tx of list || []) tx.pending = true;

		return withTokensNormalized(list || []);
	}

	async function mempool(offset, limit) {
		const list = await get('transactions/unconfirmed?offset=' + offset + '&limit=' + limit);

		for (const tx of list || []) tx.pending = true;

		return withTokensNormalized(list || []);
	}

	function lastHeaders(count) {
		return get('blocks/lastHeaders/' + count);
	}

	async function headerIdAt(heightValue) {
		const ids = await get('blocks/at/' + heightValue);

		if (!ids || ids.length === 0) throw new NodeError('notfound', 'No block at that height.', 404);

		return ids[0];
	}

	// Full blocks, txs with addresses and global indexes. Answers [{ header, transactions, height, size }]
	async function indexedBlocks(headerIds) {
		if (headerIds.length === 0) return [];

		const blocks = await post('blockchain/block/byHeaderIds', headerIds);

		for (const block of blocks || []) {
			await withTokensNormalized(block.transactions || []);
		}

		return blocks || [];
	}

	async function indexedBlock(headerId) {
		const block = await get('blockchain/block/byHeaderId/' + headerId);
		await withTokensNormalized(block.transactions || []);

		return block;
	}

	function emissionAt(heightValue) {
		return get('emission/at/' + heightValue);
	}

	// USD per ERG from the on-chain oracle pool box, undefined when it can't be read
	let ergUsdPromise = null;

	function ergUsd() {
		if (!ergUsdPromise) {
			ergUsdPromise = get('blockchain/box/unspent/byTokenId/' + ERG_USD_ORACLE_POOL_NFT + '?offset=0&limit=1')
				.then(list => {
					const box = Array.isArray(list) ? list[0] : (list && list.items ? list.items[0] : null);
					const r4 = box && box.additionalRegisters && box.additionalRegisters.R4;
					const serialized = typeof r4 === 'string' ? r4 : (r4 && r4.serializedValue);
					const nanoErgPerUsd = Number(qfleetSDK.SConstant.from(serialized).data);

					return nanoErgPerUsd > 0 ? 1e9 / nanoErgPerUsd : undefined;
				})
				.catch(e => {
					console.warn('ERG/USD oracle read failed', e);
					return undefined;
				});
		}

		return ergUsdPromise;
	}

	return {
		NodeError,
		normalizeUrl,
		getUrl,
		getSavedNetwork,
		getSaved,
		use,
		forget,
		probe,
		get,
		post,
		info,
		height,
		token,
		tokens,
		normalizeBox,
		normalizeTx,
		withTokens,
		withTokensNormalized,
		explorerRegister,
		explorerRegisters,
		tokenWithIssuingBox,
		transaction,
		box,
		addressTransactions,
		addressBalance,
		addressUnspent,
		addressMempool,
		mempool,
		lastHeaders,
		headerIdAt,
		indexedBlocks,
		indexedBlock,
		emissionAt,
		ergUsd
	};
})();
