import { TokenState } from './state.js?v=2';
import { TokenApiClient } from './api-client.js?v=8';
import { TokenUIDisplay } from './ui-display.js?v=8';
import { TokenUIControllers } from './ui-controllers.js?v=3';
import { TokenAnalyzer } from './token-analyzer.js?v=4';
import { isLpTokenData } from '../common/lp-tokens.js?v=4';

$(function() {
	TokenState.tokenId = (getWalletAddressFromUrl() || '').toLowerCase();

	if (!/^[0-9a-f]{64}$/.test(TokenState.tokenId)) {
		$('#txLoading').hide();
		showLoadError('No results matching your query.');
		return;
	}

	setDocumentTitle(TokenState.tokenId);

	// Prices load alongside the token: Spectrum pool boxes from the node, cached for a few minutes
	const pricesLoaded = new Promise(resolve => getPrices(resolve, true));

	LiteNode.tokenWithIssuingBox(TokenState.tokenId).then(function(data) {
		onTokenLoaded(processNftData(data), pricesLoaded);
	}, function(e) {
		$('#txLoading').hide();
		showLoadError(e.kind === 'notfound'
			? 'No results matching your query.'
			: 'Couldn\'t load this token. <a href="#" onclick="location.reload(); return false;">Try again</a>');
	});
});

function blockLinkHtml(height) {
	if (height == null) return '';

	return '<p><a href="' + getBlockUrl(height) + '">' + nFormatter(Number(height), 0, true, true) + '</a></p>';
}

function addressLinkHtml(address) {
	addAddress(address);

	return '<p><a class="address-string" addr="' + address + '" href="' + getWalletAddressUrl(address) + '">' + formatLongAddressString(address) + '</a></p>';
}

function onTokenLoaded(nftInfo, pricesLoaded) {
	$('#txLoading').hide();

	const data = nftInfo.data;
	TokenState.tokenData = data;
	TokenState.decimals = Number(data.decimals) || 0;
	TokenState.isLpToken = isLpTokenData(data);

	$('#tokenHeader').html('<p><a href="Copy to clipboard!" onclick="copyTokenAddress(event)">' + data.id + ' &#128203;</a></p>');
	$('#tokenName').html('<p></p>').find('p').text(data.name || '');
	$('#tokenEmissionAmount').html('<p>' + nFormatter(getAssetValue(String(data.emissionAmount), TokenState.decimals), 0, true, true) + '</p>');
	$('#tokenDecimals').html('<p>' + TokenState.decimals + '</p>');
	$('#tokenType').html('<p>' + (nftInfo.isNft ? 'NFT' : 'Token') + '</p>');

	const asciiArt = isAsciiArt(data.description);
	$('#tokenDescription').html('<pre style="max-height:200px;overflow-y:auto;" class="tokenDescriptionPre' + (asciiArt ? ' pre-ascii' : '') + '">' + (formatNftDescription(escapeMarkup(data.description || '')) || '') + '</pre>');

	// Icons ship with the page; a priced token may also have one in Spectrum's public logo set
	const icon = getIcon(data.id);

	if (icon != undefined) {
		setLargeTokenThumb($('#tokenIconImg')[0], data.id, icon);
	}

	$('#tokenDataHolder').show();

	if (nftInfo.isNft) {
		showNftInfo(nftInfo);
		loadIssuerRegisters();
	} else {
		showTokenInfo();
	}

	if (String(data.emissionAmount) !== '1') {
		$('[id="nftCurrentAddressHolder"]').remove();
	}

	$('#holdersHolder').show();
	loadHolders();
	loadBoxes(0);

	pricesLoaded.then(function() {
		TokenState.pricesLoaded = true;
		TokenState.market = (typeof tokenPriceList !== 'undefined' ? tokenPriceList : []).find(item => item.id == TokenState.tokenId) || null;

		if (TokenState.market && getIcon(TokenState.tokenId) == undefined) {
			$('#tokenIconImg').attr('src', 'https://raw.githubusercontent.com/spectrum-finance/token-logos/master/logos/ergo/' + TokenState.tokenId + '.svg');
		}

		TokenUIControllers.setLinks();
		TokenUIDisplay.printMarketInfo();
		TokenUIDisplay.printSupplyInfo();
		TokenUIDisplay.printHolders();
		TokenUIDisplay.printBoxes();
	});
}

