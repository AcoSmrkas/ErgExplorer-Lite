// ErgExplorer Lite: every piece of chain data comes from the indexed node the visitor picks
// (scripts/common/node.js). There are no other data hosts.
const MAINNET_FEE_ADDRESS = '2iHkR7CWvD1R4j1yZg5bkeDRQavjAaVPeTDFGGLZduHyfWMuYpmhHocX8GJoaieTx78FntzJbCBVL6rf96ocJoZdmWBL2fci7NqWgAirppPQmZ7fN9V6z13Ay6brPriBKYqLp1bT2Fk4FkFLCfdPpe';
const TESTNET_FEE_ADDRESS = 'Bf1X9JgQTUtgntaer91B24n6kP8L2kqEiQqNf1z97BKo9UbnW3WRP9VXu8BXd1LsYCiYbHJEdWKxkF5YNx5n7m31wsDjbEuB3B13ZMDVBWkepGmWfGa71otpFViHDCuvbw1uNicAQnfuWfnj8fbCa4';
var FEE_ADDRESS = MAINNET_FEE_ADDRESS;
const DONATION_ADDRESS = '9hW2SRFsgRVwfNdDMjYFnQnctfv9RtkWkRz5WyiGFQFD44S1SrP';
// What a month of hosting costs, and how many months the donation wallet's ERG must cover before we ask for funding.
const HOSTING_COST_USD_MONTHLY = 35;
const FUNDING_LOW_MONTHS = 3;

// ERG/USD oracle pool: the live box holds this NFT, and USD per ERG = 1e9 / R4
const ERG_USD_ORACLE_POOL_NFT = '011d3364de07e5a26f0c4eef0852cddb387039a921b7154ef3cab22c6eda887f';

const ERG_DECIMALS = 9;
// gulp serve runs on localhost:90xx (PORT, default 9014), where page links use #id instead of /id
const IS_DEV_ENVIRONMENT = window.location.hostname == 'localhost' && /^90[0-9][0-9]$/.test(window.location.port);
