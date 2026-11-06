import { describe, expect, test } from 'bun:test';
import { laneSymbolByGi, oracleLaneMap } from '../src/venues/index.js';

// Pool v2 Monad (wire 9): PoolFactory is the EIP-712 verifyingContract (CREATE3 row stablePoolFactory).
const PF = '0xbbbbbbb16b9B5Fa94AD8CD35e696bEA55DB9C8B0';

describe('oracle lanes, wire 9 (pool v2)', () => {
  const map = oracleLaneMap(143, PF);
  test('13 dense lanes keyed on the PoolFactory', () => {
    expect(map?.wire).toBe('v9');
    expect(map?.lanesPerSlot).toBe(4);
    const bySym = laneSymbolByGi(map!);
    expect([...bySym.keys()].sort((a, b) => a - b)).toEqual([...Array(13).keys()]);
    expect(bySym.get(0)).toBe('USDC-USD');
    expect(bySym.get(3)).toBe('WBTC');
    expect(bySym.get(12)).toBe('SYRUPUSDC');
    expect(map?.feeds['USDC-USD']?.ref).toBe(true);
  });
  test('wire 8 Monad maps are untouched', () => {
    expect(oracleLaneMap(143, '0xbbbbbbbbbd5e955E20F323cA1F95f8191fD0E0BF')?.wire).toBe('v8');
  });
});
