// Interface snapshot of the deployed BTR contracts. The backend serves ABIs live
// (`GET {api}/v1/abis/{name}`); these static copies exist for offline typing.

/**
 * Deployed BTR venues, keyed by chain id
 * @module @btr-protocol/sdk/venues
 *
 * Source: the recorded deployment facts for each chain. A chain with no record is ABSENT, and
 * `registry.ts` throws on an absent chain rather than falling back, so a bot pointed at a chain
 * BTR is not deployed on cannot silently quote another chain's addresses.
 *
 * `feedIds` is keyed by feed NAME and ORDERED by on-chain ordinal: entry `n` is `feedIds[n]`, the
 * index every NXR-signed record carries. Arc's record states that order (`.feedOrder`). The chain
 * itself remains the authority: `keepers/src/oracle/startup.rs` reads `feedIds(idx)` and refuses to
 * start on a mismatch. But nothing downstream hand-lists an ordinal any more.
 */

import type { Address, Hex } from '../eth/types.js';

export interface ChainVenue {
  chainId: number;
  /** Singletons by name: `oracle`, `refOracle`, `poolFactory`, `faucet`, … */
  contracts: Record<string, Address>;
  /** Pool asset ERC20s by canonical symbol. First symbol of each roster is the USDC base. */
  tokens: Record<string, Address>;
  /**
   * On-chain feed name (`USDT-USDC`, `USDC-USD`) ⇒ its `feedId`, in `feedIds[]` ordinal order.
   *
   * Faucet-twin aliases (`.feedTwins`) are APPENDED after the ordinal-carrying entries and share
   * a borrowed id, so entry `n` still names ordinal `n` but the tail is not an ordinal at all.
   * Read this by NAME. Anything that needs the order must stop at the recorded feed count.
   */
  feedIds: Record<string, Hex>;
  /**
   * On-chain feed name ⇒ its MITCH `tickerId` (decimal string), the key every signed record
   * carries. Content-derived, so it is the same on every chain; join a decoded record to a feed
   * through this, never through an array position. Absent for a pre-migration deployment record.
   */
  tickerIds: Record<string, string>;
  /** Router tag ⇒ the symbols that core is SCRIPTED to list, deployed or not. Twins are absent. */
  rosters: Record<string, string[]>;
  /**
   * Deployed cores with the symbols each one lists. A scripted-but-unbroadcast core is absent.
   * This is the ROUTABLE set and it is a superset of `rosters[tag]`: feedless faucet twins are
   * listed legs and quote, so they belong here and nowhere else.
   */
  pools: Array<{ tag: string; address: Address; symbols: string[] }>;
  /** Feed names mirrored onto the reference oracle. */
  refFeeds: string[];
}

