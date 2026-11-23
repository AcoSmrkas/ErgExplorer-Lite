var blockData = undefined;
var blockId = '';

$(function() {
	blockId = getWalletAddressFromUrl();

	//The block, the token icons and the prices load side by side. Both callbacks fire on failure too
	const icons = new Promise(resolve => getTokenIcons(resolve));
	const pricesLoaded = new Promise(resolve => getPrices(resolve));

	printBlock(Promise.all([icons, pricesLoaded]));

	setDocumentTitle(blockId);
});

//The url can hold a height instead of an id (search sends plain numbers here)
async function resolveBlockId() {
	if (/^\d+$/.test(blockId)) {
		blockId = await LiteNode.headerIdAt(Number(blockId));
	}

	return blockId;
}

//The full block has the size, extension and AD proofs; the indexed one has each input's box.
//A block the node has not indexed yet shows without its transactions
async function printBlock(iconsAndPrices) {
	try {
		const id = await resolveBlockId();
		const [full, indexed] = await Promise.all([
			LiteNode.get('blocks/' + id),
			LiteNode.indexedBlock(id).catch(e => {
				if (e.kind == 'notfound') return null;
				throw e;
			})
		]);

		await iconsAndPrices;

		blockData = {
			header: full.header,
			size: full.size,
			extension: full.extension,
			adProofs: full.adProofs,
			transactions: indexed ? indexed.transactions.map(prepareBlockTx) : null
		};

		printBlockSummary();
		printBlockTransactions();

		$('#blockDataHolder').show();

		getAddressesInfo();
	} catch (e) {
		showLoadError(e.kind == 'notfound' || e.kind == 'http' ? 'No results matching your query.' : e.message);
	} finally {
		$('#txLoading').hide();
	}
}

//Inputs as the explorer listed them: no spent status (this tx spent them), and a height for their block link
function prepareBlockTx(tx) {
	replaceGenesisInputs(tx);

	for (const input of tx.inputs || []) {
		delete input.spentTransactionId;

		if (input.outputBlockId == null && input.inclusionHeight != null) {
			input.outputBlockId = input.inclusionHeight;
		}
	}

	for (const output of tx.outputs || []) {
		if (output.blockId == null) {
			output.blockId = tx.blockId;
		}
	}

	return tx;
}

//Indexed nodes list the wrong inputs for the two txs that spent genesis boxes (block 1's emission
//tx and the treasury's first payout at 3850): they have no other inputs, so genesis.js's boxes go in
function replaceGenesisInputs(tx) {
	const genesisTx = typeof getGenesisTx == 'function' ? getGenesisTx() : null;

	if (genesisTx && genesisTx.outputs.some(box => box.spentTransactionId === tx.id)) {
		tx.inputs = [];
		withGenesisInputs(tx);
	}

	return tx;
}

