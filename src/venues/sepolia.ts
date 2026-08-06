// Sepolia (chainId 11155111) BTR DEX venue — generated from
// dex/evm/deployments/11155111.{deploy,pools}.json. Regenerate on redeploy.

import type { Address } from '../eth/types.js';

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
  poolAux: '0x35C5cf4216924B98BdA505EA4250e1Bb1DE243E1' as Address,
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
} as const;

/**
 * Weekly OPEN windows as `[openMin, closeMin)` offsets from Sunday 00:00 UTC, ascending
 * and non-overlapping. Absent = the tape never stops. Sole home for BTR market hours:
 * NXR measures them (`.s10` tick_count buckets) but serves them on no endpoint, so they
 * are declared beside the `nxrSymbol` they describe and read from here everywhere.
 */
export type MarketSession = readonly (readonly [number, number])[];
const DAY_MIN = 1440;
/** FX majors. Sun 21:00 to Fri 22:00 UTC: the venue week is pinned to 17:00 New York, so both
 *  edges move an hour across US DST (21:00 on EDT, 22:00 on EST). Each edge takes the value
 *  that errs OPEN, widening the window by the ambiguous hour on purpose: an hour we are unsure
 *  about reads as a live market, so a dead feed still shows stale rather than being excused as
 *  a scheduled close. The cost is the reverse hour reading stale while genuinely shut. */
const FX_24X5: MarketSession = [[1260, 5 * DAY_MIN + 1320]];
/** USD/BRL on Pyth Lazer: MEASURED Mon-Fri 12:00-21:00 UTC on the live .s10 corpus
 *  2026-07-25..08-03 (nx-rates config.yml:1280-1288). No DST margin needed: the window is
 *  09:00-18:00 in Brazil, which has been UTC-3 year-round since 2019. */
const BRL_SESSION: MarketSession = [1, 2, 3, 4, 5].map(
  (d) => [d * DAY_MIN + 720, d * DAY_MIN + 1260] as const,
);