function showTokenInfo() {
	const data = TokenState.tokenData;

	$('#nftHolder').remove();
	$('#nftType').html('<p>Token</p>');
	$('#nftMintedAddress').html(addressLinkHtml(data.address));
	$('#nftMintedTransaction').html('<p><a href="' + getTransactionsUrl(data.transactionId) + '">' + data.transactionId + '</a></p>');
	$('#nftCreationHeight').html(blockLinkHtml(data.inclusionHeight));
	$('#tokenHolder').show();
	TokenAnalyzer.reapplyNftInfoStriping();
}

// Holders, supply, burned state and a 1/1's current owner all come from the token's unspent boxes
function loadHolders() {
	TokenApiClient.getUnspentBoxes().then(function(result) {
		const summary = TokenAnalyzer.summarizeHolders(result.boxes);

		TokenState.holders = summary.holders;
		TokenState.holderCount = summary.holders.length;
		TokenState.countedBoxes = result.boxes.length;
		TokenState.holdersComplete = result.complete;
		TokenState.supplyInBoxes = result.complete ? summary.total : null;
		TokenState.holdersLoaded = true;

		if (result.complete && result.boxes.length === 0) {
			$('[id="tokenBurned"]').show();
			$('[id="nftCurrentAddressHolder"]').remove();
			showBurnTx();
		} else {
			$('[id="nftBurnTransactionHolder"]').remove();
		}

		if (String(TokenState.tokenData.emissionAmount) === '1' && summary.holders.length > 0) {
			TokenState.currentAddress = summary.holders[0].address;
			$('[id="nftCurrentAddress"]').html(addressLinkHtml(TokenState.currentAddress));
			$('[id="nftCurrentAddressHolder"]').show();
		}

		TokenAnalyzer.reapplyNftInfoStriping();
		TokenUIDisplay.printSupplyInfo();
		TokenUIDisplay.printHolders();
	}, function(e) {
		console.warn('Holders failed', e);
		TokenUIDisplay.printHoldersFailed();
	});
}

// A burned token's newest box is the one its last tx spent
let burnTxShown = false;

function showBurnTx() {
	const newest = TokenState.boxes[0];

	if (burnTxShown || !$('#tokenBurned').is(':visible') || !newest || !newest.spentTransactionId) return;

	burnTxShown = true;
	$('[id="nftBurnTransaction"]').html('<p><a href="' + getTransactionsUrl(newest.spentTransactionId) + '">' + newest.spentTransactionId + '</a></p>');
	$('[id="nftBurnTransactionHolder"]').show();
	TokenAnalyzer.reapplyNftInfoStriping();
}

let boxesLoading = false;

function loadBoxes(offset) {
	if (boxesLoading) return;

	boxesLoading = true;
	$('#boxesMoreBtn').prop('disabled', true);

	TokenApiClient.getBoxes(offset).then(function(page) {
		TokenState.boxes = TokenState.boxes.concat(page.items);
		TokenState.boxesTotal = page.total;
		TokenUIDisplay.printBoxes();
		showBurnTx();
	}, function(e) {
		console.warn('Token boxes failed', e);
		$('#boxesLoading').hide();
	}).finally(function() {
		boxesLoading = false;
		$('#boxesMoreBtn').prop('disabled', false);
	});
}

window.loadMoreTokenBoxes = () => loadBoxes(TokenState.boxes.length);

