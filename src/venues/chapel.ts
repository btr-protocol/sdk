// Static Chapel (chainId 97) venue addresses — copied from
// dex/evm/deployments/97.deploy.json + 97.incumbents.json + 97.uni-piggyback.json + 97.coverage.json.
// No runtime JSON fetch.

import type { Address } from '../eth/types.js';

export const CHAPEL_CHAIN_ID = 97;

/** Mock ERC20s shared by BTR + incumbents. */
export const CHAPEL_TOKENS = {
  usdc:  '0x6dF80a290E0585dad752c25f2808E83b5624290d' as Address,
  usdt:  '0xB7b7722369Ab72cb044DE6bb511A4586F3a7dD64' as Address,
  usd1:  '0xC28bE4D407096E771F932c202F13D866B4d6BA07' as Address,
  usde:  '0xebF751546832ec77a039083E9FDd8158B21c0172' as Address,
  fdusd: '0x4Aa480f3dc3a1f08c24472E083fBDBE919b8BdFc' as Address,
  btcb:  '0xd719319e853670ac938e426fbdB70CFdb34c11Fa' as Address,
  eth:   '0x24Ff1aCD4e8fdBFEBee2e7e63ad36B1E72821189' as Address,
  wbnb:  '0x31B7DCA9e901F7D34fb4a3Ee07eD2994de16685D' as Address,
  cake:  '0xa7E62dd82789346bEb48a80227B5d926c6403400' as Address,
  xaut:  '0xd384aC4696FA230c9049F6534Fc35aC3af586073' as Address,
} as const;

/** Stable set used for UniV2 pair discovery. */
export const CHAPEL_STABLES: Address[] = [
  CHAPEL_TOKENS.usdc,
  CHAPEL_TOKENS.usdt,
  CHAPEL_TOKENS.usd1,
  CHAPEL_TOKENS.usde,
  CHAPEL_TOKENS.fdusd,
];

/** BTR volatile assets (excl. CAKE faucet-only extras for venue coverage). */
export const CHAPEL_VOLATILES: Address[] = [
  CHAPEL_TOKENS.usdc,
  CHAPEL_TOKENS.usdt,
  CHAPEL_TOKENS.btcb,
  CHAPEL_TOKENS.eth,
  CHAPEL_TOKENS.wbnb,
  CHAPEL_TOKENS.xaut,
];

export const CHAPEL_BTR = {
  poolFactory:  '0xEf72eE3274F03557EDcDf843A1444ae7f8f7bb05' as Address,
  stablePool:   '0xfF83da2711888dCb8B50dc6c1EF0b8F91424d23f' as Address,
  volatilePool: '0x68fDAA0be33D4d78AbeEF63aB8A32A6751d2F4C8' as Address,
  oracle:       '0xD91712c9F4037D0010041691Df191AB45994F2bF' as Address, // ExternalOracle (stables)
  /** Steward-lite AC (pools / Admin). Oracle keeps incumbent AC below. */
  ac:           '0xeBd35b5FC97090Ba1fCC31fBBccde29077A2854C' as Address,
  acOracle:     '0x626eb915d4a4136F7c00352A54378d3A322488da' as Address,
  admin:        '0x1a6bB558e7C2E8537D7e38491D1DE318B027F8B9' as Address,
  faucet:       '0x6a901982CE6cD2561F677217e012A33b8a88EF27' as Address,
  poolImpl:     '0x449e2234E04eEd1BE40721A99D509E2d44677bF6' as Address,
  poolAux:      '0xd90D8fA74C5Dd2290e967010Ef16f1Ce9E9Eb5e5' as Address,
  flash:        '0x91399ab82Db9F05d470618e89d0090AB4eF8Ff09' as Address,
  mockVenusUsdc: '0xe4DAce78d31804a876555121beCfCA565b086327' as Address,
  mockVenusUsdt: '0x9f22e75eAb85829E47a9aBaD214f35BD5eddf7C1' as Address,
  venusHookUsdc: '0x59E57b508Eb14941Dd6D0544E3Fb98d2a34CE777' as Address,
  venusHookUsdt: '0x7Ec0564B49888437fF9f8B720a6ec8005CB21C56' as Address,
} as const;

