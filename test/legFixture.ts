import { type PoolLeg, buildLeg } from '../src/amm/aimm.js';

type Feed = NonNullable<Parameters<typeof buildLeg>[9]>;

/** Test fixture: a leg of a pool KNOWN to be v1 (storageVersion 7, a layout-v5 pool). An absent coverage word is 0
 *  there; on an unknown or v2 generation it is unquotable, so fixtures must say which they are. */
export const buildLegV1 = (
  ...a: [...(Parameters<typeof buildLeg> extends [...infer H, unknown?] ? H : never), feed?: Feed]
): PoolLeg => {
  const [token, twap, sigma, res, liab, baseRes, decimals, profile, kappaCovBps, feed] = a;
  return {
    ...buildLeg(token, twap, sigma, res, liab, baseRes, decimals, profile, kappaCovBps, {
      storageVersion: 7,
      ...feed,
    }),
    liquidRes: res,
    minLiquidity: 0, // declared: an absent floor is unknown, and a route over it is unfeasible
  };
};