export interface SepoliaFeed { name: string; feedId: `0x${string}`; nxrSymbol: string; nxrQuote?: string; quoteVia?: string; token: Address; symbol: string; session?: MarketSession; }
export const SEPOLIA_ORACLE_FEEDS: SepoliaFeed[] = [
  { name: 'USDC-USDC', feedId: '0x0c8bbb24907a4477af7953a3521644a319d7b062e56044543d63a365cc11b487', nxrSymbol: 'USDC-USDC', token: SEPOLIA_TOKENS['USDC']!, symbol: 'USDC' },
  { name: 'USDT-USDC', feedId: '0xe2ca0626104d5e537a71218cb1524d5f02623014f122c80e479cfb2698aaaef9', nxrSymbol: 'USDT-USD', token: SEPOLIA_TOKENS['USDT']!, symbol: 'USDT' },
  { name: 'USDE-USDC', feedId: '0xb235eefe16249c453be2a3d8b17d2648b3800ded997b2462fa2c05a92bfab2b8', nxrSymbol: 'USDE-USD', token: SEPOLIA_TOKENS['USDE']!, symbol: 'USDE' },
  { name: 'USDS-USDC', feedId: '0xb6361eb741b2e26a6713df09d0733cb0496e036a722cc80ba3aec2428feaf2de', nxrSymbol: 'USDS-USD', token: SEPOLIA_TOKENS['USDS']!, symbol: 'USDS' },
  { name: 'DAI-USDC', feedId: '0xa79f461569297cdfa4922e086316c5a076eb17e29ccb84da318cda002fb100c2', nxrSymbol: 'DAI-USD', token: SEPOLIA_TOKENS['DAI']!, symbol: 'DAI' },
  { name: 'USD1-USDC', feedId: '0x1e0351447b4c27b8c6a91336d78b45d771356fa89710de4241adb5ec7bc8adbc', nxrSymbol: 'USD1-USD', token: SEPOLIA_TOKENS['USD1']!, symbol: 'USD1' },
  { name: 'USDG-USDC', feedId: '0x2d57e58d54c6ad8940c0d313d8efad7f437c6478d7e0e61962515d868210e470', nxrSymbol: 'USDG-USD', token: SEPOLIA_TOKENS['USDG']!, symbol: 'USDG' },
  { name: 'PYUSD-USDC', feedId: '0x103d540aab5b8da5e55e3577b1fc1fb32834d83719b0ec3c1965da93ccee2338', nxrSymbol: 'PYUSD-USD', token: SEPOLIA_TOKENS['PYUSD']!, symbol: 'PYUSD' },
  { name: 'RLUSD-USDC', feedId: '0x62121c62a9bf512f7290db4c64ff874ed36801e2c587305622ab3c13eb463692', nxrSymbol: 'RLUSD-USD', token: SEPOLIA_TOKENS['RLUSD']!, symbol: 'RLUSD' },
  { name: 'USDF-USDC', feedId: '0x8eb03ba0c7206e7974e2b083ba20f042b0181512a2433d79699998a6e0dab5de', nxrSymbol: 'USDF-USD', token: SEPOLIA_TOKENS['USDF']!, symbol: 'USDF' },
  { name: 'U-USDC', feedId: '0xabf458a5978375d6037742d0aef47d257108d2caf9d332a0ed448f4c02475f13', nxrSymbol: 'U-USD', token: SEPOLIA_TOKENS['U']!, symbol: 'U' },
  { name: 'GHO-USDC', feedId: '0x740512af4d28192a5d2e01d2b38efd85733ff9539247ecebbbfde19760204f0a', nxrSymbol: 'GHO-USD', token: SEPOLIA_TOKENS['GHO']!, symbol: 'GHO' },
  { name: 'TUSD-USDC', feedId: '0x051334eafdb19cfe7d3181f79907b2f2e5fad69e3883eaeb29fbb9a37aa7aac7', nxrSymbol: 'TUSD-USD', token: SEPOLIA_TOKENS['TUSD']!, symbol: 'TUSD' },
  { name: 'USDTB-USDC', feedId: '0x8dde29522c36d87452f22d6a0394339461f214dd0f3333f9f9e835ee29fb6821', nxrSymbol: 'USDTB-USD', token: SEPOLIA_TOKENS['USDTB']!, symbol: 'USDTB' },
  { name: 'FDUSD-USDC', feedId: '0xd1cbd73596408f78397e1a17b9fd8248eb622a19186d159d18276505428e9b35', nxrSymbol: 'FDUSD-USD', token: SEPOLIA_TOKENS['FDUSD']!, symbol: 'FDUSD' },
  { name: 'AUSD-USDC', feedId: '0x6c5d7f72c1e08393b2835fe662ab0508645c3681f4bd4b15725a65185707be83', nxrSymbol: 'AUSD-USD', token: SEPOLIA_TOKENS['AUSD']!, symbol: 'AUSD' },
  { name: 'WETH-USDC', feedId: '0x9f932869c5a713fda95a98fbf00efd7040421675d3d75148fee2c1a2cdb088be', nxrSymbol: 'ETH-USDC', token: SEPOLIA_TOKENS['WETH']!, symbol: 'WETH' },
  { name: 'WBTC-USDC', feedId: '0x9a248df235b673abba59685693dc843b468f4edc17146c62dabd882fe69bdb03', nxrSymbol: 'BTC-USDC', token: SEPOLIA_TOKENS['WBTC']!, symbol: 'WBTC' },
  { name: 'cbBTC-USDC', feedId: '0x0770b2902434aac390c910c38979d2bfbb2f5e2f43ab03c961af23172fcd4afa', nxrSymbol: 'BTC-USDC', token: SEPOLIA_TOKENS['cbBTC']!, symbol: 'cbBTC' },
  { name: 'BNB-USDC', feedId: '0xa9ac83978b1f6fc516cd0c591e5656859849a28c1bdd4f6d9824ba0560cbb215', nxrSymbol: 'BNB-USDC', token: SEPOLIA_TOKENS['BNB']!, symbol: 'BNB' },
  { name: 'XAUT-USDC', feedId: '0xfbd75bd57a7cda2e9e3b8409a6269cbf8fe7bf74d62f23822247ace2dafbe684', nxrSymbol: 'XAUT-USDC', token: SEPOLIA_TOKENS['XAUT']!, symbol: 'XAUT' },
  { name: 'PAXG-USDC', feedId: '0xb6e3605879a0b64f7984843b5fc9e3d5aafcbdf1874c08030d85e5e0d05dc5bb', nxrSymbol: 'PAXG-USD', token: SEPOLIA_TOKENS['PAXG']!, symbol: 'PAXG' },
  { name: 'EURC-USDC', feedId: '0xc935b02202e468a1381f834951a37392b7c2b4ad80c8efe764f7ec9d5aca7504', nxrSymbol: 'EURC-USD', token: SEPOLIA_TOKENS['EURC']!, symbol: 'EURC' },
  { name: 'USDC-USD', feedId: '0xf097408cec312d10691ef8ff946389a6eab389bed1a574aa68222fdf45f1f1f2', nxrSymbol: 'USDC-USD', token: SEPOLIA_TOKENS['USDC']!, symbol: 'USDC' },
  { name: 'QCAD-USDC', feedId: '0xfdcbda586491de458657b1ec84cf53b85add9adf3f7ff929ee6f811d1447b8ab', nxrSymbol: 'CAD-USD', nxrQuote: 'USD-CAD', token: SEPOLIA_TOKENS['QCAD']!, symbol: 'QCAD', session: FX_24X5 },
  { name: 'AUDF-USDC', feedId: '0xdc34b9876032749a1047d2af4ac6c8dd93a65093a17be701fbeae07f558cd8b7', nxrSymbol: 'AUD-USD', token: SEPOLIA_TOKENS['AUDF']!, symbol: 'AUDF', session: FX_24X5 },
  { name: 'BRLA-USDC', feedId: '0x18085d4edb9a77884122a7d83e60bf0ff1fc64a631020887eae17791ab4c94ba', nxrSymbol: 'BRL-USD', nxrQuote: 'USD-BRL', token: SEPOLIA_TOKENS['BRLA']!, symbol: 'BRLA', session: BRL_SESSION },
  { name: 'JPYC-USDC', feedId: '0xcc35076388f2fb7e3a00d8e8d0530753b80853e7333aa2a11ff7ca090d217515', nxrSymbol: 'JPY-USD', nxrQuote: 'USD-JPY', token: SEPOLIA_TOKENS['JPYC']!, symbol: 'JPYC', session: FX_24X5 },
  { name: 'KRW1-USDC', feedId: '0xc6cba05bf7e0af179298ee4318bd6ae95c30b337542881623d60eb6a1ff25967', nxrSymbol: 'KRW-USD', nxrQuote: 'USD-KRW', token: SEPOLIA_TOKENS['KRW1']!, symbol: 'KRW1', session: FX_24X5 },
];

