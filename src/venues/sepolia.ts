// Sepolia (chainId 11155111) BTR DEX venue — generated from
// dex/evm/deployments/11155111.{deploy,pools}.json. Regenerate on redeploy.

import type { Address } from '../eth/types.js';
import { type MarketSession, nxrMark } from './nxr.js';

export const SEPOLIA_CHAIN_ID = 11155111;
/** Ingest start block. MUST be at or below the first pool log. */
export const SEPOLIA_DEPLOY_BLOCK = 11340000;

/** Pool asset ERC20s. Keyed by canonical symbol. */
export const SEPOLIA_TOKENS: Record<string, Address> = {
  USDC: '0x35d8b13b44adbf6bfa968d9a9b4c0f66ab703bc8' as Address,
  USDT: '0xaa289b01a203bf31c326ec9435b50506e865b649' as Address,
  USDE: '0x69b1e0c437eb900cdb93beb80b7003c0adf6ec94' as Address,
  USDS: '0x7fddd2cece1f5151e23ebed86acd43ce931e74b7' as Address,
  DAI: '0x90f1036f562cc850d4a370c2dd8fd94a233e5e8d' as Address,
  USD1: '0x66600e17e418b6649562a039d32d6fcf6232e601' as Address,
  USDG: '0xa31e906896839642df11eb82aea7c442643ff6e8' as Address,
  PYUSD: '0x79929eaf36eac0640109d01bcc1f02db9dd1845f' as Address,
  RLUSD: '0x40c7c913bd001e9d99c427d52c2e59c01026a2b8' as Address,
  USDF: '0x16d720170b12c2811cd13e9d380d98db6d51a4e9' as Address,
  U: '0x77a95ab69bb0075aeec49ce1ed87515b55cbfd2c' as Address,
  GHO: '0x8796c36f8ba4b4224142fbfef747efbfec8f2dda' as Address,
  TUSD: '0x1b86f690dc359d3fb294930c5bb982503720da7f' as Address,
  USDTB: '0x6b65e577f893bcb24978a5cb5acc113d0c5a2eca' as Address,
  FDUSD: '0xb10ae8d3a15eb8ab98437d8a7611cd5e1ef73ab1' as Address,
  AUSD: '0x3cdb1a74b2bc2eab39a1134feb724a110c69b302' as Address,
  WETH: '0xe82c2371d8fff51492d6c6caf6e251b4949338d6' as Address,
  WBTC: '0xd26d0eec4b031cadd188b3808bf10ce91d379abf' as Address,
  cbBTC: '0x8dedc96eb7c72412ec9d07553b11fa482e515f5b' as Address,
  BNB: '0x05c07adbc119a1805d0b63c5862dbf2fbba56561' as Address,
  XAUT: '0x9b8d79878db7ee50fb9ef85d290e4cbdf26bee05' as Address,
  PAXG: '0x4b8bc47747d51890bac377546aee12502a56dd0e' as Address,
  EURC: '0xc6e514f3ab77d30778c3ad9a012075bedfc4c092' as Address,
  QCAD: '0x82131457FAa3218806d94056E316F00E0B2aA937' as Address,
  AUDF: '0x29D8E72D5eB0445dc36145044f5e489723d20E8a' as Address,
  BRLA: '0xa8357a783479bD13d254Fd2715987ab0a9CbDd69' as Address,
  JPYC: '0x904308A64E5c7aCfc23381D29C457AA7f4176f4f' as Address,
  KRW1: '0xA21c7E8328EaA898a39946FeCA981C0143366cC6' as Address,
} as const;

export const SEPOLIA_STABLE_SYMBOLS = ["USDC", "USDT", "USDE", "USDS", "DAI", "USD1", "USDG", "PYUSD", "RLUSD", "USDF", "U", "GHO", "TUSD", "USDTB", "FDUSD", "AUSD"] as const;
export const SEPOLIA_VOLATILE_SYMBOLS = ["USDC", "USDT", "WETH", "WBTC", "cbBTC", "BNB", "XAUT", "PAXG", "EURC"] as const;
export const SEPOLIA_FX_SYMBOLS = ["USDC", "EURC", "QCAD", "AUDF", "BRLA", "JPYC", "KRW1"] as const;

