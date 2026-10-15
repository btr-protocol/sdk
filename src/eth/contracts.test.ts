/** SA-C10-19: the placeholder registry never hands out zeroAddress as a target.
 *
 *  zeroAddress is truthy, so returning it for an undeployed contract lets a future caller treat
 *  "not deployed" as a destination. Undeployed reads as `undefined` — the same answer an unknown
 *  chain already gets — and the one real entry still resolves.
 */
import { describe, expect, test } from 'bun:test';
import {
  getBtrAccessControl,
  getBtrAdmin,
  getBtrPoolFactory,
  getContractAddress,
} from './contracts.js';

describe('placeholder contract registry', () => {
  test('zeroAddress placeholders read as undefined, never as a target', () => {
    expect(getContractAddress(1, 'POOL_FACTORY')).toBeUndefined();
    expect(getContractAddress(1, 'BTR')).toBeUndefined();
    expect(getBtrPoolFactory(1)).toBeUndefined();
    expect(getBtrAdmin(56)).toBeUndefined();
    expect(getBtrAccessControl(8453)).toBeUndefined();
    expect(getContractAddress(999_999, 'ORACLE')).toBeUndefined();
  });

  test('real entries still resolve', () => {
    expect(getContractAddress(31337, 'TREASURY')).toBe(
      '0x0a37aEc263CbA0aaBC09Bac56A0F2074a22E69A3',
    );
  });
});
