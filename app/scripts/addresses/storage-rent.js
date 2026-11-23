/**
 * A notice on a wallet (P2PK) address whose boxes can be charged storage rent now or within the
 * next 30 days, with a link to consolidate them. Worked out here from the address's unspent
 * boxes and the node's height and storage fee. Mainnet only.
 */
const CONSOLIDATE_URL = 'https://tools.mewfinance.com/consolidate';
const BLOCKS_PER_DAY = 720;
// A box can be charged once it is this many blocks old (about 4 years)
const STORAGE_PERIOD = 1051200;
const NOTICE_WINDOW = 30 * BLOCKS_PER_DAY;
// The protocol's fee per byte when the node doesn't say
const DEFAULT_STORAGE_FEE_FACTOR = 1250000;

export const StorageRentNotice = {
	/**
	 * readBoxes answers { boxes } with the address's unspent boxes, oldest first
	 */
	async load(walletAddress, readBoxes) {
		if (networkType == 'testnet' || !isWalletAddress(walletAddress)) {
			return;
		}

		const [scan, info] = await Promise.all([readBoxes(), LiteNode.info()]);
		const height = Number(info.fullHeight);
		const feeFactor = Number(info.parameters && info.parameters.storageFeeFactor) || DEFAULT_STORAGE_FEE_FACTOR;
		const line = height - STORAGE_PERIOD;

		const items = scan.boxes
			.filter(box => Number(box.creationHeight) <= line + NOTICE_WINDOW)
			.map(box => ({ creationHeight: Number(box.creationHeight), rent: boxRent(box, feeFactor) }));

		if (items.length == 0) {
			return;
		}

		$('#rentNoticeText').text(formatNotice(items, line));
		$('#rentNoticeLink').attr('href', CONSOLIDATE_URL);
		$('#rentNotice').show();
		new bootstrap.Tooltip(document.getElementById('rentNoticeHelp'));
	}
};

// The fee is per byte of the box, and never more than the box holds
function boxRent(box, feeFactor) {
	const value = new BigNumber(String(box.value));
	let size;

	try {
		// Big amounts arrive as BigNumber objects; the serializer takes strings
		size = qfleetSDK.estimateBoxSize(Object.assign({}, box, {
			value: String(box.value),
			assets: (box.assets || []).map(asset => ({ tokenId: asset.tokenId, amount: String(asset.amount) }))
		}));
	} catch (e) {
		// A plain wallet box with no tokens or registers
		size = 79;
	}

	const fee = new BigNumber(size).times(feeFactor);

	return BigNumber.min(fee, value);
}

function isWalletAddress(address) {
	try {
		return qfleetSDKcore.ErgoAddress.getAddressType(address) == qfleetSDKcore.AddressType.P2PK;
	} catch (e) {
		return false;
	}
}

function formatNotice(items, line) {
	const nowItems = items.filter(item => item.creationHeight <= line);
	const laterCount = items.length - nowItems.length;

	if (nowItems.length > 0) {
		return boxes(nowItems.length) + ' here can be charged ' + formatRent(nowItems) + ' storage rent now'
			+ (laterCount > 0 ? ', ' + laterCount + ' more within 30 days.' : '.');
	}

	const soonest = Math.min(...items.map(item => item.creationHeight)) - line;
	const when = formatBlocks(soonest);

	return items.length == 1
		? '1 box here can be charged ' + formatRent(items) + ' storage rent in ' + when + '.'
		: boxes(items.length) + ' here can be charged ' + formatRent(items) + ' storage rent, the first in ' + when + '.';
}

function formatRent(items) {
	const rent = items.reduce((sum, item) => sum.plus(item.rent), new BigNumber(0)).dividedBy(1000000000);

	return rent.toFormat(rent.gte(10) ? 2 : 4).replace(/\.?0+$/, '') + ' ERG';
}

function boxes(count) {
	return count + (count == 1 ? ' box' : ' boxes');
}

// A block about every 2 minutes: a day or more out, the days too
function formatBlocks(blocks) {
	const text = blocks.toLocaleString('en-US') + (blocks == 1 ? ' block' : ' blocks');
	const days = Math.round(blocks / BLOCKS_PER_DAY);

	return blocks >= BLOCKS_PER_DAY ? text + ' (~' + days + (days == 1 ? ' day)' : ' days)') : text;
}