export const SEPOLIA_BTR = {
  poolFactory: '0x9257A8F30e31e5Dc5f88C6623BB761b29D57Fd80' as Address,
  poolImpl: '0x44339E6451fE7858b1375BcF66b4f180945F235B' as Address,
  oracle: '0xd3FB5bfF347265Aa7744582360Aaf3Eb6fdcf0e4' as Address,
  refOracle: '0x260ee8798eFb960017e8a6fC52E5B10695507670' as Address,
  flash: '0x42E2CD71031f30C0cb4D16B9A9F3598d3e8a405b' as Address,
  faucet: '0xd26B2DC9A962b6000B277D37bcf8A7FAE2BE198D' as Address,
  admin: '0x7708BF39Ca7cA42eE6d98b47E6ef809a56501A2a' as Address,
  distributor: '0x5845F2252A79696D401216219C0990982FC08835' as Address,
  staking: '0x2A9FF6e54eb735b6408945876498a286ffaa90D7' as Address,
  govToken: '0xbA0810D8aC1Ced307935fC116D7FbB399D3F0e1b' as Address,
  opsTreasuryProxy: '0x7407ee3bd8195103091c33788FB040d2520e69D4' as Address,
  treasuryProxy: '0xCcf51E56b58c0abcD494700aE94e4ade17B9BE66' as Address,
  stablePool: '0xfF6bf617cf2D3aB1608d6732cb5Efd8D184aDA8c' as Address,
  volatilePool: '0xFfa427bc61315c3Fd5C32157675b31135f910cAc' as Address,
  /**
   * FX core: DECLARED BUT NOT DEPLOYED in the current Sepolia fleet. The pool is scripted
   * (`dex/evm/script/SepoliaPoolDeploy.s.sol` `deployFxPool()`) and an older broadcast holds
   * 0x18c7376A4F9B3C3fb8A0A33fAf3c55aD225CB229, but `11155111.pools.json` — the canonical
   * deployment record — carries no `fxPool`, so that address is a stale artifact of a
   * superseded run and must NOT be resurrected here: pointing the router at a pool the
   * current fleet does not own is worse than having no FX route.
   *
   * Kept as an explicitly-typed `Address | undefined` rather than omitted, so consumers get
   * "not deployed yet, handle it" instead of "this key does not exist". Set it from
   * `11155111.pools.json` the day the FX core is actually deployed.
   */
  fxPool: undefined as Address | undefined,
} as const;

export interface SepoliaFeed {
  name: string;
  feedId: `0x${string}`;
  nxrSymbol: string;
  nxrQuote?: string;
  quoteVia?: string;
  token: Address;
  symbol: string;
  session?: MarketSession;
}

/**
 * One feed row. The NXR pair, its served reciprocal and its market session are NOT restated here —
 * they are read from `NXR_MARKS`, which every chain resolves through, so an asset's mark source is
 * stated once. A symbol with no row there is a hard error at module load, not an undefined mark.
 */
function feed(symbol: string, name: string, feedId: `0x${string}`): SepoliaFeed {
  const m = nxrMark(symbol);
  if (!m) throw new Error(`${symbol}: no NXR mark source — add it to NXR_MARKS`);
  const { nxrSymbol, nxrQuote, quoteVia, session } = m;
  return {
    name,
    feedId,
    nxrSymbol,
    nxrQuote,
    quoteVia,
    token: SEPOLIA_TOKENS[symbol]!,
    symbol,
    session,
  };
}
/**
 * ORDER IS THE ON-CHAIN `feedIds[]` INDEX — the idx every NXR-signed record carries. Append only;
 * reordering re-binds signed quotes to the wrong feed.
 *
 * The order is not free-form: it is `addFeed` call order across the deploy scripts, which
 * `test/sepolia-feeds.test.ts` re-derives from dex's own risk-params rather than trusting this
 * list. There is NO `USDC/USDC` identity feed — the base's mark is the signed `USDC-USD`
 * reference at idx 22 (`SepoliaPoolDeploy.s.sol` "BASE: its mark is the SIGNED USDC/USD
 * reference ... not a USDC/USDC identity").
 */
