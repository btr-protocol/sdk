/** The committed mark table back compiles in, against the NXR_MARKS it is generated from, and
 *  every feed a deployed chain carries against that table. */
import { expect, test } from 'bun:test';
import { marksJson } from '../scripts/gen-nxr-marks';
import { DEPLOYED_VENUES } from '../src/venues/deployments.generated';
import { nxrMark } from '../src/venues/nxr';
import marks from '../src/venues/nxr-marks.generated.json';

test('committed marks = NXR_MARKS', () => {
  expect(marks).toEqual(marksJson() as typeof marks);
});

test('every feed of every deployed chain has a mark source', () => {
  for (const v of Object.values(DEPLOYED_VENUES))
    for (const name of Object.keys(v.feedIds)) {
      const sym = name.slice(0, name.lastIndexOf('-'));
      expect(nxrMark(sym) ?? nxrMark(`${sym}B`), `${v.chainId} ${name}`).not.toBeNull();
    }
});
