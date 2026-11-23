import { AddressState } from './state.js';

// Everything on the address page comes from the node the visitor picked (LiteNode, common/node.js).

// The node lists unspent boxes 100 at a time and gives no count, so the page reads them all,
// oldest first, up to this many: that gives the count, the storage rent notice and the box pages.
// Past it, box pages are read from the node one at a time and the count shows as "1,000+".
const UNSPENT_PAGE = 100;
const UNSPENT_SCAN_MAX = 1000;
// The 60 s refresh reads the box list again at most this often
const UNSPENT_RESCAN_MS = 60000;
// The node's mempool view by address answers at most this many
const MEMPOOL_LIMIT = 100;
// Spectrum pool boxes, for LP token values; the pool list changes slowly
const POOLS_CACHE_MS = 5 * 60 * 1000;
// Spectrum mints its LP tokens with a supply of Long.MaxValue and keeps the rest in the pool box
const SPECTRUM_LP_EMISSION = 9223372036854775807n;

// A mempool tx carries no time: the page shows when it first saw it
const firstSeen = new Map();

function toBigInt(value) {
	try {
		return value === undefined || value === null ? 0n : BigInt(String(value));
	} catch (e) {
		return 0n;
	}
}

// LiteNode.addressUnspent puts token names on every box; the scan only needs heights, values and sizes
async function readUnspent(address, boxOffset, limit, options = {}) {
	const list = await LiteNode.get('blockchain/box/unspent/byAddress/' + address
		+ '?offset=' + boxOffset + '&limit=' + limit + '&sortDirection=' + (options.newestFirst ? 'desc' : 'asc'));

	return Array.isArray(list) ? list : [];
}

async function readPoolBoxes(address) {
	const boxes = [];

	for (let page = 0; ; page += UNSPENT_PAGE) {
		const list = await LiteNode.get('blockchain/box/unspent/byAddress/' + address + '?offset=' + page + '&limit=' + UNSPENT_PAGE);
		boxes.push(...(list || []));

		if (!list || list.length < UNSPENT_PAGE) return boxes;
	}
}

