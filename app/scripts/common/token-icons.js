//Lite has no icon database: a token has an icon only if its thumbnail ships in images/tokens/thumbs
//(listed in token-thumb-ids.js). getTokenIcons() stays so pages can keep calling it.
var tokenIconsDb = {};
var gotTokenIcons = true;

for (const id of (typeof TOKEN_THUMB_IDS !== 'undefined' ? TOKEN_THUMB_IDS : [])) {
	tokenIconsDb[id] = '/images/tokens/thumbs/' + id + '.webp';
}

function getTokenIcons(callback) {
	if (callback) {
		callback();
	}
}

function hasIcon(tokenId) {
	return !!tokenIconsDb[tokenId];
}

function getIcon(tokenId) {
	return tokenIconsDb[tokenId] || undefined;
}

//Lists show icons at 18px, so they load a 64px thumbnail made by tools/token-thumbs.js. The originals
//are up to 3 MB. A token that has no thumbnail yet falls back to its full icon.
function getTokenThumbAttrs(tokenId, fullSrc) {
	if (!/^[0-9a-f]{64}$/.test(tokenId)) {
		return 'src="' + fullSrc + '"';
	}

	const escapedSrc = fullSrc.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

	return 'src="/images/tokens/thumbs/' + tokenId + '.webp" data-full-src="' + escapedSrc + '" onerror="onTokenThumbError(this)"';
}

//The token page shows its icon at 88px, so it loads the larger thumbnail, with the same fallback
function setLargeTokenThumb(element, tokenId, fullSrc) {
	if (!/^[0-9a-f]{64}$/.test(tokenId)) {
		element.src = fullSrc;
		return;
	}

	element.dataset.fullSrc = fullSrc;
	element.onerror = () => onTokenThumbError(element);
	element.src = '/images/tokens/thumbs/' + tokenId + '-176.webp';
}

function onTokenThumbError(element) {
	const fullSrc = element.dataset.fullSrc;

	if (fullSrc) {
		delete element.dataset.fullSrc;
		element.src = fullSrc;
	} else {
		element.remove();
	}
}