/** Curve StableSwap pools — stables + tricrypto-style volatiles (NG math). */
export const CHAPEL_CURVE = [
  {
    tag: 'curve3pool',
    address: '0xB2aF84882627CD2D3EBc01f3f23C53e060303691' as Address,
    coins: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usd1] as Address[],
    feeLabel: '1 bp · admin_fee=0',
  },
  {
    tag: 'curveUsdeUsdt',
    address: '0xfc44F8608F435Cb309E627921f94155739a19a23' as Address,
    coins: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usde] as Address[],
    feeLabel: '1 bp · admin_fee=0',
  },
  {
    tag: 'curveFdusdUsdc',
    address: '0x0734E0E2e75A6e993115C400e02A6560B7F07Ed5' as Address,
    coins: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.fdusd] as Address[],
    feeLabel: '1 bp · admin_fee=0',
  },
  {
    tag: 'curveUsdtBnbBtcb',
    address: '0xF64E188DA36e86afC151fd98DEb93A82f06B54E3' as Address,
    coins: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.wbnb, CHAPEL_TOKENS.btcb] as Address[],
    feeLabel: '30 bp · admin_fee=0',
  },
  {
    tag: 'curveUsdcEthBtcb',
    address: '0x6166F0020EFb6A8896dDc8A5e352F958962957F4' as Address,
    coins: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.eth, CHAPEL_TOKENS.btcb] as Address[],
    feeLabel: '30 bp · admin_fee=0',
  },
] as const;

/** UniV2 factory (vendored UniswapV2Pair math). feeTo=0 → 0.3% 100% to LPs. */
export const CHAPEL_UNIV2 = {
  factory: '0xD2F5488f1930Df661eceCbD4B122Ef767B6C92D4' as Address,
} as const;

/** @deprecated alias — was LiteCL; now UniV2 factory */
export const CHAPEL_LITE_CL = {
  factory: CHAPEL_UNIV2.factory,
  fees: [] as const,
} as const;

