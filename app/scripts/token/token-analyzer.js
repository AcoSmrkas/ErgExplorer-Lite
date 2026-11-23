import { TokenState } from './state.js?v=2';

// How much of this token a box holds, as a BigInt
export function tokenAmountIn(box) {
	let amount = 0n;

	for (const asset of (box && box.assets) || []) {
		if (asset.tokenId == TokenState.tokenId) amount += BigInt(String(asset.amount));
	}

	return amount;
}

export const TokenAnalyzer = {
	// Unspent boxes grouped by address, largest balance first
	summarizeHolders(boxes) {
		const byAddress = new Map();
		let total = 0n;

		for (const box of boxes) {
			const amount = tokenAmountIn(box);
			if (amount <= 0n) continue;

			const address = getBoxAddress(box) || box.address;
			byAddress.set(address, (byAddress.get(address) || 0n) + amount);
			total += amount;
		}

		const holders = Array.from(byAddress, ([address, balance]) => ({ address: address, balance: balance }))
			.sort((a, b) => (a.balance < b.balance ? 1 : a.balance > b.balance ? -1 : 0));

		return { holders: holders, total: total };
	},

	// Re-stripes the visible rows of the NFT/token info blocks
	reapplyNftInfoStriping() {
		$('[id="nftInfoHolder"], [id="nftCollectionDataHolder"]').each(function() {
			$(this).find('> div:visible').each(function(index) {
				$(this).css('background-color', index % 2 === 0 ? 'var(--striped-1)' : 'transparent');
			});
		});
	}
};