function showNftInfo(nftInfo) {
	const data = TokenState.tokenData;

	$('#tokenHolder').remove();
	TokenState.nftType = nftInfo.type;

	$('#nftType').html('<p>' + nftInfo.type + '</p>');
	$('#nftHash').html('<p>' + (nftInfo.hash || '') + '</p>');

	if (nftInfo.type == NFT_TYPE.ArtCollection || !nftInfo.hash) {
		$('[id="nftHashHolder"]').remove();
	}

	$('#nftMintedAddress').html(addressLinkHtml(data.address));
	$('#nftMintedTransaction').html('<p><a href="' + getTransactionsUrl(data.transactionId) + '">' + data.transactionId + '</a></p>');
	$('#nftCreationHeight').html(blockLinkHtml(data.inclusionHeight));

	let fullUrl = nftInfo.link.ipfsCid ? '' : nftInfo.link.url;
	const additionalFullUrl = [];
	let linkString = fullUrl;

	if (linkString.length > NFT_LINK_MAX_LENGTH) {
		linkString = formatAddressString(linkString, NFT_LINK_MAX_LENGTH);
	}

	let urlHtml = '';
	let cidHtml = '';

	if (nftInfo.link.ipfsCid) {
		urlHtml = formatIpfsCidHtmlString(nftInfo.link.url);
		fullUrl = IPFS_GATEWAYS[0] + '/ipfs/' + nftInfo.link.url;

		cidHtml = '<p>CID 1: ' + nftInfo.link.url + '</p>';
	} else {
		urlHtml = '<p><a target="_new" href="' + fullUrl + '">' + linkString + '</a></p>';
		$('#ipfsCidHolder').remove();
	}

	if (nftInfo.additionalLinks && nftInfo.additionalLinks.length > 0) {
		let formattedLinksHtml = '<p>URL 1:</p>' + urlHtml;

		for (let i = 0; i < nftInfo.additionalLinks.length; i++) {
			const additionalLink = nftInfo.additionalLinks[i];
			let fullAdditionalUrlString = '';

			if (additionalLink.ipfsCid) {
				fullAdditionalUrlString = formatIpfsCidHtmlString(additionalLink.url);
				additionalFullUrl.push(IPFS_GATEWAYS[0] + '/ipfs/' + additionalLink.url);
				cidHtml += '<p>CID ' + (i + 2) + ': ' + additionalLink.url + '</p>';
			} else {
				fullAdditionalUrlString = '<a target="_new" href="' + additionalLink.url + '">' + formatAddressString(additionalLink.url, NFT_LINK_MAX_LENGTH) + '</a>';
				additionalFullUrl.push(additionalLink.url);
			}

			formattedLinksHtml += '<br><p>URL ' + (i + 2) + ': </p>' + fullAdditionalUrlString;
		}

		$('#nftLink').html(formattedLinksHtml);
		$('#ipfsCid').html(cidHtml);
	} else {
		$('#nftLink').html(urlHtml);

		if (nftInfo.link.ipfsCid) {
			$('#ipfsCid').html('<p>' + nftInfo.link.url + '</p>');
		}
	}

	TokenState.imageUrl = fullUrl;

	const cid = nftInfo.link.ipfsCid ? nftInfo.link.url : null;

	if (nftInfo.type == NFT_TYPE.Image) {
		$('#nftPreviewImg').show();

		showImageFrom(cid ? IPFS_GATEWAYS.map(host => host + '/ipfs/' + cid) : [fullUrl]);

		if (nftInfo.link.url.substr(0, 19) == 'data:image/svg+xml;') {
			$('#nftPreviewImg').css('width', '200px');
			$('#nftImageFull').css('width', '400px');
		}
	} else if (nftInfo.type == NFT_TYPE.Audio) {
		playFrom(document.getElementById('nftAudio'), $('#nftPreviewAudioSource')[0], cid ? IPFS_GATEWAYS.map(host => host + '/ipfs/' + cid) : [fullUrl]);
		$('#nftPreviewAudio').show();

		$('#nftPreviewImgHolder').hide().removeClass('col-lg-3');
		$('#nftInfoHolder').removeClass('col-lg-9');

		// An audio NFT's second link is usually its cover
		if (additionalFullUrl.length > 0) {
			$('#nftPreviewImg').attr('src', additionalFullUrl[0]);
			$('#nftImageFull').attr('src', additionalFullUrl[0]);
		}
	} else if (nftInfo.type == NFT_TYPE.Video) {
		playFrom(document.getElementById('nftPreviewVideo'), $('#nftPreviewVideoSource')[0], cid ? IPFS_GATEWAYS.map(host => host + '/ipfs/' + cid) : [fullUrl]);
		$('#nftPreviewVideo').show();

		$('#nftPreviewImgHolder').removeClass('col-lg-3').addClass('col-xl-5').css('min-height', '0');
		$('#nftInfoHolder').removeClass('col-lg-9').addClass('col-xl-7');
	} else {
		$('#nftPreviewImgHolder').hide().css('min-height', '0');
		$('#nftInfoHolder').removeClass('col-lg-9').addClass('col-12');
	}

	$('#nftHolder').show();
	TokenAnalyzer.reapplyNftInfoStriping();
}

function traitCard(label, value) {
	return '<div class="bg-background" style="padding:5px; border-radius:5px;box-sizing: border-box; place-content: space-between;text-align:center;">'
		+ '<p class="erg-span">' + escapeHtml(label) + '</p><p>' + escapeHtml(value) + '</p></div>';
}