/** Uni V4 (RangeCL) — volatile vs USDC + stable crosses at low fee tiers. */
export const CHAPEL_UNI_V4 = {
  factory: '0x0f03EB0F1282594B3AE3A636fc835EEe8575765F' as Address,
  hook:    '0xD34E174AFa46Bda16f401c6787bD360c37485D2d' as Address,
  oracle:  '0x93D3760b533283Fb471d735C9cA8438860f627bC' as Address, // UniPoolOracle
  /** Volatile default fee (0.3%). */
  fee: 3000,
  /** Stable fee tiers: 0.0005% / 0.01% / 0.1% (Uni hundredths-of-a-bip). */
  stableFees: [5, 100, 1000] as const,
  volatilePools: [
    { tag: 'univ4-btcb-usdc', address: '0xf5Dd80e903158153D4d32E6C66518730251D694F' as Address, tokens: [CHAPEL_TOKENS.btcb, CHAPEL_TOKENS.usdc] as Address[], fee: 3000 },
    { tag: 'univ4-eth-usdc',  address: '0x444a77748082031a1E05750E7ee46206292aA063' as Address, tokens: [CHAPEL_TOKENS.eth,  CHAPEL_TOKENS.usdc] as Address[], fee: 3000 },
    { tag: 'univ4-wbnb-usdc', address: '0xf76993bdFD2d8F4a5257eE6b02B5752DfC232d9a' as Address, tokens: [CHAPEL_TOKENS.wbnb, CHAPEL_TOKENS.usdc] as Address[], fee: 3000 },
    { tag: 'univ4-xaut-usdc', address: '0xB779B6fB35A3b1053f8ac4F2067BC1929Ed6F382' as Address, tokens: [CHAPEL_TOKENS.xaut, CHAPEL_TOKENS.usdc] as Address[], fee: 3000 },
  ],
  stablePools: [
    { tag: 'univ4-usdc-usdt-5', address: '0xc11ACfA8F4eAD78a742886d170003d002F09351A' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usdt] as Address[], fee: 5 },
    { tag: 'univ4-usdc-usdt-100', address: '0x9810054C9802Aa62377A14E2570cAAEb15e14dfc' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usdt] as Address[], fee: 100 },
    { tag: 'univ4-usdc-usdt-1000', address: '0x463bc823ADB1120B2F6Fa14D327BBdC3215faFC3' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usdt] as Address[], fee: 1000 },
    { tag: 'univ4-usdc-usd1-5', address: '0x99693a80edC50951857e743A1f8651c3e9F280AE' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usd1] as Address[], fee: 5 },
    { tag: 'univ4-usdc-usd1-100', address: '0x44bDe8Cedb4Ce7969F98e0567b145d12B5f7dB64' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usd1] as Address[], fee: 100 },
    { tag: 'univ4-usdc-usd1-1000', address: '0xc846356FA531dD46316795EF700Dc59466FD3C18' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usd1] as Address[], fee: 1000 },
    { tag: 'univ4-usdc-usde-5', address: '0x0A4095B4DE924a769B690cC241a56C60f9110608' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usde] as Address[], fee: 5 },
    { tag: 'univ4-usdc-usde-100', address: '0x29599311d6a77D00bCC4E637F523a7480602dD9B' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usde] as Address[], fee: 100 },
    { tag: 'univ4-usdc-usde-1000', address: '0x272bCF6080AE6dC11e7911b358b39f2C4732171D' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.usde] as Address[], fee: 1000 },
    { tag: 'univ4-usdc-fdusd-5', address: '0x0a902FF1cbCaf5748329D2240B6249Ea368D0fDF' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.fdusd] as Address[], fee: 5 },
    { tag: 'univ4-usdc-fdusd-100', address: '0x47dc7579Dd0e21c9B06FDb174424A36f8a0Fe139' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.fdusd] as Address[], fee: 100 },
    { tag: 'univ4-usdc-fdusd-1000', address: '0xaEA8FfaC5684c558FEEf3611f534507A218Aa820' as Address, tokens: [CHAPEL_TOKENS.usdc, CHAPEL_TOKENS.fdusd] as Address[], fee: 1000 },
    { tag: 'univ4-usdt-usd1-5', address: '0xA99Ab36C206dACEb99b806549F415d7A7D12cc50' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usd1] as Address[], fee: 5 },
    { tag: 'univ4-usdt-usd1-100', address: '0xcB52d5F387Ea7Def8Aa2F9afc83c4B191d23AE22' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usd1] as Address[], fee: 100 },
    { tag: 'univ4-usdt-usd1-1000', address: '0xb3C58cAB2C8252e4834A274C6D3CcB0e822B8a95' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usd1] as Address[], fee: 1000 },
    { tag: 'univ4-usdt-usde-5', address: '0x9D214b529b133620dB1d90DDf30682e936AEe1e0' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usde] as Address[], fee: 5 },
    { tag: 'univ4-usdt-usde-100', address: '0x0498402Bb8Af5692823C9A59c5A44564E21b3109' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usde] as Address[], fee: 100 },
    { tag: 'univ4-usdt-usde-1000', address: '0x61fF939734cF5AfE870C29F743fc1244bf922e64' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.usde] as Address[], fee: 1000 },
    { tag: 'univ4-usdt-fdusd-5', address: '0x73F4416aDd15867E816e1661927deEd55635626e' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.fdusd] as Address[], fee: 5 },
    { tag: 'univ4-usdt-fdusd-100', address: '0xA3de6E1A0BAB0A0F35d92954f3CeE39B1e2e4bE9' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.fdusd] as Address[], fee: 100 },
    { tag: 'univ4-usdt-fdusd-1000', address: '0xA31f65cC348125850F02Be1137A17e93Fd21Cba9' as Address, tokens: [CHAPEL_TOKENS.usdt, CHAPEL_TOKENS.fdusd] as Address[], fee: 1000 },
    { tag: 'univ4-usd1-usde-5', address: '0x87A09E7B577379594c56B8cb6157A5abB5F9C8a3' as Address, tokens: [CHAPEL_TOKENS.usd1, CHAPEL_TOKENS.usde] as Address[], fee: 5 },
    { tag: 'univ4-usd1-usde-100', address: '0xcCa045Ec3373d60528D1Dd7A6FF31846d9d633E9' as Address, tokens: [CHAPEL_TOKENS.usd1, CHAPEL_TOKENS.usde] as Address[], fee: 100 },
    { tag: 'univ4-usd1-usde-1000', address: '0x2ebb9918D8C25112c974Eb6c451B404eE46c9731' as Address, tokens: [CHAPEL_TOKENS.usd1, CHAPEL_TOKENS.usde] as Address[], fee: 1000 },
    { tag: 'univ4-usd1-fdusd-5', address: '0x491Ae1FB2fA62820B61CfFae189d728516D3F732' as Address, tokens: [CHAPEL_TOKENS.usd1, CHAPEL_TOKENS.fdusd] as Address[], fee: 5 },
    { tag: 'univ4-usd1-fdusd-100', address: '0x10270Af8B039d353BfA6e1d5E1dD43cfEBbb674E' as Address, tokens: [CHAPEL_TOKENS.usd1, CHAPEL_TOKENS.fdusd] as Address[], fee: 100 },
    { tag: 'univ4-usd1-fdusd-1000', address: '0xBa140f98A79ed25DfD831a70dD2bA94cfc08bdA0' as Address, tokens: [CHAPEL_TOKENS.usd1, CHAPEL_TOKENS.fdusd] as Address[], fee: 1000 },
    { tag: 'univ4-usde-fdusd-5', address: '0x8cC0532cd130Ce9Ca81074900Af006D6380788db' as Address, tokens: [CHAPEL_TOKENS.usde, CHAPEL_TOKENS.fdusd] as Address[], fee: 5 },
    { tag: 'univ4-usde-fdusd-100', address: '0x05f646fD6d2293Fb666E1935eD826de1683eA813' as Address, tokens: [CHAPEL_TOKENS.usde, CHAPEL_TOKENS.fdusd] as Address[], fee: 100 },
    { tag: 'univ4-usde-fdusd-1000', address: '0xc4906528183444295C386BbA4311067DD77B342c' as Address, tokens: [CHAPEL_TOKENS.usde, CHAPEL_TOKENS.fdusd] as Address[], fee: 1000 },
  ],
} as const;

