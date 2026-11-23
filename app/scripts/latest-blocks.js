//The rows come from block headers, one request for the page. Transactions, reward, fees and size
//need each full block, which can be hundreds of kB, so those cells fill in a few blocks at a time
const BLOCK_DETAIL_BATCH = 5;

//Full blocks already read, by header id; the page's auto-update only reads the new ones
const blockDetails = new Map();
let pricesReady = false;

$(function() {
	const pricesLoaded = new Promise(resolve => getPrices(resolve));

	pricesLoaded.then(() => {
		pricesReady = true;
		fillRewardUsd();
	});

	printLatestBlocks();
});

function printLatestBlocks() {
	fetchTipHeight()
	.then(tip => fetchPageHeaders(tip).then(headers => ({ tip: tip, headers: headers })))
	.then(page => {
		renderBlocks(page);

		$('#blocksHolder').show();

		loadBlockDetails(page.headers);
		startAutoUpdate(page);
	})
	.catch(function(error) {
		console.warn('Latest blocks unavailable:', error);
		showLoadError('Failed to fetch latest blocks.' + (error && error.message ? ' ' + error.message : ''));
	})
	.finally(function() {
		$('#txLoading').hide();
	});
}

//The newest full block the node has
async function fetchTipHeight() {
	const info = await LiteNode.get('info');

	return Number(info.fullHeight);
}

//The page's headers, newest first, plus the one below the page for the last row's block time
async function fetchPageHeaders(tip) {
	const top = tip - Number(offset);
	const bottom = Math.max(1, top - Number(ITEMS_PER_PAGE) + 1);

	if (top < 1) {
		return [];
	}

	//fromHeight is exclusive
	const headers = await LiteNode.get('blocks/chainSlice?fromHeight=' + Math.max(0, bottom - 2) + '&toHeight=' + top);

	return (headers || [])
		.filter(header => header.height >= bottom - 1 && header.height <= top)
		.sort((a, b) => b.height - a.height);
}

//Rows above newAbove are new since the last render and flash once
function renderBlocks(page, newAbove = Infinity) {
	const headers = page.headers;
	const top = page.tip - Number(offset);
	const bottom = Math.max(1, top - Number(ITEMS_PER_PAGE) + 1);
	let formattedResult = '';

	setupPagination(page.tip);

	for (let i = 0; i < headers.length; i++) {
		const header = headers[i];

		//The header below the page only gives the last row its block time
		if (header.height < bottom) {
			continue;
		}

		const miner = getMinerAddress(header);

		formattedResult += '<tr data-id="' + header.id + '"' + (header.height > newAbove ? ' class="block-new"' : '') + '>';

		//Height
		formattedResult += '<td><span class="d-lg-none"><strong>Height: </strong></span><a href="' + getBlockUrl(header.id) + '">' + nFormatter(header.height, 2, true, true) + '</a></td>';

		//Time
		formattedResult += '<td><span class="d-lg-none"><strong>Time: </strong></span>' + formatDateString(header.timestamp) + '</td>';

		//Block time
		formattedResult += '<td><span class="d-lg-none"><strong>Block time: </strong></span>' + formatBlockTime(getMiningTime(headers, i)) + '</td>';

		//Transactions
		formattedResult += '<td><span class="d-lg-none"><strong>TXs: </strong></span><span class="block-txs">' + pendingCell() + '</span></td>';

		//Mined by: the key that solved the block, as a wallet address
		if (miner) {
			addAddress(miner);
		}

		formattedResult += '<td><span class="d-lg-none"><strong>Mined by: </strong></span>' + (miner
			? '<a class="address-string" addr="' + miner + '" href="' + getWalletAddressUrl(miner) + '">' + formatAddressString(miner, 4) + '</a>'
			: '<span class="block-meta">-</span>') + '</td>';

		//Reward. The dollar value fills in once the prices are in
		formattedResult += '<td><span class="d-lg-none"><strong>Reward: </strong></span><span class="block-reward">' + pendingCell() + '</span> <span class="text-light reward-usd"></span></td>';

		//Fees
		formattedResult += '<td><span class="d-lg-none"><strong>Fees: </strong></span><span class="block-fees">' + pendingCell() + '</span></td>';

		//Size
		formattedResult += '<td><span class="d-lg-none"><strong>Size: </strong></span><span class="block-size">' + pendingCell() + '</span></td>';

		formattedResult += '</tr>';
	}

	if (formattedResult == '') {
		formattedResult = '<tr><td colspan="8">No blocks.</td></tr>';
	}

	$('#transactionsTableBody').html(formattedResult);

	for (const header of headers) {
		if (blockDetails.has(header.id)) {
			showBlockDetails(header.id);
		}
	}

	getAddressesInfo();
}

function pendingCell() {
	return '<span class="block-meta">…</span>';
}

function getMinerAddress(header) {
	try {
		return qfleetSDKcore.ErgoAddress.fromPublicKey(header.powSolutions.pk, getFleetNetwork()).toString();
	} catch (e) {
		return undefined;
	}
}

//Full blocks for the headers not read yet, a few at a time, newest first
async function loadBlockDetails(headers) {
	const wanted = headers.filter(header => !blockDetails.has(header.id) && $('#transactionsTableBody tr[data-id="' + header.id + '"]').length > 0);

	for (let i = 0; i < wanted.length; i += BLOCK_DETAIL_BATCH) {
		const batch = wanted.slice(i, i + BLOCK_DETAIL_BATCH);
		const blocks = await fetchFullBlocks(batch.map(header => header.id));

		for (const header of batch) {
			const block = blocks.find(item => item && item.header && item.header.id == header.id);

			blockDetails.set(header.id, block ? summarizeBlock(block) : null);
			showBlockDetails(header.id);
		}
	}
}

