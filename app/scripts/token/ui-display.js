import { TokenState } from './state.js?v=2';
import { tokenAmountIn } from './token-analyzer.js?v=4';

const TOP_HOLDERS = 10;

function tokenUsdPrice() {
	if (typeof prices === 'undefined') return 0;

	const price = Number(prices[TokenState.tokenId]);
	return Number.isFinite(price) && price > 0 ? price : 0;
}

function tokenUnits(raw) {
	return Number(getAssetValue(String(raw), TokenState.decimals));
}

function dollarHtml(raw) {
	const price = tokenUsdPrice();
	if (!price) return '';

	const value = tokenUnits(raw) * price;
	if (!Number.isFinite(value) || value <= 0) return '';

	return ' <span class="text-light">' + formatDollarPriceString(value) + '</span>';
}

function amountHtml(raw) {
	return formatAssetValueString(String(raw), TokenState.decimals, 4) + ' ' + assetTitle();
}

function assetTitle() {
	return getAssetTitleParams(TokenState.tokenData, TokenState.tokenId, TokenState.tokenData.name, false);
}

function stripe(selector) {
	$(selector + ' > div:visible').each(function(index) {
		$(this).css('background-color', index % 2 === 0 ? 'var(--striped-1)' : '');
	});
}

function emission() {
	try {
		return BigInt(String(TokenState.tokenData.emissionAmount));
	} catch (e) {
		return 0n;
	}
}

// Percent of a BigInt amount over a BigInt total, to 2 places
function percentOf(amount, total) {
	if (total <= 0n) return '';

	const percent = Number(amount * 1000000n / total) / 10000;

	return amount > 0n && percent < 0.01 ? '<0.01%' : percent.toFixed(2) + '%';
}

