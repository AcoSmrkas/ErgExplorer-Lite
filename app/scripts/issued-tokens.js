// Recently minted tokens, found by walking back through recent blocks on the node. A node has no
// token index to search by name, so this lists mints newest first: a new token takes the id of its
// tx's first input box. Each step reads BLOCKS_PER_STEP blocks, BLOCK_BATCH at a time.
const BLOCKS_PER_STEP = 30;
const BLOCK_BATCH = 10;

var nextHeight = null;
var oldestScanned = null;
var newestScanned = null;
var shownTokens = 0;
var scanning = false;

$(function() {
	$('#tokenIdInput').on('keydown', function(e) {
		if (e.key === 'Enter') openTokenId();
	});

	loadMoreTokens();
});

function openTokenId() {
	const id = ($('#tokenIdInput').val() || '').trim().toLowerCase();

	if (!/^[0-9a-f]{64}$/.test(id)) {
		$('#tokenIdError').text('Enter a 64-character token ID.').show();
		return;
	}

	$('#tokenIdError').hide();
	goToTokenUrl(id);
}

function escapeText(text) {
	return String(text == null ? '' : text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function startHeight() {
	const data = await LiteNode.get('blockchain/indexedHeight');

	return Number(data.indexedHeight);
}

// Header ids for heights from..to, newest first
async function headerIds(from, to) {
	const headers = await LiteNode.get('blocks/chainSlice?fromHeight=' + from + '&toHeight=' + to);

	return (headers || [])
		.filter(header => header.height >= from && header.height <= to)
		.sort((a, b) => b.height - a.height);
}

// Mints in the given blocks: { id, box, txId, height, timestamp }, newest first
function findMints(blocks) {
	const mints = [];

	blocks.sort((a, b) => b.header.height - a.header.height);

	for (const block of blocks) {
		const txs = (block.transactions || []).slice().reverse();

		for (const tx of txs) {
			const first = tx.inputs && tx.inputs[0];
			if (!first) continue;

			for (const output of tx.outputs || []) {
				if ((output.assets || []).some(asset => asset.tokenId == first.boxId)) {
					mints.push({ id: first.boxId, box: output, txId: tx.id, height: block.header.height, timestamp: block.header.timestamp });
					break;
				}
			}
		}
	}

	return mints;
}

async function scanStep() {
	if (nextHeight == null) {
		nextHeight = await startHeight();
		newestScanned = nextHeight;
	}

	const to = nextHeight;
	const from = Math.max(1, to - BLOCKS_PER_STEP + 1);
	const headers = await headerIds(from, to);
	const ids = headers.map(header => header.id);
	const batches = [];

	for (let i = 0; i < ids.length; i += BLOCK_BATCH) {
		batches.push(LiteNode.post('blockchain/block/byHeaderIds', ids.slice(i, i + BLOCK_BATCH)));
	}

	const mints = findMints((await Promise.all(batches)).flatMap(blocks => blocks || []));

	nextHeight = from - 1;
	oldestScanned = from;

	return mints;
}

async function describeMints(mints) {
	const meta = await LiteNode.tokens(mints.map(mint => mint.id));

	return mints.map(function(mint) {
		const m = meta.get(mint.id) || {};
		const token = {
			id: mint.id,
			name: m.name || '',
			description: m.description || '',
			decimals: m.decimals || 0,
			emissionAmount: m.emissionAmount != null ? m.emissionAmount : String(mint.box.assets.find(asset => asset.tokenId == mint.id).amount),
			additionalRegisters: LiteNode.explorerRegisters(mint.box.additionalRegisters)
		};
		const nft = processNftData(token);

		return { mint: mint, token: token, type: nft ? nft.type : undefined };
	});
}

function formatMintDate(timestamp) {
	const date = new Date(Number(timestamp));

	return String(date.getDate()).padStart(2, '0') + '/' + String(date.getMonth() + 1).padStart(2, '0') + '/' + date.getFullYear()
		+ ' ' + String(date.getHours()).padStart(2, '0') + ':' + String(date.getMinutes()).padStart(2, '0');
}

function tokenRowHtml(item) {
	const token = item.token;
	const asciiArt = isAsciiArt(token.description);
	let html = '<tr>';

	html += '<td><span class="d-lg-none"><strong>Id: </strong></span><a href="' + getTokenUrl(token.id) + '">' + formatAddressString(token.id) + '</a></td>';
	html += '<td style="word-break:break-all;"><span class="d-lg-none"><strong>Name: </strong></span>' + (token.name ? escapeText(token.name) : '<span class="text-light">No name</span>') + '</td>';
	html += '<td><span class="d-lg-none"><strong>Type: </strong></span>' + tokenTypeSwitch(item.type) + '</td>';
	html += '<td><span class="d-lg-none"><strong>Amount: </strong></span>' + formatValue(getAssetValue(String(token.emissionAmount), token.decimals)) + '</td>';
	html += '<td' + (token.description ? '' : ' class="d-none d-lg-table-cell"') + '><span class="d-lg-none"><strong>Description: </strong></span><pre class="tokenDescriptionPre' + (asciiArt ? ' pre-ascii' : '') + '" style="max-height:100px;overflow-y:auto;">' + (formatNftDescription(escapeText(token.description)) || '') + '</pre></td>';
	html += '<td><span class="d-lg-none"><strong>Minted: </strong></span><a href="' + getBlockUrl(item.mint.height) + '">' + formatMintDate(item.mint.timestamp) + '</a></td>';
	html += '</tr>';

	return html;
}

async function loadMoreTokens() {
	if (scanning) return;

	scanning = true;
	$('#loadMoreTokens').prop('disabled', true);
	$('#issuedTokensLoading').show();

	try {
		const items = await describeMints(await scanStep());

		$('#issuedTokensTableBody').append(items.map(tokenRowHtml).join(''));
		shownTokens += items.length;

		$('#issuedTokensEmpty').toggle(shownTokens === 0);
		$('#issuedTokensTable').toggle(shownTokens > 0);
		$('#issuedTokensRange').text('Blocks ' + nFormatter(newestScanned, 0, true, true) + ' to ' + nFormatter(oldestScanned, 0, true, true) + '.');
		$('#loadMoreTokens').toggle(oldestScanned > 1);
		$('#issuedTokensHolder').show();
	} catch (e) {
		console.warn('Token scan failed', e);

		if (shownTokens === 0) {
			showLoadError('Couldn\'t load recent tokens. <a href="#" onclick="location.reload(); return false;">Try again</a>');
		} else {
			$('#issuedTokensRange').text('Couldn\'t load more. Try again.');
		}
	} finally {
		scanning = false;
		$('#loadMoreTokens').prop('disabled', false);
		$('#issuedTokensLoading').hide();
		$('#txLoading').hide();
	}
}

function tokenTypeSwitch(type) {
	switch (type) {
		case NFT_TYPE.Image:
			return '<span class="text-warning">NFT </span><img class="token-icon nft-icon" src="./images/nft-image.png"/>';
		case NFT_TYPE.Audio:
			return '<span class="text-warning">NFT </span><img class="token-icon nft-icon" src="./images/nft-audio.png"/>';
		case NFT_TYPE.Video:
			return '<span class="text-warning">NFT </span><img class="token-icon nft-icon" src="./images/nft-video.png"/>';
		case NFT_TYPE.ArtCollection:
			return '<span class="text-warning">NFT </span><img class="token-icon nft-icon" src="./images/nft-artcollection.png"/>';
		case NFT_TYPE.FileAttachment:
			return '<span class="text-warning">NFT </span><img class="token-icon nft-icon" src="./images/nft-file.png"/>';
		case NFT_TYPE.MembershipToken:
			return '<span class="text-warning">NFT </span><img class="token-icon nft-icon" src="./images/nft-membership.png"/>';
		default:
			return '<span class="text-info">Token</span>';
	}
}