export function sepoliaFeedId(symbol: string): `0x${string}` | null {
  return SEPOLIA_ORACLE_FEEDS.find((f) => f.symbol === symbol)?.feedId ?? null;
}

export function sepoliaFeedByName(name: string): SepoliaFeed | null {
  return SEPOLIA_ORACLE_FEEDS.find((f) => f.name === name) ?? null;
}

/**
 * Null when the market is open or declares no session, else the ms instant it reopens.
 * This is what separates a mark frozen BY DESIGN from a feed that has died: the same
 * frozen mark is expected inside a closed window and a fault inside an open one, so
 * every unresolvable case (unknown symbol, bad clock) returns null and reads as a fault.
 */
export function closedUntil(symbol: string, atMs: number = Date.now()): number | null {
  const s = SEPOLIA_ORACLE_FEEDS.find((f) => f.symbol === symbol)?.session;
  if (!s?.length || !Number.isFinite(atMs)) return null;
  const d = new Date(atMs);
  const min = d.getUTCDay() * DAY_MIN + d.getUTCHours() * 60 + d.getUTCMinutes();
  if (s.some(([open, close]) => min >= open && min < close)) return null;
  const next = s.find(([open]) => open > min)?.[0] ?? 7 * DAY_MIN + s[0]![0];
  const minuteStart = Date.UTC(
    d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(),
  );
  return minuteStart + (next - min) * 60_000;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** `closedUntil` instant as "Mon 12:00 UTC". UTC because the session itself is declared in UTC. */
export function sessionOpenLabel(atMs: number): string {
  const d = new Date(atMs);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${WEEKDAYS[d.getUTCDay()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** Static USD fallbacks for sizing when a live oracle read fails. */
export const SEPOLIA_REF_MARKS_USD: Record<string, number> = {
  USDC: 1, USDT: 1, USDE: 1, USDS: 1, DAI: 1, USD1: 1, USDG: 1, PYUSD: 1, RLUSD: 1,
  USDF: 1, U: 1, GHO: 1, TUSD: 1, USDTB: 1, FDUSD: 1, AUSD: 1,
  WETH: 1915, WBTC: 63_800, cbBTC: 63_800, BNB: 574, XAUT: 4030, PAXG: 4040, EURC: 1.14,
  QCAD: 0.71, AUDF: 0.70, BRLA: 0.20, JPYC: 0.00612, KRW1: 0.000681,
};

