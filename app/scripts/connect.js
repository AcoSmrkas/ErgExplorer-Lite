// The connect page: test a node, save it, and go back to where the visitor was headed

// Offered as one-click choices, never picked for the visitor
const SUGGESTED_NODES = ['https://node-p2p.ergoplatform.com'];
$(function() {
	setDocumentTitle('Pick your node');

	const current = LiteNode.getUrl();

	if (current) {
		$('#nodeUrlInput').val(current);
	}

	renderSavedNodes();
	renderSuggestedNodes();

	$('#connectForm').on('submit', function(e) {
		e.preventDefault();
		connect($('#nodeUrlInput').val());
	});
});

function getReturnPath() {
	const target = params['return'] ? decodeURIComponent(params['return']) : '/';

	// Only paths on this site, never another origin
	return /^\/(?!\/)/.test(target) && !/^\/connect/.test(target) ? target : '/';
}

const CONNECT_ERRORS = {
	none: 'Enter a node address.',
	bad: null,
	mixed: 'This page is on https, so your browser blocks a plain-http node. Use https, a node on this computer, or the release zip.',
	unreachable: 'Could not reach the node. Check the address, and that it allows requests from other sites (CORS).',
	timeout: 'The node did not answer in time.',
	noindex: 'This node has no index. Set ergo.node.extraIndex = true and let it sync.',
	syncing: 'This node is still building its index. Try again later.',
	notfound: 'That does not look like an Ergo node.',
	http: null
};

async function connect(rawUrl) {
	const button = $('#connectButton');
	button.prop('disabled', true).text('Checking…');
	showConnectStatus('', 'Checking the node…');

	try {
		const node = await LiteNode.probe(rawUrl);
		const behind = node.height - node.indexedHeight;

		LiteNode.use(node.url, node.network);

		showConnectStatus('ok', escapeHtmlString(new URL(node.url).host) + ' · '
			+ (node.network == 'testnet' ? 'Testnet' : 'Mainnet') + ' · height ' + nFormatter(node.height, 0, true, true)
			+ (behind > 2 ? ' · index ' + behind + ' blocks behind' : ''));

		setTimeout(() => window.location.assign(getReturnPath()), behind > 2 ? 1800 : 600);
	} catch (e) {
		const message = (e.kind && CONNECT_ERRORS[e.kind]) || e.message || 'Could not use this node.';
		showConnectStatus('error', escapeHtmlString(message));
		button.prop('disabled', false).text('Connect');
	}
}

function showConnectStatus(kind, html) {
	$('#connectStatus').removeClass('connect-ok connect-error')
		.addClass(kind == 'ok' ? 'connect-ok' : (kind == 'error' ? 'connect-error' : ''))
		.html(html).show();
}

function renderSavedNodes() {
	const saved = LiteNode.getSaved();
	const current = LiteNode.getUrl();

	if (saved.length == 0) {
		$('#savedNodes').hide();
		return;
	}

	const list = $('#savedNodesList').empty();

	for (const url of saved) {
		const row = $('<div class="saved-node"></div>');
		const use = $('<a href="#"></a>').text(url);
		const remove = $('<button type="button" class="btn btn-sm saved-node-remove" title="Remove"><i class="fas fa-xmark"></i></button>');

		if (url == current) {
			row.addClass('saved-node-current');
		}

		use.on('click', function(e) {
			e.preventDefault();
			$('#nodeUrlInput').val(url);
			connect(url);
		});

		remove.on('click', function() {
			LiteNode.forget(url);
			renderSavedNodes();
		});

		list.append(row.append(use, remove));
	}

	$('#savedNodes').show();
}

function renderSuggestedNodes() {
	const box = $('#suggestedNodes');

	SUGGESTED_NODES.forEach(function(url, i) {
		const link = $('<a href="#"></a>').text(new URL(url).host);

		link.on('click', function(e) {
			e.preventDefault();
			$('#nodeUrlInput').val(url);
			connect(url);
		});

		box.append(i > 0 ? ', ' : '', link);
	});
}
