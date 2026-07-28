// Sepolia (chainId 11155111) BTR DEX venue — generated from
// dex/evm/deployments/11155111.{deploy,pools}.json + sepolia-risk-params.json (owner-FINAL 2026-07-24).
// SoT for collector protocol-ingest config. No runtime JSON fetch. Regenerate on redeploy.

import type { Address } from '../eth/types.js';

export const SEPOLIA_CHAIN_ID = 11155111;
/** Ingest start block. MUST be at or below the first pool log, not the last deploy tx:
 *  the pools were created and seeded from 11340141, so 11343575 (the previous value)
 *  put all 26 `Deposited` events out of scope and they were never indexed. */
export const SEPOLIA_DEPLOY_BLOCK = 11340000;

/** Pool asset ERC20s (24 unique: 17 stable + 9 volatile, USDC/USDT shared). Keyed by canonical symbol. */
export const SEPOLIA_TOKENS: Record<string, Address> = {
  USDC: '0x5AFaFEC0495e362976E1cA87D1Ce044AC49A39E9' as Address,
  USDT: '0xa7Dc0A8815acCbDfc22619b6F65b2dE710Eb2A7B' as Address,
  USDE: '0xfe1Dc89FfE61CcDe653Fc05Bc5D6108417E5AF8e' as Address,
  USDS: '0x878e27566Ab9E32534e306C26388dFcE82D0AB46' as Address,
  DAI: '0x66dbe40c8dc03f2C9e7A187F253e8889A03640c8' as Address,
  USD1: '0x0326748d09eD77D8C15fbf04d6277aE4CAF033f3' as Address,
  USDG: '0xeE12a7072779a4ab85f2DD2a1E163DbF164291f9' as Address,
  PYUSD: '0x626eb915d4a4136F7c00352A54378d3A322488da' as Address,
  RLUSD: '0x35c625c07ed4a9123ab863f6e8722c9210c808A3' as Address,
  syrupUSDC: '0xA1fe5aDcB5f5DD1c21d372D18E7dF7fa5bfbc09e' as Address,
  USDF: '0xee7D69C52c2F183A0389374E82ca841c5a463573' as Address,
  U: '0x89A9cD1dd6DE3ab7152EF9c7C5496c2946334D0D' as Address,
  GHO: '0xF36eEe851bf3e76E464609a717bAE4a239A8cC7b' as Address,
  TUSD: '0xbAA18E707E7b7fE9d1c0e4CeA61603035cb30C55' as Address,
  USDTB: '0x49C710167A4b486F20f9437485D865D653806310' as Address,
  FDUSD: '0x432A3248e91d8B6fd41A487dE8886E0B44Fb7a6D' as Address,
  AUSD: '0x96f953bAC2FF3829B4a526cacd858A5a22327E03' as Address,
  WETH: '0x6db2Ca217808f8d534d1e932396310aD612c0832' as Address,
  WBTC: '0x66F3F73f8224Ed79c532a0C220003aC41A695Abb' as Address,
  cbBTC: '0xf9190B9Ef055fdBbb70135C87fBf1A919932236f' as Address,
  BNB: '0x7A11aFd4953DC9E696C92a9ee7FA960f29D9e59e' as Address,
  XAUT: '0x636647b9cd4a8A4fDD46F1576adb8A5FdFe01a34' as Address,
  PAXG: '0xFF4dCC8C224fD40a850B452afad4CE018AA368A8' as Address,
  EURC: '0x05705Ac3915A094b345629B02D5aa8d52Bb99DDB' as Address,
  QCAD: '0x7730C2C1b3945cE1380093d8C0E4Dfb6146CDC57' as Address,
  AUDF: '0x34F6d53672c857A9a40E6c3199ad39EEb23f2668' as Address,
  BRLA: '0x749cb251a922c56e4aE71B9a1E7E5CBa9a15615a' as Address,
  JPYC: '0x366C7D67291b7aE37c5E137eb1BfDF0052C06707' as Address,
  KRW1: '0xD5eE24Fb35b847F6b8bdFe71b2F9E051f289d08a' as Address,
} as const;