export const TokenUIDisplay = {
	// What the unspent boxes add up to. Only when every box was counted
	printSupplyInfo() {
		if (!TokenState.tokenData || !TokenState.holdersComplete || TokenState.supplyInBoxes == null) {
			$('#supplyHolder').hide();
			return;
		}

		const inBoxes = TokenState.supplyInBoxes;
		const burned = emission() - inBoxes;
		const price = tokenUsdPrice();

		$('#tokenLiquidSupply').html(amountHtml(inBoxes) + dollarHtml(inBoxes));
		$('#tokenLiquidSupplyRow').show();

		$('#tokenBurnedSupplyRow').toggle(burned > 0n);
		if (burned > 0n) {
			$('#tokenBurnedSupply').html(amountHtml(burned) + ' <span class="text-light">(' + percentOf(burned, emission()) + ')</span>');
		}

		$('#tokenMarketCapRow').toggle(price > 0 && inBoxes > 0n);
		if (price > 0 && inBoxes > 0n) {
			$('#tokenMarketCap').html('$' + nFormatter(tokenUnits(inBoxes) * price, 2, true));
		}

		$('#supplyHolder').show();
		stripe('#supplyInfoHolder');
	},

	// Price and pool liquidity from the AMM pools prices.js reads
	printMarketInfo() {
		const market = TokenState.market;
		const price = tokenUsdPrice();

		if (!market || TokenState.isLpToken) {
			$('#priceInfo').hide();
			return;
		}

		const ergUsd = typeof prices !== 'undefined' ? Number(prices['ERG']) : 0;
		let priceHtml = formatValue(market.price_erg, 9, true) + ' <span class="erg-span">ERG</span>';

		if (price) {
			priceHtml = '$' + formatValue(price, 2, true) + ' <span class="text-light">(' + priceHtml + ')</span>';
		}

		let liquidityHtml = nFormatter(market.liquidity_erg, 2, true) + ' <span class="erg-span">ERG</span>';

		if (ergUsd > 0) {
			liquidityHtml += ' <span class="text-light">($' + nFormatter(market.liquidity_erg * ergUsd, 2, true) + ')</span>';
		}

		$('#usdPrice').html(priceHtml);
		$('#tokenLiquidity').html(liquidityHtml);
		$('#tokenPools').html(market.pools);
		$('#priceInfo').show();
		stripe('#marketInfoHolder');
	},

	printHolders() {
		if (!TokenState.tokenData || !TokenState.holdersLoaded) return;

		const holders = TokenState.holders;

		if (holders.length === 0) {
			$('#holdersHolder').hide();
			return;
		}

		// Shares of what was counted when every box was seen, else of the amount minted
		const total = TokenState.holdersComplete ? TokenState.supplyInBoxes : emission();
		let html = '';

		for (let i = 0; i < Math.min(TOP_HOLDERS, holders.length); i++) {
			const holder = holders[i];
			const percent = percentOf(holder.balance, total);

			addAddress(holder.address);

			html += '<tr>';
			html += '<td>#' + (i + 1) + ' <a class="address-string" addr="' + holder.address + '" href="' + getWalletAddressUrl(holder.address) + '">' + formatAddressString(holder.address, 4) + '</a></td>';
			html += '<td>' + amountHtml(holder.balance) + dollarHtml(holder.balance)
				+ '<span style="float:right;" class="d-inline d-lg-none text-white"> ' + percent + '</span></td>';
			html += '<td class="d-none d-lg-table-cell" style="text-align:right;">' + percent + '</td>';
			html += '</tr>';
		}

		const count = nFormatter(TokenState.holderCount, 0, true, true);

		$('#holdersTitle').text(holders.length > TOP_HOLDERS ? 'Top ' + TOP_HOLDERS + ' holders' : 'Holders');
		$('#totalHolderCount').text(TokenState.holdersComplete ? '(of ' + count + ')' : '(' + count + '+)');
		$('#holdersNote').text(TokenState.holdersComplete ? '' : 'Counted from ' + nFormatter(TokenState.countedBoxes, 0, true, true) + ' of the boxes holding this token.')
			.toggle(!TokenState.holdersComplete);

		$('#holdersTableBody').html(html);
		$('#holdersLoading').hide();
		$('#holdersTable').show();
		$('#holdersHolder').show();

		getAddressesInfo();
	},

	printHoldersFailed() {
		$('#holdersLoading').hide();
		$('#holdersNote').text('Couldn\'t load holders.').show();
		$('#holdersHolder').show();
	},

	// The token's boxes, newest first, each with the tx that made it and the one that spent it
	printBoxes() {
		const boxes = TokenState.boxes;

		$('#boxesLoading').hide();

		if (boxes.length === 0) {
			$('#boxesHolder').hide();
			return;
		}

		let html = '';

		for (const box of boxes) {
			const address = getBoxAddress(box) || box.address;
			const amount = tokenAmountIn(box);
			const height = box.inclusionHeight;

			addAddress(address);

			html += '<tr>';
			const blockLink = '<a href="' + getBlockUrl(height) + '">' + nFormatter(height, 0, true, true) + '</a>';

			html += '<td><span class="d-lg-none"><strong>Box: </strong></span><a href="' + getBoxUrl(box.boxId) + '">' + formatAddressString(box.boxId, 10) + '</a>'
				+ '<span class="d-inline d-lg-none float-end"><strong>Block: </strong>' + blockLink + '</span></td>';
			html += '<td class="d-none d-lg-table-cell">' + blockLink + '</td>';
			html += '<td><span class="d-lg-none"><strong>Address: </strong></span><a class="address-string" addr="' + address + '" href="' + getWalletAddressUrl(address) + '">' + formatAddressString(address, 10) + '</a></td>';
			html += '<td><span class="d-lg-none"><strong>Amount: </strong></span><span class="text-white">' + amountHtml(amount) + dollarHtml(amount) + '</span></td>';
			html += '<td class="d-none d-lg-table-cell"><a href="' + getTransactionsUrl(box.transactionId) + '">' + formatAddressString(box.transactionId, 10) + '</a></td>';
			html += '<td><span class="d-lg-none"><strong>Spent: </strong></span>' + (box.spentTransactionId
				? '<a href="' + getTransactionsUrl(box.spentTransactionId) + '">' + formatAddressString(box.spentTransactionId, 10) + '</a>'
				: '<span class="text-success">Unspent</span>') + '</td>';
			html += '</tr>';
		}

		$('#boxesTableBody').html(html);
		$('#boxesTable').show();
		$('#boxesHolder').show();

		const more = TokenState.boxesTotal == null || boxes.length < TokenState.boxesTotal;
		$('#boxesMore').toggle(more);
		$('#boxesCount').text(TokenState.boxesTotal ? '(' + nFormatter(TokenState.boxesTotal, 0, true, true) + ')' : '');

		getAddressesInfo();
	}
};
