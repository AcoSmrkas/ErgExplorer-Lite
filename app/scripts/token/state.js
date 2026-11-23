// Central state for the token page. Everything here comes from the selected node.
export const TokenState = {
	tokenId: '',
	tokenData: undefined,
	nftType: undefined,
	decimals: 0,
	isLpToken: false,

	// Unspent boxes that hold the token, grouped by address
	holders: [],
	holderCount: 0,
	countedBoxes: 0,
	holdersComplete: false,
	holdersLoaded: false,
	supplyInBoxes: null,

	// The token's boxes, newest first
	boxes: [],
	boxesTotal: 0,

	// From prices.js tokenPriceList, once loaded
	market: null,
	pricesLoaded: false,

	imageUrl: null,
	currentAddress: ''
};
