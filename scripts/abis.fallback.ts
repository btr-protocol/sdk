/** Committed stale fallback for `fetch-abis.ts`: the hot-path minimum (writes + key reads) so a
 * fresh clone with no backend and no sibling checkouts (front Docker via SDK_REF) still
 * typechecks and builds. Every entry mirrors the deployed ABI shapes; the script integrity-pins
 * these same selectors on the fetched bytes. STALE BY DESIGN: refresh via `bun run fetch-abis`
 * with the backend reachable. */

const fn = (
  name: string,
  inputs: { name: string; type: string }[],
  outputs: { name: string; type: string; components?: { name: string; type: string }[] }[],
  stateMutability: string,
): unknown => ({ type: 'function', name, inputs, outputs, stateMutability });

const T = (name: string, type: string): { name: string; type: string } => ({ name, type });

const ASSET = [
  T('reserves', 'uint128'),
  T('liabilities', 'uint128'),
  T('anchor', 'address'),
  T('minLiquidity', 'uint96'),
  T('liquidityIndexWad', 'uint96'),
  T('minDispersionPbps', 'uint32'),
  T('presetId', 'uint16'),
  T('minFeePbps', 'uint16'),
  T('vegaBps', 'uint16'),
  T('haircutSuppressorBps', 'uint16'),
  T('decimals', 'uint8'),
  T('deadSeedPow10', 'uint8'),
  T('flags', 'uint16'),
  T('kappaCovBps', 'uint16'),
];

const SWAP_QUOTE = [
  T('amountOut', 'uint256'),
  T('amountIn', 'uint256'),
  T('spreadPbps', 'uint16'),
  T('protoFee', 'uint256'),
  T('lpFee', 'uint256'),
  T('skewIn', 'int8'),
  T('skewOut', 'int8'),
  T('markPrice', 'uint256'),
  T('midPrice', 'uint256'),
  T('covToll', 'uint256'),
  T('routeHops', 'address[]'),
  T('hopAmounts', 'uint256[]'),
  T('hopPrices', 'uint256[]'),
];

const WITHDRAW_RESULT = [T('amountOut', 'uint256'), T('lpBurned', 'uint256')];

const err = (name: string, inputs: { name: string; type: string }[]): unknown => ({
  type: 'error',
  name,
  inputs,
});
const FEED_DATA_V1 = [
  T('lastPriceB64', 'uint64'),
  T('sigmaPbps', 'uint32'),
  T('updatedAtSecs', 'uint32'),
  T('ttlSecs', 'uint16'),
  T('confidenceBps', 'uint16'),
  T('flags', 'uint16'),
  T('maxDeviationBps', 'uint16'),
  T('sourceTsMs', 'uint48'),
];

export const ABI_FALLBACKS: Record<string, unknown[]> = {
  Pool: [
    fn(
      'swap',
      [
        T('tokenIn', 'address'),
        T('tokenOut', 'address'),
        T('amountIn', 'uint256'),
        T('minAmountOut', 'uint256'),
        T('recipient', 'address'),
        T('deadline', 'uint256'),
      ],
      [T('out', 'uint256')],
      'payable',
    ),
    fn(
      'deposit',
      [T('token', 'address'), T('amount', 'uint256')],
      [
        {
          name: '',
          type: 'tuple',
          components: [
            T('lpAmount', 'uint256'),
            T('actualDeposit', 'uint256'),
            T('deadLp', 'uint256'),
          ],
        },
      ],
      'payable',
    ),
    fn(
      'withdraw',
      [
        T('token', 'address'),
        T('lpAmount', 'uint256'),
        T('minAmountOut', 'uint256'),
        T('deadline', 'uint256'),
      ],
      [{ name: '', type: 'tuple', components: WITHDRAW_RESULT }],
      'nonpayable',
    ),
    fn(
      'withdrawTo',
      [
        T('tokenFrom', 'address'),
        T('tokenTo', 'address'),
        T('lpAmount', 'uint256'),
        T('minAmountOut', 'uint256'),
        T('deadline', 'uint256'),
      ],
      [{ name: '', type: 'tuple', components: WITHDRAW_RESULT }],
      'nonpayable',
    ),
    fn(
      'swapLiability',
      [
        T('tokenIn', 'address'),
        T('tokenOut', 'address'),
        T('lpAmountIn', 'uint256'),
        T('minLpAmountOut', 'uint256'),
        T('deadline', 'uint256'),
      ],
      [T('lpAmountOut', 'uint256')],
      'nonpayable',
    ),
    fn(
      'previewWithdraw',
      [T('tk', 'address'), T('lp', 'uint256')],
      [T('', 'uint256'), T('', 'uint256')],
      'view',
    ),
    fn('getAsset', [T('tk', 'address')], [{ name: '', type: 'tuple', components: ASSET }], 'view'),
    fn(
      'getSwapQuote',
      [T('tokenIn', 'address'), T('tokenOut', 'address'), T('amountIn', 'uint256')],
      [{ name: '', type: 'tuple', components: SWAP_QUOTE }],
      'view',
    ),
    fn('getCoverageRatio', [T('tk', 'address')], [T('', 'uint256')], 'view'),
    fn('getLPBalance', [T('u', 'address'), T('tk', 'address')], [T('', 'uint256')], 'view'),
    err('StaleData', [T('age', 'uint32'), T('maxAge', 'uint32')]),
    err('BaseDepegged', [T('basePriceWad', 'uint256'), T('deviationBps', 'uint256')]),
  ],
  Admin: [
    fn(
      'requestOp',
      [T('pool', 'address'), T('opType', 'uint8'), T('subject', 'bytes32'), T('payload', 'bytes')],
      [],
      'nonpayable',
    ),
    fn(
      'cancelTimelock',
      [T('pool', 'address'), T('opType', 'uint8'), T('subject', 'bytes32')],
      [],
      'nonpayable',
    ),
    fn(
      'haltAsset',
      [T('pool', 'address'), T('token', 'address'), T('src', 'uint16')],
      [],
      'nonpayable',
    ),
    fn(
      'unhaltAsset',
      [T('pool', 'address'), T('token', 'address'), T('src', 'uint16')],
      [],
      'nonpayable',
    ),
  ],
  ExternalOracle: [
    fn('batchPushSigned', [T('blob', 'bytes'), T('sigs', 'bytes')], [], 'nonpayable'),
    fn(
      'getFeed',
      [T('feedId', 'bytes32')],
      [{ name: 'data', type: 'tuple', components: FEED_DATA_V1 }],
      'view',
    ),
    fn('isFeedFresh', [T('feedId', 'bytes32')], [T('', 'bool')], 'view'),
    fn('isFeedFresh', [T('feedId', 'bytes32'), T('maxAge', 'uint32')], [T('', 'bool')], 'view'),
  ],
};