export const ApiClient = {
	// First-load requests started by prefetch(), by request key. Each is handed out once;
	// later calls (the 60s refresh, paging) fetch fresh.
	_prefetched: new Map(),

	/**
	 * Start the first load's chain requests now. Prices and token icons are only needed to render.
	 */
	prefetch({ mempool }) {
		const requests = [
			['summary', this._fetchAddressSummary()],
			['transactions', this._fetchTransactionsData()]
		];
		if (mempool) {
			requests.push(['mempool', this._fetchMempoolData()]);
		}

		requests.forEach(([key, promise]) => {
			// The consumer handles a failure; this only keeps it from being reported as unhandled meanwhile.
			promise.catch(() => {});
			this._prefetched.set(key, promise);
		});

		this.scanUnspentBoxes().catch(() => {});
	},

	_takePrefetched(key) {
		const promise = this._prefetched.get(key);
		this._prefetched.delete(key);
		return promise;
	},

	/**
	 * The node's pending txs for this address, newest first.
	 * ids/ownIds/complete are what pending-tracker.js reads.
	 */
	async fetchMempool() {
		const items = await LiteNode.addressMempool(AddressState.walletAddress);
		const now = Date.now();

		for (const tx of items) {
			if (!firstSeen.has(tx.id)) firstSeen.set(tx.id, now);
			if (tx.creationTimestamp == null) tx.creationTimestamp = firstSeen.get(tx.id);
		}

		const data = mergeMempoolItems([items]);

		data.ids = new Set(items.map(tx => tx.id));
		// One node: it drops a tx from its pool as soon as the tx is in a block
		data.ownIds = data.ids;
		data.complete = items.length < MEMPOOL_LIMIT;

		return data;
	},

	async getMempoolData() {
		return this._takePrefetched('mempool') || this._fetchMempoolData();
	},

	async _fetchMempoolData() {
		let data;

		try {
			data = await this.fetchMempool();
		} catch (error) {
			// Don't let a mempool outage hide the confirmed history.
			console.error('Mempool fetch failed:', error);
			data = { items: [], total: 0 };
		}

		AddressState.mempoolData = data;

		return data;
	},

	/**
	 * A tx as the node's index has it once it is in a block, or null while it isn't there
	 * (still pending, or dropped).
	 */
	async getConfirmedTransaction(txId) {
		try {
			const tx = await LiteNode.get('blockchain/transaction/byId/' + txId);
			return tx && tx.id === txId && tx.blockId ? tx : null;
		} catch (error) {
			if (error.kind !== 'notfound') console.warn('Tx lookup failed:', error);
			return null;
		}
	},

	/**
	 * A page of the address's transactions, newest first
	 */
	async getTransactionsData() {
		return this._takePrefetched('transactions') || this._fetchTransactionsData();
	},

	async _fetchTransactionsData() {
		try {
			const data = await LiteNode.addressTransactions(AddressState.walletAddress, Number(offset) || 0, ITEMS_PER_PAGE);
			AddressState.transactionsData = data;
			return data;
		} catch (error) {
			console.error('Transactions fetch failed:', error);
			throw error;
		}
	},

	/**
	 * Balance: { confirmed: { nanoErgs, tokens }, unconfirmed }
	 */
	async getAddressSummary() {
		return this._takePrefetched('summary') || this._fetchAddressSummary();
	},

	// One source, so a balance that hasn't changed yet is just read again (balance-summary.js retries)
	async getChangedAddressSummary() {
		return this._fetchAddressSummary();
	},

	/**
	 * ERG and token amounts of a balance answer, as one comparable string
	 */
	balanceKey(data) {
		const tokens = data.confirmed.tokens
			.map(token => token.tokenId + ':' + token.amount)
			.sort();

		return [String(data.confirmed.nanoErgs)].concat(tokens).join(',');
	},

	async _fetchAddressSummary() {
		const data = await LiteNode.addressBalance(AddressState.walletAddress);

		if (!data || !data.confirmed || !Array.isArray(data.confirmed.tokens)) {
			throw new Error('No balance in answer');
		}

		return data;
	},

	_pools: null,
	_poolsAt: 0,

	/**
	 * Spectrum N2T and T2T pool boxes by LP token id: { box, kind }
	 */
	async getSpectrumPools() {
		if (networkType === 'testnet') return new Map();

		if (!this._pools || Date.now() - this._poolsAt > POOLS_CACHE_MS) {
			this._poolsAt = Date.now();
			this._pools = Promise.all([readPoolBoxes(SPECTRUM_N2T_ADDRESS), readPoolBoxes(SPECTRUM_T2T_ADDRESS)])
				.then(([n2t, t2t]) => {
					const byLp = new Map();

					for (const box of n2t) {
						if (box.assets && box.assets.length >= 3) byLp.set(box.assets[1].tokenId, { box, kind: 'n2t' });
					}
					for (const box of t2t) {
						if (box.assets && box.assets.length >= 4) byLp.set(box.assets[1].tokenId, { box, kind: 't2t' });
					}

					return byLp;
				})
				.catch(error => {
					this._pools = null;
					throw error;
				});
		}

		return this._pools;
	},

	/**
	 * USD value of `amount` LP tokens of a Spectrum pool, or null when it can't be valued.
	 * The share is amount / (emission - LP left in the pool) of both reserves.
	 */
	spectrumLpValue(pool, amount) {
		const reserveLp = toBigInt(pool.box.assets[1].amount);
		const supply = SPECTRUM_LP_EMISSION - reserveLp;
		const held = toBigInt(amount);

		if (supply <= 0n || held <= 0n || held > supply) return null;

		const share = new BigNumber(held.toString()).dividedBy(supply.toString());
		const sideUsd = asset => {
			if (!asset) return null;
			if (!prices[asset.tokenId]) return null;
			return new BigNumber(String(asset.amount)).dividedBy(Math.pow(10, asset.decimals || 0)).times(prices[asset.tokenId]);
		};

		let poolUsd = null;

		if (pool.kind === 'n2t') {
			if (!(prices.ERG > 0)) return null;
			// Both sides are worth the same at the pool's own price
			poolUsd = new BigNumber(String(pool.box.value)).dividedBy(1e9).times(prices.ERG).times(2);
		} else {
			const x = sideUsd(pool.box.assets[2]);
			const y = sideUsd(pool.box.assets[3]);
			if (x && y) poolUsd = x.plus(y);
			else if (x || y) poolUsd = (x || y).times(2);
		}

		if (!poolUsd || !poolUsd.isFinite() || poolUsd.lte(0)) return null;

		return { usdValue: share.times(poolUsd).toNumber(), poolUsdValue: poolUsd.toNumber() };
	},

	_unspentScan: null,
	_unspentScanAt: 0,
	_unspentComplete: null,

	/**
	 * The address's unspent boxes, oldest first, up to UNSPENT_SCAN_MAX.
	 * { boxes, complete } -- complete is false when there are more than that.
	 */
	scanUnspentBoxes(force = false) {
		// A list too long to read whole isn't read again: its pages come from the node as they are shown
		const stale = force && this._unspentComplete !== false && Date.now() - this._unspentScanAt > UNSPENT_RESCAN_MS;

		if (this._unspentScan && !stale) {
			return this._unspentScan;
		}

		this._unspentScanAt = Date.now();
		const scan = (async () => {
			const boxes = [];

			for (let page = 0; page < UNSPENT_SCAN_MAX; page += UNSPENT_PAGE) {
				const list = await readUnspent(AddressState.walletAddress, page, UNSPENT_PAGE);
				boxes.push(...list);

				if (list.length < UNSPENT_PAGE) {
					this._unspentComplete = true;
					return { boxes, complete: true };
				}
			}

			this._unspentComplete = false;
			return { boxes, complete: false };
		})();

		// A failed read isn't kept: the next call asks again
		scan.catch(() => {
			if (this._unspentScan === scan) this._unspentScan = null;
		});

		// The first good answer stays until a newer one replaces it
		if (!this._unspentScan) {
			this._unspentScan = scan;
		} else {
			scan.then(() => { this._unspentScan = scan; }, () => {});
		}

		return scan;
	},

	/**
	 * A page of unspent boxes, newest first: { items, total, complete }.
	 * total is a lower bound when complete is false.
	 */
	async getUnspentBoxes(boxOffset = AddressState.unspentBoxesOffset, limit = AddressState.unspentBoxesPageSize, refresh = false) {
		const scan = await this.scanUnspentBoxes(refresh);
		let items;

		if (scan.complete) {
			const newestFirst = scan.boxes.slice().reverse();
			items = newestFirst.slice(boxOffset, boxOffset + limit).map(box => Object.assign({}, box));
		} else {
			items = await readUnspent(AddressState.walletAddress, boxOffset, limit, { newestFirst: true });
		}

		await LiteNode.withTokensNormalized(items);

		return { items, total: scan.boxes.length, complete: scan.complete };
	}
};