export const SEPOLIA_ORACLE_FEEDS: SepoliaFeed[] = [
  feed('USDT', 'USDT-USDC', '0xe2ca0626104d5e537a71218cb1524d5f02623014f122c80e479cfb2698aaaef9'),
  feed('USDE', 'USDE-USDC', '0xb235eefe16249c453be2a3d8b17d2648b3800ded997b2462fa2c05a92bfab2b8'),
  feed('USDS', 'USDS-USDC', '0xb6361eb741b2e26a6713df09d0733cb0496e036a722cc80ba3aec2428feaf2de'),
  feed('DAI', 'DAI-USDC', '0xa79f461569297cdfa4922e086316c5a076eb17e29ccb84da318cda002fb100c2'),
  feed('USD1', 'USD1-USDC', '0x1e0351447b4c27b8c6a91336d78b45d771356fa89710de4241adb5ec7bc8adbc'),
  feed('USDG', 'USDG-USDC', '0x2d57e58d54c6ad8940c0d313d8efad7f437c6478d7e0e61962515d868210e470'),
  feed('PYUSD', 'PYUSD-USDC', '0x103d540aab5b8da5e55e3577b1fc1fb32834d83719b0ec3c1965da93ccee2338'),
  feed('RLUSD', 'RLUSD-USDC', '0x62121c62a9bf512f7290db4c64ff874ed36801e2c587305622ab3c13eb463692'),
  feed('USDF', 'USDF-USDC', '0x8eb03ba0c7206e7974e2b083ba20f042b0181512a2433d79699998a6e0dab5de'),
  feed('U', 'U-USDC', '0xabf458a5978375d6037742d0aef47d257108d2caf9d332a0ed448f4c02475f13'),
  feed('GHO', 'GHO-USDC', '0x740512af4d28192a5d2e01d2b38efd85733ff9539247ecebbbfde19760204f0a'),
  feed('TUSD', 'TUSD-USDC', '0x051334eafdb19cfe7d3181f79907b2f2e5fad69e3883eaeb29fbb9a37aa7aac7'),
  feed('USDTB', 'USDTB-USDC', '0x8dde29522c36d87452f22d6a0394339461f214dd0f3333f9f9e835ee29fb6821'),
  feed('FDUSD', 'FDUSD-USDC', '0xd1cbd73596408f78397e1a17b9fd8248eb622a19186d159d18276505428e9b35'),
  feed('AUSD', 'AUSD-USDC', '0x6c5d7f72c1e08393b2835fe662ab0508645c3681f4bd4b15725a65185707be83'),
  feed('WETH', 'WETH-USDC', '0x9f932869c5a713fda95a98fbf00efd7040421675d3d75148fee2c1a2cdb088be'),
  feed('WBTC', 'WBTC-USDC', '0x9a248df235b673abba59685693dc843b468f4edc17146c62dabd882fe69bdb03'),
  feed('cbBTC', 'cbBTC-USDC', '0x0770b2902434aac390c910c38979d2bfbb2f5e2f43ab03c961af23172fcd4afa'),
  feed('BNB', 'BNB-USDC', '0xa9ac83978b1f6fc516cd0c591e5656859849a28c1bdd4f6d9824ba0560cbb215'),
  feed('XAUT', 'XAUT-USDC', '0xfbd75bd57a7cda2e9e3b8409a6269cbf8fe7bf74d62f23822247ace2dafbe684'),
  feed('PAXG', 'PAXG-USDC', '0xb6e3605879a0b64f7984843b5fc9e3d5aafcbdf1874c08030d85e5e0d05dc5bb'),
  feed('EURC', 'EURC-USDC', '0xc935b02202e468a1381f834951a37392b7c2b4ad80c8efe764f7ec9d5aca7504'),
  feed('USDC', 'USDC-USD', '0xf097408cec312d10691ef8ff946389a6eab389bed1a574aa68222fdf45f1f1f2'),
  feed('QCAD', 'QCAD-USDC', '0xfdcbda586491de458657b1ec84cf53b85add9adf3f7ff929ee6f811d1447b8ab'),
  feed('AUDF', 'AUDF-USDC', '0xdc34b9876032749a1047d2af4ac6c8dd93a65093a17be701fbeae07f558cd8b7'),
  feed('BRLA', 'BRLA-USDC', '0x18085d4edb9a77884122a7d83e60bf0ff1fc64a631020887eae17791ab4c94ba'),
  feed('JPYC', 'JPYC-USDC', '0xcc35076388f2fb7e3a00d8e8d0530753b80853e7333aa2a11ff7ca090d217515'),
  feed('KRW1', 'KRW1-USDC', '0xc6cba05bf7e0af179298ee4318bd6ae95c30b337542881623d60eb6a1ff25967'),
];

export function sepoliaFeedId(symbol: string): `0x${string}` | null {
  return SEPOLIA_ORACLE_FEEDS.find((f) => f.symbol === symbol)?.feedId ?? null;
}

export function sepoliaFeedByName(name: string): SepoliaFeed | null {
  return SEPOLIA_ORACLE_FEEDS.find((f) => f.name === name) ?? null;
}

/**
 * Static USD fallbacks for sizing when a live oracle read fails, keyed by the SEPOLIA spelling of
 * each symbol (`cbBTC`, not `CBBTC`) because the front indexes it by the token symbol it renders.
 * The numbers themselves are `NXR_MARKS[...].refUsd` — a mark is a property of the asset, so it is
 * stated once there and any chain's roster narrows it (`registry.ts activeRefMarksUsd`).
 */
export const SEPOLIA_REF_MARKS_USD: Record<string, number> = Object.fromEntries(
  SEPOLIA_ORACLE_FEEDS.map((f) => [f.symbol, nxrMark(f.symbol)!.refUsd!]),
);
