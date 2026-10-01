import { describe, expect, test } from 'bun:test';
import type { Hex } from '../eth/types';
import { verifyPushP8 } from './p8';

// Real Monad (143) `publishMarks` inputs as the keepers landed them, and the store's auth word
// (`P8_AUTH_READ`) at the time: tier 1 in the high half, tier 2 in the low.
const FACTORY = '0xbBBbBBBb323D7f7E51976b8A8DF2Bb4B4608d9B3' as const;
const AUTH = 0xff46fcd2685aea76cbd1fc3788d4f942e67c3b9759a605d2d087570be44106e5n;
const ctx = { factory: FACTORY, chainId: 143, auth: AUTH };
const PRIMARY =
  '0x013b6436016abe148000000000000000107f220280845b03310751cb9a7465a4c39f97a942b8ba09c467e21382072f290cf83f354015e0214b11a86ce004a737c570421d6755cb4099d21c84afbfbd17410f121c0202b1ea5d344fc5f4ce77a9f931a8eda0f5803c5e7c47e1c98589a5981fc907567816c598944dfe074a2102248a7d1e439cacd2cdbc3f8aa7aedd0eb470d5fa419da638e026787d7cf73759528a77aa9b8d6a1dfb8bdb1b03bf7096b12d4aa74ed1a8f6f4f7e4536a4a1cccb06907eb8efc91f341b732b4979180d34abdf53ce840ec374822f5896ace204e8e84bd71ccfb326de4ca925a799a1ccef0ccb95d1d24f1128d2587724639a31c' as Hex;
const REFERENCE =
  '0x013b6436026abe14b4000000000000000c891a8da0845a891a8da0845a032531c59b43e61dc1a2ee49838ad28ebd120d0c7337e9d77cc15bfe851fd3e8558130a6b2e2bb59107c4deff1dc8352f3f9d0a417404b25571941bef80202b1ea5d344fc5f4ce77a9f931a8eda0f5803c5e7c47e1c98589a5981fc907567816c598944dfe074a924fac0e8594f3a5156099962e650953df58bded64c18a53604df01cb6fc3d316d5c8415a857b4185e4c773dc5de44a7c430faa8507d84a55fbb0e2e3a59a3641cff5b57dc3390e2eb3f40ff66ff8768d8775add3fef9817fa4418487aa9c771221168c46394d5ff7a7e57c7722ab69ab291a2201d9757ddf4113d3bfe126f8c231c' as Hex;

describe('publishMarks verification', () => {
  test('a primary push: 2 signers on a roster the store committed to', () => {
    const [s, ...rest] = verifyPushP8(PRIMARY, ctx);
    expect(rest).toEqual([]);
    expect({ tier: s.tier, lanes: s.lanes, k: s.k, committed: s.committed, ok: s.ok }).toEqual({
      tier: 1,
      lanes: 1,
      k: 2,
      committed: true,
      ok: true,
    });
    expect(s.recovered.map((a) => a.toLowerCase())).toEqual([
      '0x310751cb9a7465a4c39f97a942b8ba09c467e213',
      '0x82072f290cf83f354015e0214b11a86ce004a737',
    ]);
    expect(s.roster).toHaveLength(3);
  });

  test('a reference push verifies under its own tier domain and auth half', () => {
    const [s] = verifyPushP8(REFERENCE, ctx);
    expect({ tier: s.tier, ok: s.ok }).toEqual({ tier: 2, ok: true });
  });

  test('the wrong tier half, a flipped signature byte, or another chain fail', () => {
    // Swap the halves: each tier's roster no longer matches its commitment.
    const swapped = (AUTH >> 128n) | ((AUTH & ((1n << 128n) - 1n)) << 128n);
    expect(verifyPushP8(PRIMARY, { ...ctx, auth: swapped })[0].committed).toBe(false);
    const tampered = `${PRIMARY.slice(0, -4)}${PRIMARY.endsWith('00') ? '11' : '00'}00` as Hex;
    const t = verifyPushP8(tampered.slice(0, PRIMARY.length) as Hex, ctx)[0];
    expect(t.ok).toBe(false);
    // The domain binds the chain: the same bytes recover to other addresses elsewhere.
    expect(verifyPushP8(PRIMARY, { ...ctx, chainId: 1 })[0].quorum).toBe(false);
  });

  test('truncated or foreign calldata throws instead of verifying', () => {
    expect(() => verifyPushP8(PRIMARY.slice(0, 120) as Hex, ctx)).toThrow();
    expect(() => verifyPushP8('0xdeadbeef', ctx)).toThrow('not a publishMarks call');
  });
});
