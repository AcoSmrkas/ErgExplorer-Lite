var totalCoinsTransferred = 0;
var boxId = '';

$(function() {
	boxId = getWalletAddressFromUrl();

	getTokenIcons(onGotPrices);
	getPrices(onGotPrices);

	setDocumentTitle(boxId);
});

function onGotPrices() {
	if (!gotTokenIcons || !gotPrices) return;

	// The node serves no genesis box by id. genesis.js is missing when a browser pairs this script
	// with an older cached copy of the page.
	const genesisBox = typeof getGenesisBox == 'function' ? getGenesisBox(boxId) : null;

	if (genesisBox) {
		printBox(genesisBox, false);
		return;
	}

	getBox();
}

// A box in an indexed block, else an output of a tx in the node's mempool
function getBox() {
	LiteNode.box(boxId)
	.then(box => {
		const pending = !!box.pending;
		delete box.pending;

		printBox(box, pending);
	})
	.catch(function(e) {
		showLoadError(e.kind == 'notfound' || e.kind == 'http' ? 'No results matching your query.' : e.message);
		$('#txLoading').hide();
	});
}

function printBox(data, mempool) {	
	//Id
	$('#boxHeader').html('<p><a href="Copy to clipboard!" onclick="copyTransactionAddress(event)">' + data.boxId + ' &#128203;</a></p>');
	$('#boxHeaderMobile').html('<p><a href="Copy to clipboard!" onclick="copyTransactionAddress(event)">' + data.boxId.substr(0, 8) + '...' + data.boxId.substr(data.boxId.length - 4) + ' &#128203;</a></p>');

	if (mempool) {
		$('#boxTime').html('<p class="text-warning">Pending</p>');
	}

	const rawData = JSON.stringify(data, null, 4);

	// The node gives a box its height but not its block id; the block page takes either
	if (data.blockId == null && data.settlementHeight != null) {
		data.blockId = data.settlementHeight;
	}

	delete data.boxId;

	let html = $('#boxHolder').html() + formatBox(data, true);

	html += `<div class="row div-cell border-flat p-2"><p style="margin-bottom:5px;"><strong class="text-white">Raw:</strong></p><div style="word-wrap:break-word;background: var(--striped-1);" class="div-cell-dark"><pre style="overflow-wrap: anywhere;
  white-space: break-spaces; margin: 0;">${rawData}</pre></div></div>`;

	$('#boxHolder').html(html);

	$('#boxDataHolder').show();

	getAddressesInfo();

    $('#txLoading').hide();
   
	$('#infoBottom').html($('#infoTop').html());
}

function copyTransactionAddress(e) {
	copyToClipboard(e, boxId);
}