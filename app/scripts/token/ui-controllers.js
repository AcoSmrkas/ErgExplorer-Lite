import { TokenState } from './state.js?v=2';

export const TokenUIControllers = {
	copyTokenAddress(e) {
		if (e) e.preventDefault();
		copyToClipboard(e, TokenState.tokenId);
	},

	showFullImgPreview() {
		$('#nftImageFullBack').fadeIn();
		$('#nftImageFullBack').css('display', 'flex');
		$('body').css('height', '100%');
		$('body').css('overflow-y', 'hidden');
		window.scrollTo(0, 0);
	},

	hideFullImgPreview() {
		$('#nftImageFullBack').fadeOut();
		$('body').css('height', 'inherit');
		$('body').css('overflow-y', 'auto');
		scrollToElement($('#nftPreviewImg'));
	},

	showImage() {
		$('#nftPreviewImg').attr('src', TokenState.imageUrl);
		$('#nftImageFull').attr('src', TokenState.imageUrl);
		$('#nftPreviewImgNsfw').hide();
	},

	// Buy goes to the Mew DEX swap, for tokens that have a pool price
	setLinks() {
		const price = typeof prices !== 'undefined' ? Number(prices[TokenState.tokenId]) : 0;

		if (!TokenState.tokenData || TokenState.isLpToken || !(price > 0)) {
			$('#tokenBuyLink').hide().attr('href', '');
			return;
		}

		const tradeUrl = 'https://dex.mewfinance.com/ergo/swap?base=0000000000000000000000000000000000000000000000000000000000000000&quote=' + TokenState.tokenId;

		$('#tokenBuyLink').show().attr('href', tradeUrl);
	}
};