export const SEPOLIA_STABLE_SYMBOLS = ["USDC", "USDT", "USDE", "USDS", "DAI", "USD1", "USDG", "PYUSD", "RLUSD", "syrupUSDC", "USDF", "U", "GHO", "TUSD", "USDTB", "FDUSD", "AUSD"] as const;
export const SEPOLIA_VOLATILE_SYMBOLS = ["USDC", "USDT", "WETH", "WBTC", "cbBTC", "BNB", "XAUT", "PAXG", "EURC"] as const;
export const SEPOLIA_FX_SYMBOLS = ["USDC", "EURC", "QCAD", "AUDF", "BRLA", "JPYC", "KRW1"] as const;

export const SEPOLIA_BTR = {
  poolFactory: '0x93947194480B22fB34B54fFD9EC0694427946bbe' as Address,
  poolImpl: '0x97ACbae1c47Ec6ED5AbF25C71d7ef61e8cc683CD' as Address,
  poolAux: '0x68aF6b6E8A7aAB91062193c3730223aCE9F56D97' as Address,
  oracle: '0x01a52C049896E36c00bd5FD3db788e4d11B216c5' as Address,
  refOracle: '0x16d3CD9De87F43144BD73E374c5ABd70ad93AB26' as Address,
  flash: '0xD85FB2f27EF9d068c83C81F2e51319040c5eb02C' as Address,
  faucet: '0x6C4a93a4187a51243A6cBA5f79Ad04A957a88734' as Address,
  admin: '0x70743d9301C2B518F8393d2923eD5feeF2443e5d' as Address,
  distributor: '0xE4cc5Be59B0d5b78C4F2E7355621a0b8aa7123Ab' as Address,
  staking: '0x079E0a0F18dd2Bb29a611749f06cbF060187eA7c' as Address,
  govToken: '0x832Efb8790EB0dd0E949E6483779a7d5592ba97F' as Address,
  opsTreasuryProxy: '0x4ded806065368FFea50e119457Fd26521DFbC599' as Address,
  treasuryProxy: '0x0A2082dD7Aa8cf17E2F9d32Ec316Ea24fFB82f79' as Address,
  stablePool: '0xA9207BE6f1D33828b98508C6c77f51cdeC4951eE' as Address,
  volatilePool: '0x1f997b7dCcE0A956e431A24D58622e32656C8537' as Address,
} as const;

export interface SepoliaFeed { name: string; feedId: `0x${string}`; nxrSymbol: string; quoteVia?: string; token: Address; symbol: string; }
/**
 * ExternalOracle feeds per pool asset.
 * `name` = on-chain USDC-numeraire id (keccak(asset, USDC)).
 * `nxrSymbol` = NXR REST / seed tape. Stables use Pyth `X-USD` (USDC≈1 proxy;
 * signed blob matches). Volatiles use native `*-USDC`. FX use `X-USD` form for
 * /v1/price (already inverted); signer arms `USD-X`+invert for CAD/BRL/JPY/KRW.
 */