/** @deprecated alias — prefer CHAPEL_UNI_V4 */
export const CHAPEL_RANGE_CL = {
  factory: CHAPEL_UNI_V4.factory,
  hook: CHAPEL_UNI_V4.hook,
  oracle: CHAPEL_UNI_V4.oracle,
  fee: CHAPEL_UNI_V4.fee,
  pools: CHAPEL_UNI_V4.volatilePools.map((p) => ({
    tag: p.tag.replace('univ4-', 'range-'),
    address: p.address,
    tokens: p.tokens,
  })),
} as const;

/** Canonical Wombat (front-wired; stables only). */
export const CHAPEL_WOMBAT = '0xc1eF1AE0615b2020Cf3AD5fc150aECE8dbd3241e' as Address;

/** WombatLite token set (no FDUSD). */
export const CHAPEL_WOMBAT_TOKENS: Address[] = [
  CHAPEL_TOKENS.usdc,
  CHAPEL_TOKENS.usdt,
  CHAPEL_TOKENS.usd1,
  CHAPEL_TOKENS.usde,
];

/** Canonical Fluid (front-wired; stables only) — redeployed 2026-07-11 @ 50k/side. */
export const CHAPEL_FLUID = {
  factory: '0xf428C2F052d5c1Bec7745728E94d82B2034C4FDC' as Address,
  pools: [
    '0xF659089c9285760cF15074AF2B44454336AA6B69',
    '0x5b09b1A05feF61aB303C81702D4964cc57446c35',
    '0x02E821C9d4b2A6dEF616Ea8A0571DE09EC447B98',
    '0x39aa9BEcB01A74B2581DE8469e82fdDe34C0178D',
    '0x63bBA3d3fff7211B337B0c5AfD0D51DB2e1DB105',
    '0xf82178A5e637b5774f80aB28e3D1f1432CFa4636',
  ] as Address[],
} as const;
