//https://nftstorage.link
//https://cloudflare-ipfs.com
//https://gateway.ipfs.io
//https://gateway.pinata.cloud
const NFT_LINK_MAX_LENGTH = 40;
const IPFS_PROVIDER_HOSTS = [
	'https://gateway.lighthouse.storage',
	'https://nftstorage.link',
	'https://gateway.pinata.cloud'
];
const IPFS_PROVIDER_HOST = 'https://gateway.lighthouse.storage';
const NFT_TYPE = {
	Image: 'Image',
	Audio: 'Audio',
	Video: 'Video',
	ArtCollection: 'Art collection',
	FileAttachment: 'File attachment',
	MembershipToken: 'Membership token'
}

class NftInfo {
	constructor(type, hash, link, additionalLinks, data) {
		this.type = type;
		this.hash = hash;
		this.link = link;
		this.additionalLinks = additionalLinks;
		this.data = data;
	}
}

// NFT data straight from the node: each token's metadata plus its minting box, whose R7-R9 say
// what kind of NFT it is and where its media lives. onlyNft drops tokens without an NFT type.
const NFT_LOOKUP_PARALLEL = 6;

async function loadNftData(tokenIds) {
	const results = new Array(tokenIds.length);
	let next = 0;

	const worker = async () => {
		while (next < tokenIds.length) {
			const i = next++;

			try {
				results[i] = await LiteNode.tokenWithIssuingBox(tokenIds[i]);
			} catch (e) {
				results[i] = e.kind === 'notfound' ? null : e;
			}
		}
	};

	await Promise.all(Array.from({ length: Math.min(NFT_LOOKUP_PARALLEL, tokenIds.length) }, worker));

	return results;
}

function getNftsInfo(tokenIds, callback, onlyNft = true) {
	loadNftData(tokenIds).then(function(items) {
		if (items.length > 0 && items.every(item => item instanceof Error)) {
			callback(null, 'Failed to fetch NFTs data.');
			return;
		}

		let nfts = [];

		for (let i = items.length - 1; i >= 0; i--) {
			if (!items[i] || items[i] instanceof Error) continue;

			let nft = processNftData(items[i]);

			if (!onlyNft || nft.isNft) {
				nfts.push(nft);
			}
		}

		if (nfts.length > 0) {
			callback(nfts, null);
		}
	});
}

// No answer at all (null, null) means the token isn't there
// With onlyNft false, any token comes back with what its minting box says
function getNftInfo(tokenId, callback, onlyNft = true) {
	LiteNode.tokenWithIssuingBox(tokenId).then(function(data) {
		let nft = processNftData(data);

		callback(nft && (nft.isNft || !onlyNft) ? nft : null, null);
	}, function(e) {
		callback(null, e.kind === 'notfound' ? null : 'Failed to fetch NFT data.');
	});
}

// NFTs this address minted: there is no index of issuers, so look through its most recent
// transactions for mints it funded (a new token takes the id of its tx's first input)
const ISSUED_NFT_SCAN_TXS = 500;
// Pages of 100 old txs can take a slow node 20 s or more
const ISSUED_NFT_SCAN_TIMEOUT_MS = 60000;

async function findIssuedTokenIds(address) {
	const ids = [];

	for (let offset = 0; offset < ISSUED_NFT_SCAN_TXS; offset += 100) {
		const page = await LiteNode.get('blockchain/transaction/byAddress/' + address + '?offset=' + offset + '&limit=100', { timeout: ISSUED_NFT_SCAN_TIMEOUT_MS });
		const items = (page && page.items) || [];

		for (const tx of items) {
			const first = tx.inputs && tx.inputs[0];

			if (!first || getBoxAddress(first) != address) continue;

			for (const output of tx.outputs || []) {
				for (const asset of output.assets || []) {
					if (asset.tokenId == first.boxId && !ids.includes(asset.tokenId)) {
						ids.push(asset.tokenId);
					}
				}
			}
		}

		if (items.length < 100) break;
	}

	return ids;
}

function getIssuedNfts(address, callback, onlyNft = true) {
	findIssuedTokenIds(address).then(function(ids) {
		if (ids.length == 0) return;

		getNftsInfo(ids.reverse(), callback, onlyNft);
	}, function() {
		callback(null, 'Failed to fetch NFT data.');
	});
}

function processNftData(nftData) {
	if (nftData == undefined) {
		return null;
	}

	let typeString = (nftData.additionalRegisters == undefined || nftData.additionalRegisters.R7 == undefined || nftData.additionalRegisters.R7.serializedValue == null ? undefined : nftData.additionalRegisters.R7.serializedValue);
	let hash = (nftData.additionalRegisters == undefined || nftData.additionalRegisters.R8 == undefined || nftData.additionalRegisters.R8.renderedValue == null ? undefined : nftData.additionalRegisters.R8.renderedValue);
	let tempLink = (nftData.additionalRegisters == undefined || nftData.additionalRegisters.R9 == undefined || nftData.additionalRegisters.R9.renderedValue == null ? undefined : nftData.additionalRegisters.R9.renderedValue.split(','));

	let additionalLinks = new Array();
	if (tempLink == undefined) {
		link = undefined;
	} else if (tempLink.length > 1) {
		link = tempLink[0].substr(1);

		for (let i = 1; i < tempLink.length; i++) {
			if (i == tempLink.length - 1) {
				tempLink[i] = tempLink[i].substr(0, tempLink[i].length - 1);
			}

			additionalLinks[i - 1] = formatLink(tempLink[i]);
		}
	} else {
		link = tempLink[0];
	}

	if (link == undefined) {
		link = formatLink(undefined);
	} else {
		link = formatLink(link);
	}

	let type = getNftType(typeString);

	let nft = new NftInfo(type, hash, link, additionalLinks, nftData);

	nft.isNft = type != undefined;

	if (nftData.cachedurl) {
		nft.cachedurl = nftData.cachedurl;
	}

	return nft;
}

function getNftType(typeString) {
	switch (typeString) {
		case '0e020101':
			return NFT_TYPE.Image;
			break;
		case '0e020102':
			return NFT_TYPE.Audio;
			break;
		case '0e020103':
			return NFT_TYPE.Video;
			break;
		case '0e020104':
			return NFT_TYPE.ArtCollection;
			break;
		case '0e02010F':
			return NFT_TYPE.FileAttachment;
			break;
		case '0e020201':
			return NFT_TYPE.MembershipToken;
			break;
		default:
			return undefined;
			break;
	}
}

function formatLink(link) {
	out = {
		url: 'None',
		ipfsCid: false
	}

	if (link == undefined) {
		return out;
	}

	link = hex2a(link);

	if (link.includes('ipfs://')) {
		out.url = link.replace('ipfs://', '');
		out.ipfsCid = true;
	} else if (link.includes('https://ipfs.infura.io')) {
		link = link.replace('https://ipfs.infura.io', IPFS_PROVIDER_HOST);
	} else {
		out.url = link;
	}

	return out;
}