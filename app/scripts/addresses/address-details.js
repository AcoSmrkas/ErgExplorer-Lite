import { AddressState } from './state.js';
import { detectContractFromErgotree } from './transaction-analyzer.js?v=9';

/**
 * The chip next to the address: the contract's name when its script matches one in the
 * shipped catalog (contract-names.js).
 */
export const AddressDetails = {
	printAddressDetails() {
		this._reset();
		this._showDetectedContractName();
	},

	_reset() {
		$('#addressName').empty();
		$('#addressNameHolder').hide();
		$('#addressDetailsHolder').hide();
	},

	_showDetectedContractName() {
		const contractName = this._detectContractName();
		if (!contractName) return;

		$('#addressName').text(contractName);
		$('#addressNameHolder').show();
		$('#addressDetailsHolder').css('display', 'flex');
	},

	// A P2S address carries its whole script, so it is matched without any tx;
	// otherwise a box of the address in its latest tx has the script
	_detectContractName() {
		try {
			const ergoTree = qfleetSDKcore.ErgoAddress.fromBase58(AddressState.walletAddress).ergoTree;
			const name = detectContractFromErgotree(ergoTree);
			if (name) return name;
		} catch (error) {}

		const tx = AddressState.transactionsData && AddressState.transactionsData.items
			? AddressState.transactionsData.items[0]
			: null;
		if (!tx) return null;

		const box = [...(tx.inputs || []), ...(tx.outputs || [])].find(item => item.address === AddressState.walletAddress && item.ergoTree);

		return box ? detectContractFromErgotree(box.ergoTree) : null;
	}
};
