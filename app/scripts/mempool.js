// The selected node's mempool, a page at a time. The node lists unconfirmed txs with their
// full boxes but no arrival times, and /info gives how many there are.
const MEMPOOL_REFRESH_MS = 20000;
// The node answers at most 100 txs a request
const MAX_PAGE = 100;
// The miners' fee contract; node boxes carry the tree, normalised ones the address too
const FEE_ERGO_TREE = '1005040004000e36100204a00b08cd0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798ea02d192a39a8cc7a701730073011001020402d19683030193a38cc7b2a57300000193c2b2a57301007473027303830108cdeeac93b1a57304';

let shownMempoolRows = null;

$(function() {
    if (!LiteNode.getUrl()) return;

    ITEMS_PER_PAGE = Math.min(Number(ITEMS_PER_PAGE) || 30, MAX_PAGE);
    offset = Math.max(0, Number(offset) || 0);

    printMempool();
    setInterval(() => {
        if (!document.hidden) printMempool(true);
    }, MEMPOOL_REFRESH_MS);
});

async function printMempool(isRefresh = false) {
    let data = null;

    try {
        const [info, items] = await Promise.all([
            LiteNode.get('info'),
            LiteNode.mempool(offset, ITEMS_PER_PAGE)
        ]);

        data = { items: items, total: Math.max(Number(info.unconfirmedCount) || 0, offset + items.length) };
    } catch (error) {
        console.warn('Mempool request failed:', error);
    }

    $('#txLoading').hide();

    if (data) {
        printMempoolPage(data, isRefresh);
    } else if (!isRefresh) {
        showLoadError('Could not load the mempool from this node.');
    }
}

function printMempoolPage(data, isRefresh) {
    const items = data.items;

    // The pool shrank past this page while it was open
    if (offset > 0 && items.length == 0) {
        offset = Math.max(0, (Math.ceil(data.total / ITEMS_PER_PAGE) - 1) * ITEMS_PER_PAGE);
        if (data.total > 0) {
            printMempool(isRefresh);
            return;
        }
    }

    setupPagination(data.total);
    $('#pagination').toggle(items.length > 0);
    $('#mempoolCount').text(data.total.toLocaleString('en-US') + (data.total == 1 ? ' transaction' : ' transactions'));

    // The refresh mostly finds nothing new: leave the rows, and any text selected in them, alone then
    const shownRows = items.map(item => item.id).join();
    if (shownRows !== shownMempoolRows) {
        shownMempoolRows = shownRows;
        $('#transactionsTableBody').html(items.length > 0
            ? items.map(formatMempoolRow).join('')
            : '<td colspan="12" class="p-2">No transactions currently in mempool.</td>');
    }

    $('#mempoolHolder').show();
}

function formatMempoolRow(item) {
    let row = '<tr>';

    //Id
    row += '<td><span class="d-lg-none"><strong>Id: </strong></span><a href="' + getTransactionsUrl(item.id) + '">' + formatAddressString(item.id, 40) + '</a></td>';

    //Inputs
    row += '<td><span class="d-lg-none"><strong>Inputs: </strong></span>' + item.inputs.length + '</td>';

    //Outputs
    row += '<td><span class="d-lg-none"><strong>Outputs: </strong></span>' + item.outputs.length + '</td>';

    //Size
    row += '<td><span class="d-lg-none"><strong>Size: </strong></span>' + formatKbSizeString(item.size) + '</td>';

    //Fee
    row += '<td><span class="d-lg-none"><strong>Fee: </strong></span>' + formatFeeHtml(item) + '</td>';

    return row + '</tr>';
}

function formatFeeHtml(item) {
    const fee = item.outputs
        .filter(output => output.address === FEE_ADDRESS || output.ergoTree === FEE_ERGO_TREE)
        .reduce((total, output) => total.plus(output.value.toString()), new BigNumber(0));

    return fee.isGreaterThan(0) ? formatErgValueString(fee.toFixed()) : '<span class="text-light">&mdash;</span>';
}