//One GET per block: some nodes turn POST /blocks/headerIds away now and then. A failed block is
//asked again a little later before its cells give up
const BLOCK_DETAIL_RETRIES = 2;
const BLOCK_DETAIL_RETRY_MS = 3000;

function fetchFullBlocks(ids) {
	return Promise.all(ids.map(fetchFullBlock));
}

async function fetchFullBlock(id) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await LiteNode.get('blocks/' + id);
		} catch (error) {
			if (attempt >= BLOCK_DETAIL_RETRIES || error.kind == 'notfound') {
				console.warn('Block unavailable:', id, error);
				return null;
			}

			await new Promise(resolve => setTimeout(resolve, BLOCK_DETAIL_RETRY_MS * (attempt + 1)));
		}
	}
}

function summarizeBlock(block) {
	const transactions = (block.blockTransactions && block.blockTransactions.transactions) || [];
	const feeTree = getFeeErgoTree();
	let fees = new BigNumber(0);

	for (const tx of transactions) {
		for (const box of tx.outputs || []) {
			if (box.ergoTree == feeTree) {
				fees = fees.plus(box.value.toString());
			}
		}
	}

	return {
		transactionsCount: transactions.length,
		reward: getBlockReward(transactions, block.header.powSolutions && block.header.powSolutions.pk),
		fees: fees.toNumber(),
		size: block.size
	};
}

let feeErgoTree = null;

function getFeeErgoTree() {
	if (feeErgoTree === null) {
		feeErgoTree = qfleetSDKcore.ErgoAddress.fromBase58(FEE_ADDRESS).ergoTree;
	}

	return feeErgoTree;
}

//The block reward is the coinbase output locked to the miner's key. Since EIP-27 that box also
//carries re-emission tokens, one per nanoERG the miner must pass on, so they are taken off
function getBlockReward(transactions, minerPk) {
	const coinbase = transactions && transactions[0];

	if (!coinbase || !minerPk) {
		return undefined;
	}

	const rewardBox = coinbase.outputs.find(box => box.ergoTree && box.ergoTree.includes(minerPk));

	if (!rewardBox) {
		return undefined;
	}

	const emissionTokens = new Set((coinbase.outputs[0].assets || []).map(asset => asset.tokenId));
	let reward = new BigNumber(rewardBox.value.toString());

	for (const asset of rewardBox.assets || []) {
		if (emissionTokens.has(asset.tokenId)) {
			reward = reward.minus(asset.amount.toString());
		}
	}

	return reward.toNumber();
}

function showBlockDetails(id) {
	const row = $('#transactionsTableBody tr[data-id="' + id + '"]');
	const details = blockDetails.get(id);
	const none = '<span class="block-meta">-</span>';

	if (row.length == 0) {
		return;
	}

	row.find('.block-txs').html(details ? details.transactionsCount : none);
	row.find('.block-reward').html(details && details.reward !== undefined ? formatErgValueString(details.reward) : none);
	row.find('.block-fees').html(details ? formatErgValueString(details.fees) : none);
	row.find('.block-size').html(details ? formatKbSizeString(details.size) : none);

	fillRewardUsd(row);
}

function fillRewardUsd(rows = $('#transactionsTableBody tr[data-id]')) {
	if (!pricesReady) {
		return;
	}

	rows.each(function() {
		const details = blockDetails.get($(this).attr('data-id'));

		if (details && details.reward !== undefined) {
			$(this).find('.reward-usd').html(formatAssetDollarPriceString(details.reward, ERG_DECIMALS, 'ERG'));
		}
	});
}

//The first page follows the chain: a cheap /info check every AUTO_UPDATE_INTERVAL while the tab is visible,
//and a reload of the rows only when a new block is in. Older pages stay as loaded
const AUTO_UPDATE_INTERVAL = 15000;

function startAutoUpdate(page) {
	if (Number(offset) != 0) {
		return;
	}

	let shownTip = page.tip;
	let checking = false;

	const check = () => {
		if (checking || document.hidden) {
			return;
		}

		checking = true;

		fetchTipHeight()
		.then(tip => {
			if (tip <= shownTip) {
				return;
			}

			return fetchPageHeaders(tip).then(headers => {
				const newPage = { tip: tip, headers: headers };

				renderBlocks(newPage, shownTip);
				shownTip = tip;

				return loadBlockDetails(headers);
			});
		})
		.catch(error => console.warn('Latest blocks update failed:', error))
		.finally(() => {
			checking = false;
		});
	};

	setInterval(check, AUTO_UPDATE_INTERVAL);
	document.addEventListener('visibilitychange', check);
}

//The gap to the block below, when that is on the page
function getMiningTime(headers, i) {
	const below = headers[i + 1];

	return below && below.height == headers[i].height - 1 ? headers[i].timestamp - below.timestamp : undefined;
}

function formatBlockTime(ms) {
	if (ms === undefined || isNaN(ms)) {
		return '<span class="block-meta">-</span>';
	}

	const seconds = Math.max(0, Math.round(ms / 1000));
	return (seconds >= 60 ? Math.floor(seconds / 60) + 'm ' : '') + (seconds % 60) + 's';
}
