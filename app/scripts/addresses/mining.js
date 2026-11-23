/**
 * The Mining tab of a wallet address: unspent block rewards for its key. They don't sit at the
 * address itself, so wallets don't show them.
 *
 * Ergo pays every block reward to a script that only the miner's key can spend, a day of
 * blocks later.
 */
const BLOCK_REWARD_DELAY = 720;
// Re-emission share (EIP-27) a reward box holds and pays back when spent
const REEMISSION_TOKEN_ID = 'd9a2cc8a09abfaed87afacfbb7daee79a6b26f10c6613fc13d3f3953e5521d1a';
const REWARDS_PAGE = 100;

export const MiningPanel = {
	/**
	 * Fills #miningHolder and returns how many reward boxes it lists,
	 * which is 0 for anything but a wallet (P2PK) address.
	 */
	async load(walletAddress) {
		const publicKey = getPublicKey(walletAddress);

		if (!publicKey) {
			return 0;
		}

		const rewardAddress = getP2SAddress(getMinerRewardTree(publicKey));
		const list = await LiteNode.get('blockchain/box/unspent/byAddress/' + rewardAddress + '?offset=0&limit=' + REWARDS_PAGE + '&sortDirection=desc');
		const items = Array.isArray(list) ? list : [];

		if (items.length == 0) {
			return 0;
		}

		const height = await LiteNode.height().catch(() => null);

		$('#miningHolder').html(formatRewards(items, height, rewardAddress));

		return items.length;
	}
};

//The key of a P2PK address; null for a contract
function getPublicKey(address) {
	try {
		const ergoTree = qfleetSDKcore.ErgoAddress.fromBase58(address).ergoTree;

		return ergoTree.startsWith('0008cd') ? ergoTree.substring(6) : null;
	} catch (e) {
		return null;
	}
}

//Ergo pays a block's reward to this script for the miner's key: only that key can spend it, BLOCK_REWARD_DELAY blocks on
function getMinerRewardTree(publicKey) {
	return '100204a00b08cd' + publicKey + 'ea02d192a39a8cc7a70173007301';
}

function getP2SAddress(ergoTree) {
	return qfleetSDKcore.ErgoAddress.fromErgoTree(ergoTree, getFleetNetwork()).toString();
}

function cell(label, content) {
	return '<td><span class="d-lg-none"><strong>' + label + ': </strong></span>' + content + '</td>';
}

function boxLink(boxId) {
	return '<a href="' + getBoxUrl(boxId) + '">' + formatAddressString(boxId, 6) + '</a>';
}

function heightLink(height) {
	return '<a href="' + getBlockUrl(height) + '">' + nFormatter(height, 0, true, true) + '</a>';
}

function formatRewards(items, height, rewardAddress) {
	const full = items.length >= REWARDS_PAGE;
	const count = nFormatter(items.length, 0, true, true) + (full ? '+' : '');
	const heading = '<h5 class="mining-heading">Block rewards <span class="address-section-tab-count">(' + count + ')</span></h5>'
		+ '<p class="mining-note">Rewards for blocks this key mined. They can be spent ' + BLOCK_REWARD_DELAY + ' blocks after the block. Amounts leave out the re-emission share (EIP-27).</p>';

	let rows = '';
	const sorted = [...items].sort((a, b) => b.creationHeight - a.creationHeight);

	for (const box of sorted) {
		const owed = (box.assets || []).filter(asset => asset.tokenId == REEMISSION_TOKEN_ID).reduce((sum, asset) => sum + Number(asset.amount), 0);
		const net = Number(box.value) - owed;
		const unlocksAt = box.creationHeight + BLOCK_REWARD_DELAY;
		//The box holds the re-emission share too, which spending it pays back
		const gross = owed > 0 ? '<br><span class="text-light">of ' + formatErgValueString(box.value, 4) + ' in the box</span>' : '';

		let spendable = '–';

		if (height != null) {
			spendable = height >= unlocksAt
				? '<span class="text-success">Now</span>'
				: 'At ' + heightLink(unlocksAt) + ' <span class="text-light">(~' + formatBlocksAway(unlocksAt - height) + ')</span>';
		}

		rows += '<tr>'
			+ cell('Block', heightLink(box.creationHeight))
			+ cell('Reward', formatErgValueString(net, 4) + gross)
			+ cell('Spendable', spendable)
			+ cell('Box', boxLink(box.boxId))
			+ '</tr>';
	}

	const more = full
		? '<p>The newest ' + REWARDS_PAGE + ' are listed. See all on <a href="' + getWalletAddressUrl(rewardAddress) + '">the reward address</a>.</p>'
		: '';

	return '<div class="mining-section">' + heading + more
		+ '<table class="table table-dark table-striped table-mobile rounded-data-table"><thead><tr>'
		+ '<th scope="col">Block</th><th scope="col">Reward</th><th scope="col">Spendable</th><th scope="col">Box</th>'
		+ '</tr></thead><tbody>' + rows + '</tbody></table></div>';
}

//Ergo aims for a block every two minutes
function formatBlocksAway(blocks) {
	const minutes = blocks * 2;

	return minutes < 120 ? minutes + ' min' : Math.round(minutes / 60) + ' h';
}