//The header's votes are three signed bytes in hex
function formatVotes(votes) {
	if (Array.isArray(votes)) {
		return '[' + votes.join(', ') + ']';
	}

	const bytes = String(votes || '').match(/../g) || [];

	return '[' + bytes.map(hex => {
		const value = parseInt(hex, 16);
		return value > 127 ? value - 256 : value;
	}).join(', ') + ']';
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

function printBlockSummary() {
	const header = blockData.header;

	//Id
	$('#blockHeader').html('<p><a href="Copy to clipboard!" onclick="copyBlockAddress(event)">' + header.id + ' &#128203;</a></p>');

	//Time
	$('#blockTime').html('<p>' + formatDateString(header.timestamp) + '</p>');

	//Height
	$('#blockHeight').html('<p>' + nFormatter(header.height, 0, true, true) + '</p>');

	//Miner: the key that solved the block, as a wallet address
	if (header.powSolutions && header.powSolutions.pk) {
		try {
			const miner = qfleetSDKcore.ErgoAddress.fromPublicKey(header.powSolutions.pk, getFleetNetwork()).toString();

			addAddress(miner);
			$('#blockMiner').html('<a class="address-string" addr="' + miner + '" href="' + getWalletAddressUrl(miner) + '">' + formatAddressString(miner, 4) + '</a>');
		} catch (e) {
			$('#blockMiner').html('-');
		}
	}

	//Reward
	const reward = getBlockReward(blockData.transactions, header.powSolutions && header.powSolutions.pk);

	if (reward !== undefined) {
		$('#blockReward').html(formatErgValueString(reward) + ' <span class="text-light">' + formatAssetDollarPriceString(reward, ERG_DECIMALS, 'ERG') + '</span>');
		$('#blockRewardRow').show();
	}

	//Previous
	$('#blockPrevious').html('<p><a href="' + getBlockUrl(header.parentId) + '">' + header.parentId + '</a></p>');

	//Difficulty
	$('#blockDifficulty').html('<p>' + nFormatter(Number(header.difficulty)) + '</p>');

	//Extension hash
	$('#blockExtHash').html('<p>' + header.extensionHash + '</p>');

	//Version
	$('#blockVersion').html('<p>' + header.version + '</p>');

	//Votes
	$('#blockVotes').html('<p>' + formatVotes(header.votes) + '</p>');

	//AD proofs
	$('#blockAdProofs').html('<p>' + header.adProofsRoot + '</p>');

	//Transactions root
	$('#blockTransactionsRoot').html('<p>' + header.transactionsRoot + '</p>');

	//State root
	$('#blockStateRoot').html('<p>' + header.stateRoot + '</p>');

	//Bits
	$('#blockBits').html('<p>' + nFormatter(Number(header.nBits)) + '</p>');

	//Size
	$('#blockSize').html(formatKbSizeString(blockData.size));

	//PoW solutions
	const pow = header.powSolutions || {};
	$('#blockPowSolutions').html('<p>pk: ' + pow.pk + '<br>w: ' + pow.w + '<br>n: ' + pow.n + '<br>d: ' + pow.d + '</p>');

	//Extension
	const extension = blockData.extension || { fields: [] };

	$('#blockHeaderId').html('<p>' + extension.headerId + '</p>');
	$('#blockDigest').html('<p>' + extension.digest + '</p>');

	let fields = '';

	for (const field of extension.fields || []) {
		fields += '<p><strong>' + escapeHtmlString(field[0]) + ' </strong>: ' + escapeHtmlString(field[1]) + '</p>';
	}

	$('#blockFields').html(fields);

	//AD proofs
	$('#adProofs').text(blockData.adProofs && blockData.adProofs.proofBytes ? blockData.adProofs.proofBytes : '-');
}

function printBlockTransactions() {
	const blockTransactions = blockData.transactions;

	if (blockTransactions === null) {
		$('#blockTransactions').html('<div class="row w-100 div-cell-dark"><p class="m-0 p-2">This node has not indexed this block yet, so its transactions are not shown.</p></div>');
		return;
	}

	let formattedData = '';

	for (let i = 0; i < blockTransactions.length; i++) {
		let transactionData = blockTransactions[i];

		//Header
		formattedData += '<div class="row w-100 div-cell-dark border-bottom-flat"><div class="col-9" style="word-break: break-all;"><a href="' + getTransactionsUrl(transactionData.id) + '">' + transactionData.id + '</a></div><div id="txTime" class="col-3 d-flex justify-content-end">' + formatDateString(transactionData.timestamp) + '</div></div>';

		formattedData += '<div class="row w-100 two-column-holder two-column-holder-md"><div class="col-md-6 div-cell-dark p-0 block-tx-column"><h2 class="p-3">Inputs <span class="io-count">(' + transactionData.inputs.length + ')</span></h2><div class="block-tx-holder">';

		//Inputs
		formattedData += formatInputsOutputs(transactionData.inputs);

		formattedData += '</div></div><div class="col-md-6 div-cell-dark p-0 mt-4 mt-md-0 block-tx-column"><h2 class="p-3">Outputs <span class="io-count">(' + transactionData.outputs.length + ')</span></h2><div class="block-tx-holder">';

		//Outputs
		formattedData += formatInputsOutputs(transactionData.outputs, transactionData.inputs);

		formattedData += '</div></div></div><br>';
	}

	$('#blockTransactions').html(formattedData);
}

function copyBlockAddress(e) {
	copyToClipboard(e, blockId);
}