export const DEPLOYED_VENUES: Record<number, ChainVenue> = {
  5042002: {
    chainId: 5042002,
    contracts: {
      ac: '0xa7Dc0A8815acCbDfc22619b6F65b2dE710Eb2A7B',
      admin: '0x35BB3BBeB86c7caee532083DAC639400912C8f00',
      faucet: '0x97BE19E537B9064f5c4984dD1e83Ad8b6aBe0cC3',
      flash: '0x544128B1F23D959F1B2660b1e392cb9D5e24d81f',
      // ExternalOracleV4 (wire v5). AUTHORITATIVE: every one of the 37 pool legs was repointed
      // here, so this is what `registry.ts` and the pools read.
      oracle: '0x842c2736F072A8A7b523D23bd3Ef21F21AC24d5C',
      poolFactory: '0xaF5Dfa6F3f549bAb1598Ff24d15c0cF9aCaA6Df7',
      poolImpl: '0x136bC3A713DB3C8da6836244923F7bdA401F1b27',
      // The reference oracle every non-base spoke still prices against is STILL the V3 instance:
      // its repoint is a second timelock round that has not executed. `refOracleV4` is deployed
      // and fed but not yet pointed at, so both generations are live at once and a client that
      // reads marks must decode BOTH wires. Join a lane map on the ADDRESS, never on the tag.
      refOracle: '0xC17920b2cC4Ac028c7F8bdB46E952Fb2d2a172a6',
      refOracleV4: '0xC17920b2cC4Ac028c7F8bdB46E952Fb2d2a172a6',
      // The superseded V3 primary. Kept named so historical `SlotsPushed` logs stay attributable.
      prevOracle: '0x0bef57B54631004Efc83636678cd95884C772ad4',
    },
    tokens: {
      USDC: '0x3600000000000000000000000000000000000000',
      USDT: '0x878e27566Ab9E32534e306C26388dFcE82D0AB46',
      USDS: '0x66dbe40c8dc03f2C9e7A187F253e8889A03640c8',
      USD1: '0x0326748d09eD77D8C15fbf04d6277aE4CAF033f3',
      PYUSD: '0xeE12a7072779a4ab85f2DD2a1E163DbF164291f9',
      EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      QCAD: '0x626eb915d4a4136F7c00352A54378d3A322488da',
      AUDF: '0x35c625c07ed4a9123ab863f6e8722c9210c808A3',
      JPYC: '0xA1fe5aDcB5f5DD1c21d372D18E7dF7fa5bfbc09e',
      KRW1: '0xee7D69C52c2F183A0389374E82ca841c5a463573',
      WETH: '0x89A9cD1dd6DE3ab7152EF9c7C5496c2946334D0D',
      WBTC: '0xF36eEe851bf3e76E464609a717bAE4a239A8cC7b',
      CBBTC: '0xbAA18E707E7b7fE9d1c0e4CeA61603035cb30C55',
      BNB: '0x49C710167A4b486F20f9437485D865D653806310',
      XAUT: '0x432A3248e91d8B6fd41A487dE8886E0B44Fb7a6D',
      PAXG: '0x96f953bAC2FF3829B4a526cacd858A5a22327E03',
      INTC: '0xd7A6216738Eba05C0ee47ff478e307bE5A94Dc95',
      AMD: '0x3e04aa20170944d29681a475Bb3dd0a1Bb421cCb',
      NVDA: '0xA4816856b8144ad1bb5a555A9Afa8B0f4B9FC8D0',
      ASML: '0x56520a1D0F047e748AA042975D95B6B3CD203a4d',
      SPCX: '0xf782226BB4B4C6F57F24D17a34c5C041482b4bE2',
      AVGO: '0x0458D9Fc5bd31b5Af3018Be9CfE91ecF4ABf9a7e',
      TSLA: '0xBA76ce34AC2c65813ee2c11F34Ad1523fE43CBac',
      MSFT: '0x83E43A65ce9E5aE1872a2363eD74D67C5A30fdb5',
      ORCL: '0x56F81D0831b9352e023266b72F38b4657baA32E8',
      META: '0x2767f2e94a7cF7935d59DdD7A5A30138369846e2',
      USDCB: '0x9A8Ea4AB461d0Db943ecB1B1e4CE0B68df9061CC',
      EURCB: '0xd9016a91387db71fbD07Cde32E900E17061dE5A1',
    },
    feedIds: {
      'USDT-USDC': '0xfa722ae80d6181ca931f45c80582c173b9c19cd30c1632e864e8f48ea62a6548',
      'USDS-USDC': '0x4d9df04bbf62ab0e8418c56a2fea063a7956bc08674600862a95970c583f3be5',
      'USD1-USDC': '0x4c7fec22c40835f297ef183fc68a20f5a965997cddedf9fcf5bd18b3d0898d85',
      'PYUSD-USDC': '0xd4ebce1baf00f6124f7a0bd347ef8170aaa7ce6e5dcf595879e3c61676921e99',
      'EURC-USDC': '0x9af29d8ae5269a47d972f6e5a188878d8e45cb2c7f7ce637492bdaef05a980be',
      'QCAD-USDC': '0x1c9b7f4cc3a7295cb420362f039e13565a7f80f9d0b7023405023d1db74735ea',
      'AUDF-USDC': '0x20dc0d8625fb1ae982d08763105cdce98e9a95ca59c4903190119c9fe88a47cd',
      'JPYC-USDC': '0xf3570f02e056765d6c42a5b3624067f3b80c80b9d22355c71b534c24eb8ae1e9',
      'KRW1-USDC': '0x2642c5e9691dbb5c5674a2a24ebb68e4df723f0656e3d4e2e45fa028c6caf650',
      'WETH-USDC': '0xacb54d59d0c847602722bfdec8aaaf92ead1385b3402cad482b3c6484a6efc1c',
      'WBTC-USDC': '0x63b49bbd6b259a4c3500020453ad775a8df2ff9e423fe5228644f18f495262bf',
      'CBBTC-USDC': '0x27f98ddc32af5a6272f676d428fd004af1718c18541118dc044c0ac3a2b612fd',
      'BNB-USDC': '0x5398b2b4caab86e6c562e30f6ecb15c4b87c20ed7595ad48b4048b62005b9888',
      'XAUT-USDC': '0xaf63e9c459822846879d75246ea10ee933d53a8f206c51c5150270aadd42625f',
      'PAXG-USDC': '0xb8b495d5826591b537a47841255ffbca7f1f0f56afff8f5e7bc565f1e20b338c',
      'USDC-USD': '0x0189091eac3c33dc88b48c58f75a1d978253e7fb2d4a1711b5701172b083c487',
      'INTC-USDC': '0x058dc9a04c0ebce2bb560948628013d466bdc2bfb8042e33d4a7a0dde2045fba',
      'AMD-USDC': '0xa6c9396c58cb1c50e6f2a6139404b148ecc7f86489d9d4faa01e3eb5228fc652',
      'NVDA-USDC': '0x9a0882814ace331414f8c2c7cb34e815e4c7092f8de7df39bba1fc92968deb69',
      'ASML-USDC': '0x6b434d49a41b22478b4b1d3fca59c90e5dbfc185cc1b5e2a9a3efd2f901e0c23',
      'SPCX-USDC': '0x1729d32f332780e7a939b7ca2a73ceb60cf507d64ed28e15023dad847f50fe47',
      'AVGO-USDC': '0x7d9c97fe812e6df01e2604baeade55e60503c8d793300e69d6da8efa52618b54',
      'TSLA-USDC': '0x91a8aa38cb67e3a567c5b58b125e69e218c5a97677de4b4ce327a1bd281e0952',
      'MSFT-USDC': '0x778b165de0bfe24e8806a0334dabd237c8f5844fb3d60a8d5b623d352120e784',
      'ORCL-USDC': '0x83c6210ed83e6bbd8db6d6dd43893d46cbc0a20efce89c30f6be2ce536ea74db',
      'META-USDC': '0x2d2201820627f4019b4ddd9d9742fc14a750d4df2f5413961e91c03e8af9581a',
      'USDCB-USDC': '0xfa722ae80d6181ca931f45c80582c173b9c19cd30c1632e864e8f48ea62a6548',
      'EURCB-USDC': '0x9af29d8ae5269a47d972f6e5a188878d8e45cb2c7f7ce637492bdaef05a980be',
    },
    tickerIds: {
      'USDT-USDC': '451698500104617984',
      'USDS-USDC': '448399965221289984',
      'USD1-USDC': '442022797780189184',
      'PYUSD-USDC': '445981039640182784',
      'EURC-USDC': '439219043129360384',
      'QCAD-USDC': '456096546615721984',
      'AUDF-USDC': '456206497778499584',
      'JPYC-USDC': '456426400104054784',
      'KRW1-USDC': '456536351266832384',
      'WETH-USDC': '438724262896861184',
      'WBTC-USDC': '453457718709059584',
      'CBBTC-USDC': '436635190804086784',
      'BNB-USDC': '434436167548534784',
      'XAUT-USDC': '454557230336835584',
      'PAXG-USDC': '454447279174057984',
      'USDC-USD': '452687840255410176',
    },
    rosters: {
      'btr-stable': ['USDC', 'USDT', 'USDS', 'USD1', 'PYUSD'],
      'btr-fx': ['USDC', 'EURC', 'QCAD', 'AUDF', 'JPYC', 'KRW1'],
      'btr-crypto': ['USDC', 'USDT', 'WETH', 'WBTC', 'CBBTC', 'BNB', 'XAUT', 'PAXG', 'EURC'],
      'btr-stocks': [
        'USDC',
        'INTC',
        'AMD',
        'NVDA',
        'ASML',
        'SPCX',
        'AVGO',
        'TSLA',
        'MSFT',
        'ORCL',
        'META',
      ],
    },
    pools: [
      {
        tag: 'btr-stable',
        address: '0x8e33853c6c34F20c93385449afE9477029D45BFE',
        symbols: ['USDC', 'USDT', 'USDS', 'USD1', 'PYUSD', 'USDCB'],
      },
      {
        tag: 'btr-fx',
        address: '0xCbB809d5A5583301e7753D57D73A25C0d12EC232',
        symbols: ['USDC', 'EURC', 'QCAD', 'AUDF', 'JPYC', 'KRW1', 'USDCB', 'EURCB'],
      },
      {
        tag: 'btr-crypto',
        address: '0xACe9a150cdc3ab8AdBbc3e7CC5d5ce92485624F5',
        symbols: [
          'USDC',
          'USDT',
          'WETH',
          'WBTC',
          'CBBTC',
          'BNB',
          'XAUT',
          'PAXG',
          'EURC',
          'USDCB',
          'EURCB',
        ],
      },
      {
        tag: 'btr-stocks',
        address: '0xD98A734203A719d9CA26f562dc8bc9fcb55685e3',
        symbols: [
          'USDC',
          'INTC',
          'AMD',
          'NVDA',
          'ASML',
          'SPCX',
          'AVGO',
          'TSLA',
          'MSFT',
          'ORCL',
          'META',
          'USDCB',
        ],
      },
    ],
    refFeeds: [
      'USDT-USDC',
      'USDS-USDC',
      'USD1-USDC',
      'PYUSD-USDC',
      'EURC-USDC',
      'QCAD-USDC',
      'AUDF-USDC',
      'JPYC-USDC',
      'KRW1-USDC',
      'WETH-USDC',
      'WBTC-USDC',
      'CBBTC-USDC',
      'BNB-USDC',
      'XAUT-USDC',
      'PAXG-USDC',
      'INTC-USDC',
      'AMD-USDC',
      'NVDA-USDC',
      'ASML-USDC',
      'SPCX-USDC',
      'AVGO-USDC',
      'TSLA-USDC',
      'MSFT-USDC',
      'ORCL-USDC',
      'META-USDC',
    ],
  },
};
