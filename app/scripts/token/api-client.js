import { TokenState } from './state.js?v=2';

// The node's proxy may refuse pages larger than 100
const PAGE = 100;
// Holders are counted from unspent boxes: up to this many pages from the oldest end, then as many
// from the newest end, where busy contract boxes (pools, banks) sit. A few pages at a time
const HOLDER_PAGES_EACH_END = 10;
const HOLDER_PARALLEL = 4;
export const BOX_PAGE = 20;

// Unspent byTokenId answers a plain array on some nodes and { items, total } on others
function listOf(data) {
	return Array.isArray(data) ? data : ((data && data.items) || []);
}

// Some nodes repeat a box within a page, so callers dedupe by box id
function unspentPage(page, direction) {
	return LiteNode.get('blockchain/box/unspent/byTokenId/' + TokenState.tokenId + '?offset=' + (page * PAGE) + '&limit=' + PAGE + '&sortDirection=' + direction)
		.then(listOf);
}

export const TokenApiClient = {
	// Unspent boxes holding the token. complete is false when there were more than were counted
	async getUnspentBoxes() {
		const seen = new Map();
		const add = list => {
			for (const box of list) seen.set(box.boxId, box);
		};

		const first = await unspentPage(0, 'asc');
		add(first);

		if (first.length < PAGE) {
			return { boxes: Array.from(seen.values()), complete: true };
		}

		const walk = async (startPage, direction) => {
			for (let page = startPage; page < HOLDER_PAGES_EACH_END; page += HOLDER_PARALLEL) {
				const count = Math.min(HOLDER_PARALLEL, HOLDER_PAGES_EACH_END - page);
				const pages = await Promise.all(Array.from({ length: count }, (_, i) => unspentPage(page + i, direction)));
				let short = false;

				for (const list of pages) {
					add(list);
					if (list.length < PAGE) short = true;
				}

				if (short) return true;
			}

			return false;
		};

		// The oldest pages reach the end: every box is counted
		if (await walk(1, 'asc')) {
			return { boxes: Array.from(seen.values()), complete: true };
		}

		await walk(0, 'desc');

		return { boxes: Array.from(seen.values()), complete: false };
	},

	// Every box that ever held the token, newest first. Answers { items, total }
	async getBoxes(offset) {
		const data = await LiteNode.get('blockchain/box/byTokenId/' + TokenState.tokenId + '?offset=' + offset + '&limit=' + BOX_PAGE);

		return { items: listOf(data), total: data && data.total != null ? Number(data.total) : null };
	},

	// The box the minting tx spent first: a new token takes its id, and EIP-24 keeps traits in its R6
	async getIssuerBox() {
		try {
			return await LiteNode.get('blockchain/box/byId/' + TokenState.tokenId);
		} catch (e) {
			return null;
		}
	}
};