export const SEPOLIA_ORACLE_FEEDS: SepoliaFeed[] = [
  { name: 'USDC-USDC', feedId: '0x056bb5777f1ff70e78bc54188ed6bbe9bc95011962afe59a00e44b2e933a8ef9', nxrSymbol: 'USDC-USDC', token: SEPOLIA_TOKENS['USDC']!, symbol: 'USDC' },
  { name: 'USDT-USDC', feedId: '0x61c6b9fad453a43df30b315406e2f3ba288db5371fc3c14837ebbc6845537649', nxrSymbol: 'USDT-USD', token: SEPOLIA_TOKENS['USDT']!, symbol: 'USDT' },
  { name: 'USDE-USDC', feedId: '0x630c6d77e18874d430497b148ee225347a8b6e50e496314cf21fd2e1f5593737', nxrSymbol: 'USDE-USD', token: SEPOLIA_TOKENS['USDE']!, symbol: 'USDE' },
  { name: 'USDS-USDC', feedId: '0xb6029a46e36f5f278efa1ef9fdc4c90cd551020035cb96d0dc0e32e357cd8b28', nxrSymbol: 'USDS-USD', token: SEPOLIA_TOKENS['USDS']!, symbol: 'USDS' },
  { name: 'DAI-USDC', feedId: '0x7a46c181ee94097ac0df58994c600bc0ef430068a835e01e794cb257f5596d8d', nxrSymbol: 'DAI-USD', token: SEPOLIA_TOKENS['DAI']!, symbol: 'DAI' },
  { name: 'USD1-USDC', feedId: '0xd1bf5f81612e80fe9dcee9a3864ceebb55f1b8e60e80a3873c0ef6e425738950', nxrSymbol: 'USD1-USD', token: SEPOLIA_TOKENS['USD1']!, symbol: 'USD1' },
  { name: 'USDG-USDC', feedId: '0xc5dae82a0540fe49220e35a55370c8b7f4626687789c3861598540ee6e5ba95d', nxrSymbol: 'USDG-USD', token: SEPOLIA_TOKENS['USDG']!, symbol: 'USDG' },
  { name: 'PYUSD-USDC', feedId: '0x5ce7bdb929429721a41bda720bd1b2c3a19a975af5dde19d4fb97c314f5ff352', nxrSymbol: 'PYUSD-USD', token: SEPOLIA_TOKENS['PYUSD']!, symbol: 'PYUSD' },
  { name: 'RLUSD-USDC', feedId: '0x059e09b4f6fd64f9e0e42d7923d95e1b880368066a03447d27bb65f68aaba499', nxrSymbol: 'RLUSD-USD', token: SEPOLIA_TOKENS['RLUSD']!, symbol: 'RLUSD' },
  { name: 'syrupUSDC-USDC', feedId: '0xdb460767f85cdc11c18c5da9860196a33305ebcccf8c8305d9c63f26ee7c17fc', nxrSymbol: 'syrupUSDC-USDC', token: SEPOLIA_TOKENS['syrupUSDC']!, symbol: 'syrupUSDC' },
  { name: 'USDF-USDC', feedId: '0xa7fce6c9ae3f556f797b660d12480c4c7a988a6b65f02fda8692799022dd4e51', nxrSymbol: 'USDF-USD', token: SEPOLIA_TOKENS['USDF']!, symbol: 'USDF' },
  { name: 'U-USDC', feedId: '0x23ebdf3e1ac943e6d8c61a72f52d7fb0ed34b6fff0d9d92e4764988f86b59e64', nxrSymbol: 'U-USD', token: SEPOLIA_TOKENS['U']!, symbol: 'U' },
  { name: 'GHO-USDC', feedId: '0x11a05afba5a4531eb8ca4a6b92c376533319dcf882e1176b8f1285e18c4d7105', nxrSymbol: 'GHO-USD', token: SEPOLIA_TOKENS['GHO']!, symbol: 'GHO' },
  { name: 'TUSD-USDC', feedId: '0xe5f40e8df2a3159d68952252a5a53a72026469a65978db0268fa750051b9bac3', nxrSymbol: 'TUSD-USD', token: SEPOLIA_TOKENS['TUSD']!, symbol: 'TUSD' },
  { name: 'USDTB-USDC', feedId: '0x8d419507772b2abbabf61c38e592d6fa90dcad64f6556deb337050d1cf0de803', nxrSymbol: 'USDTB-USD', token: SEPOLIA_TOKENS['USDTB']!, symbol: 'USDTB' },
  { name: 'FDUSD-USDC', feedId: '0x655c99253ef593e835512bb246d331cc60b176793087e16fd604b2fdc066e5f4', nxrSymbol: 'FDUSD-USD', token: SEPOLIA_TOKENS['FDUSD']!, symbol: 'FDUSD' },
  { name: 'AUSD-USDC', feedId: '0x8bb9c388de78e600c772353b07e9b8b149abfd3adb2f0ce971a41d86d2fbdcee', nxrSymbol: 'AUSD-USD', token: SEPOLIA_TOKENS['AUSD']!, symbol: 'AUSD' },
  { name: 'WETH-USDC', feedId: '0x9fba52bc1a066b89d5604461f91089e2a04ebf40ceabde79fff3e318fe87cb63', nxrSymbol: 'ETH-USDC', token: SEPOLIA_TOKENS['WETH']!, symbol: 'WETH' },
  { name: 'WBTC-USDC', feedId: '0x2d58fcdc2b3b8e2cf1751321d57b9e3992c72d2dabac1dd74cc2f4da896e7e0a', nxrSymbol: 'BTC-USDC', token: SEPOLIA_TOKENS['WBTC']!, symbol: 'WBTC' },
  { name: 'cbBTC-USDC', feedId: '0x2dbe04920b7268184af8cd9e8352e4627de70402f84a8991fceefdc390b0031e', nxrSymbol: 'BTC-USDC', token: SEPOLIA_TOKENS['cbBTC']!, symbol: 'cbBTC' },
  { name: 'BNB-USDC', feedId: '0x585aa682889549d88e9a5b1c103b66937f0c2b3db7347e2ad1677f4017060a9e', nxrSymbol: 'BNB-USDC', token: SEPOLIA_TOKENS['BNB']!, symbol: 'BNB' },
  { name: 'XAUT-USDC', feedId: '0x8afa125f9bb7cb165f10d443fc5b426d2bdd2a001e36fa52e0eb732644e2cb1d', nxrSymbol: 'XAUT-USDC', token: SEPOLIA_TOKENS['XAUT']!, symbol: 'XAUT' },
  { name: 'PAXG-USDC', feedId: '0x22562b1961d06a602fc9149b222c5cc50548fd80202b752ec666bbcf6a47c34a', nxrSymbol: 'PAXG-USDC', token: SEPOLIA_TOKENS['PAXG']!, symbol: 'PAXG' },
  { name: 'EURC-USDC', feedId: '0x7b48a1509b4849707b3c406b7c1866cabb0938d87b5e0b0842df4b098c693575', nxrSymbol: 'EURC-USD', token: SEPOLIA_TOKENS['EURC']!, symbol: 'EURC' },
  { name: 'QCAD-USDC', feedId: '0xe1cfd349e9e3e4d6891c8e33a7b1533e191ee3318ff034c049618caa57d74bad', nxrSymbol: 'CAD-USD', token: SEPOLIA_TOKENS['QCAD']!, symbol: 'QCAD' },
  { name: 'AUDF-USDC', feedId: '0x020409a061f1ccc6a3d0511f2bb1f18c175b4614e4c5c5e02ed715d6254a5dfa', nxrSymbol: 'AUD-USD', token: SEPOLIA_TOKENS['AUDF']!, symbol: 'AUDF' },
  { name: 'BRLA-USDC', feedId: '0x515ee3abad05481e194281cf3698615c4dae80161051c75b5e5b8be9c14fda32', nxrSymbol: 'BRL-USD', token: SEPOLIA_TOKENS['BRLA']!, symbol: 'BRLA' },
  { name: 'JPYC-USDC', feedId: '0x965b70a15f56a602d15397b5fff1893d2786ebb06ea0f5199d0bed022eb85453', nxrSymbol: 'JPY-USD', token: SEPOLIA_TOKENS['JPYC']!, symbol: 'JPYC' },
  { name: 'KRW1-USDC', feedId: '0xc0322e276c809f19550dae0de4178c06042ea6b8802b1d813c9957c2fe84d1a0', nxrSymbol: 'KRW-USD', token: SEPOLIA_TOKENS['KRW1']!, symbol: 'KRW1' },
];

