// Signed bytes with an access list, against `cast mktx` (Foundry 1.9.0, an implementation
// independent of this repo): key 0x..01 (the well-known test key), chain 143, nonce 5, gas 100000,
// to 0x22..22, value 7, data f(uint256)(1), and the two-entry list below. Commands (K = that key,
// AL = [{address 0xab..ab, storageKeys [0xcd..cd]}, {address 0x11..11, storageKeys []}]):
//   type 2 + list   cast mktx --private-key $K --chain 143 --nonce 5 --gas-limit 100000 --priority-gas-price 1000000000 --gas-price 2000000000 --value 7 --access-list "$AL" 0x22..22 'f(uint256)' 1
//   type 2, no list the same without --access-list
//   type 1          cast mktx --private-key $K --chain 143 --nonce 5 --gas-limit 100000 --legacy --gas-price 2000000000 --value 7 --access-list "$AL" 0x22..22 'f(uint256)' 1
//   legacy, no list cast mktx --private-key $K --chain 143 --nonce 5 --gas-limit 100000 --legacy --gas-price 2000000000 --value 7 0x22..22 'f(uint256)' 1
// (the EIP-155 spec vector for legacy is also pinned in test/tx-vectors.test.ts)
import { describe, expect, test } from 'bun:test';
import { signTransaction } from './client';
import type { Eip1193Provider, Hex } from './types';

const KEY = `0x${'0'.repeat(63)}1` as Hex;
const provider = { request: async () => '0x8f' } as unknown as Eip1193Provider;
const LIST = [
  { address: `0x${'ab'.repeat(20)}` as Hex, storageKeys: [`0x${'cd'.repeat(32)}` as Hex] },
  { address: `0x${'11'.repeat(20)}` as Hex, storageKeys: [] as Hex[] },
];
const base = {
  from: '0x7E5F4552091A69125d5DfCb7b8C2659029395Bdf' as Hex,
  to: `0x${'22'.repeat(20)}` as Hex,
  data: '0xb3de648b0000000000000000000000000000000000000000000000000000000000000001' as Hex,
  value: '0x7' as Hex,
  nonce: '0x5' as Hex,
  gas: '0x186a0' as Hex,
};
const T2 =
  '0x02f8e0818f05843b9aca008477359400830186a094222222222222222222222222222222222222222207a4b3de648b0000000000000000000000000000000000000000000000000000000000000001f84ff794ababababababababababababababababababababe1a0cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdd6941111111111111111111111111111111111111111c001a04c5f739d216a0623c7b5406cc92b2d757ba783153be8c68600715490995b51b2a02da9c0070703a6384d4647677e7e7c31726e925addcefd2d18a37b7ab1609542';
const T2_EMPTY =
  '0x02f890818f05843b9aca008477359400830186a094222222222222222222222222222222222222222207a4b3de648b0000000000000000000000000000000000000000000000000000000000000001c080a0a756bae0e0e5d405cc06891845c18e53f51e03151506a3c211a13e4491e53c0da079f1c01bb8a032387f1dcfca3ff6b8bcd1d140eb4c73e977b2ccdaaebdf71e1c';
const T1 =
  '0x01f8db818f058477359400830186a094222222222222222222222222222222222222222207a4b3de648b0000000000000000000000000000000000000000000000000000000000000001f84ff794ababababababababababababababababababababe1a0cdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdd6941111111111111111111111111111111111111111c080a00344bde277179cee102441b41e6938a7afb087b928046e6134daf51d39d08c0ca00da9c9668b223f705e8526ce00d9c66cb2fbf5513803bf183a8261ba3c0e4c9a';
const fees = { maxPriorityFeePerGas: '0x3b9aca00' as Hex, maxFeePerGas: '0x77359400' as Hex };

describe('signTransaction with an access list', () => {
  test('type 2 carries the list in preimage and payload', async () => {
    expect(await signTransaction(provider, { ...base, ...fees, accessList: LIST }, KEY)).toBe(T2);
  });
  test('type 2 without a list is unchanged', async () => {
    expect(await signTransaction(provider, { ...base, ...fees }, KEY)).toBe(T2_EMPTY);
  });
  test('legacy price with a list is type 1 (EIP-2930)', async () => {
    const gasPrice = '0x77359400' as Hex;
    expect(await signTransaction(provider, { ...base, gasPrice, accessList: LIST }, KEY)).toBe(T1);
  });
  test('legacy without a list is byte-identical to the pre-existing encoding', async () => {
    const gasPrice = '0x77359400' as Hex;
    expect(await signTransaction(provider, { ...base, gasPrice }, KEY)).toBe(
      '0xf88a058477359400830186a094222222222222222222222222222222222222222207a4b3de648b0000000000000000000000000000000000000000000000000000000000000001820141a00f5414ca324687b3cd7506a634eea90281311f73e65371277f6c96521af398cfa05be2b0ad4e720940b4c3e5506efcf7a654fc3e233299020d35285b7fd799e03b',
    );
  });
  test('a malformed list is never signed', async () => {
    const bad = [
      [{ address: '0x1234' as Hex, storageKeys: [] as Hex[] }],
      [{ address: LIST[0].address, storageKeys: ['0x12' as Hex] }],
      [{ address: LIST[0].address, storageKeys: 'x' as unknown as Hex[] }],
    ];
    for (const accessList of bad) {
      await expect(
        signTransaction(provider, { ...base, ...fees, accessList }, KEY),
      ).rejects.toThrow(/access list/);
      await expect(
        signTransaction(provider, { ...base, gasPrice: '0x1' as Hex, accessList }, KEY),
      ).rejects.toThrow(/access list/);
    }
  });
});