// Descriptions may be JSON, so quotes stay as they are
function escapeMarkup(text) {
	return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeHtml(text) {
	return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// EIP-24 keeps an NFT's traits (or a collection's social links) in R6 of the box its mint spent first
function loadIssuerRegisters() {
	TokenApiClient.getIssuerBox().then(function(box) {
		const regs = box && box.additionalRegisters;
		const r6 = regs && (typeof regs.R6 === 'string' ? regs.R6 : regs.R6 && regs.R6.serializedValue);

		if (!r6) return;

		let constant;

		try {
			constant = qfleetSDK.SConstant.from(hexToBytes(r6));
		} catch (e) {
			return;
		}

		const data = constant && constant.data;
		if (!data || !data.length) return;

		try {
			if (TokenState.nftType == NFT_TYPE.ArtCollection) {
				showSocialLinks(data);
			} else {
				showTraits(data);
			}
		} catch (e) {
			console.warn('Could not read NFT traits', e);
		}

		TokenAnalyzer.reapplyNftInfoStriping();
	});
}

function showSocialLinks(data) {
	let hasTwitter = false;
	let hasInstagram = false;

	for (const pair of data) {
		const key = bytesToString(pair[0]);
		const value = bytesToString(pair[1]);

		if (key == 'instagram') {
			$('#instagramLink').prop('href', 'https://www.instagram.com/' + value.replace('@', '')).text(value);
			$('#instagramHolder').show();
			hasInstagram = true;
		} else if (key == 'twitter') {
			$('#twitterLink').prop('href', 'https://twitter.com/' + value.replace('@', '')).text(value);
			$('#twitterHolder').show();
			hasTwitter = true;
		}
	}

	if (!hasTwitter) $('#twitterHolder').remove();
	if (!hasInstagram) $('#instagramHolder').remove();
}

function showTraits(data) {
	const properties = Array.isArray(data[0]) ? data[0] : [];
	const numeric = Array.isArray(data[1]) ? data[1] : [];
	const stats = Array.isArray(numeric[0]) ? numeric[0] : [];
	const levels = Array.isArray(numeric[1]) ? numeric[1] : [];

	if (properties.length > 0) {
		$('#nftProperties').html(properties.map(pair => traitCard(bytesToString(pair[0]), bytesToString(pair[1]))).join(''));
		$('#nftPropertiesHolder').show();
	}

	if (stats.length > 0) {
		$('#nftStats').html(stats.map(pair => traitCard(bytesToString(pair[0]), pair[1][0] + ' of ' + pair[1][1])).join(''));
		$('#nftStatsHolder').show();
	}

	if (levels.length > 0) {
		$('#nftLevels').html(levels.map(pair => traitCard(bytesToString(pair[0]), pair[1][0] + ' of ' + pair[1][1])).join(''));
		$('#nftLevelsHolder').show();
	}
}

window.onTokenIconLoaded = function() {
	$('#tokenDescriptionHolderRight').removeClass('col-xl-10 col-lg-9').addClass('col-xl-8 col-lg-7');
	$('#tokenIcon').addClass('col-12 col-lg-2 d-flex').show();
};

// An audio NFT's cover image shows once it loads
window.onNftImageLoad = function() {
	if (TokenState.nftType != NFT_TYPE.Audio) return;

	$('#nftPreviewImgHolder').show().removeClass('col-lg-3').addClass('col-lg-4');
	$('#nftPreviewImg').show();
	$('#nftInfoHolder').removeClass('col-lg-9').addClass('col-lg-8');
};

// IPFS gateways in the order tried: Lighthouse answers reliably, the others are fallbacks
const IPFS_GATEWAYS = ['https://gateway.lighthouse.storage'].concat(IPFS_PROVIDER_HOSTS.filter(host => host != 'https://gateway.lighthouse.storage'));
const MEDIA_TIMEOUT_MS = 15000;

// Shows the first of the urls that loads, trying them one at a time
function showImageFrom(urls, index = 0) {
	if (index >= urls.length) return;

	const probe = new Image();
	let done = false;
	const next = () => {
		if (done) return;
		done = true;
		showImageFrom(urls, index + 1);
	};
	const timer = setTimeout(next, MEDIA_TIMEOUT_MS);

	probe.onload = () => {
		if (done) return;
		done = true;
		clearTimeout(timer);
		TokenState.imageUrl = urls[index];
		$('#nftPreviewImg').attr('src', urls[index]);
		$('#nftImageFull').attr('src', urls[index]);
	};
	probe.onerror = () => {
		clearTimeout(timer);
		next();
	};
	probe.src = urls[index];
}

// Plays from the first url, moving on to the next when the source fails
function playFrom(player, source, urls) {
	let index = 0;

	source.addEventListener('error', () => {
		if (++index < urls.length) {
			source.src = urls[index];
			player.load();
		}
	});

	source.src = urls[0];
	player.load();
}

window.copyTokenAddress = (e) => TokenUIControllers.copyTokenAddress(e);
window.showFullImgPreview = () => TokenUIControllers.showFullImgPreview();
window.hideFullImgPreview = () => TokenUIControllers.hideFullImgPreview();
window.showImage = () => TokenUIControllers.showImage();