/** symbol -> ExternalOracle feedId (getFeed key). null when no feed is registered. */
export function sepoliaFeedId(symbol: string): `0x${string}` | null {
  return SEPOLIA_ORACLE_FEEDS.find((f) => f.symbol === symbol)?.feedId ?? null;
}

/** Static USD fallbacks, used until the oracle-push cohort brings live marks up.
 *  Stables=1 (numeraire class); volatiles ~ current-ish testnet refs. Sizing only:
 *  the AIMM reverts StaleData while prices are down and the flow keeper retries. */
export const SEPOLIA_REF_MARKS_USD: Record<string, number> = {
  USDC: 1, USDT: 1, USDE: 1, USDS: 1, DAI: 1, USD1: 1, USDG: 1, PYUSD: 1, RLUSD: 1,
  syrupUSDC: 1, USDF: 1, U: 1, GHO: 1, TUSD: 1, USDTB: 1, FDUSD: 1, AUSD: 1,
  // Refreshed 2026-07-28 against the live on-chain marks (and Binance spot).
  // The prior values (WETH 3800, WBTC 118k, BNB 1100) were ~2x the real market
  // and had gone unnoticed because they only surface when a feed read fails —
  // exactly when a 2x-wrong size is most damaging.
  WETH: 1915, WBTC: 63_800, cbBTC: 63_800, BNB: 574, XAUT: 4030, PAXG: 4040, EURC: 1.14,
  QCAD: 0.71, AUDF: 0.70, BRLA: 0.20, JPYC: 0.00612, KRW1: 0.000681,
};
