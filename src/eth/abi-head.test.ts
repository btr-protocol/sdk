import { describe, expect, test } from 'bun:test';
import { type AbiParameter, encodeAbiParameters, encodeFn } from './abi';

// Hand-computed ABI words: no viem/ethers dependency in this package. Offsets
// below are byte counts from the start of the containing tuple/array head.
const word = (n: number | bigint) => n.toString(16).padStart(64, '0');
const bytesWord = (hex: string) => hex.padEnd(64, '0');

describe('static composite head sizes', () => {
  test('Settler.execute matches the complete hand-computed calldata', () => {
    // ISettlerTakerSubmitted.execute((address,address,uint256),bytes[],bytes32)
    const abi = [
      {
        type: 'function' as const,
        name: 'execute',
        inputs: [
          {
            name: 'slippage',
            type: 'tuple',
            components: [
              { name: 'recipient', type: 'address' },
              { name: 'buyToken', type: 'address' },
              { name: 'minAmountOut', type: 'uint256' },
            ],
          },
          { name: 'actions', type: 'bytes[]' },
          { name: 'zid', type: 'bytes32' },
        ],
      },
    ];
    const data = encodeFn({
      abi,
      functionName: 'execute',
      args: [
        {
          recipient: `0x${'11'.repeat(20)}`,
          buyToken: `0x${'22'.repeat(20)}`,
          minAmountOut: 123n,
        },
        ['0xdeadbeef', '0x'],
        `0x${'ab'.repeat(32)}`,
      ],
    });
    expect(data).toBe(
      `0x1fff991f${[
        '11'.repeat(20).padStart(64, '0'),
        '22'.repeat(20).padStart(64, '0'),
        word(123),
        word(0xa0), // 3 slippage words + actions pointer + zid
        'ab'.repeat(32),
        word(2), // actions length; element offsets start AFTER this word
        word(0x40),
        word(0x80),
        word(4),
        bytesWord('deadbeef'),
        word(0), // empty second action
      ].join('')}`,
    );
  });

  test('multidimensional fixed array before bytes uses its full inline width', () => {
    expect(
      encodeAbiParameters(
        [{ type: 'uint256[2][2]' }, { type: 'bytes' }],
        [
          [
            [1n, 2n],
            [3n, 4n],
          ],
          '0xaabb',
        ],
      ),
    ).toBe(
      `0x${[word(1), word(2), word(3), word(4), word(0xa0), word(2), bytesWord('aabb')].join('')}`,
    );
  });

  test('nested static tuples and fixed tuple arrays before a string', () => {
    const params: AbiParameter[] = [
      {
        type: 'tuple',
        components: [
          { type: 'tuple', components: [{ type: 'uint256' }, { type: 'bool' }] },
          { type: 'tuple[2]', components: [{ type: 'uint256[2]' }] },
        ],
      },
      { type: 'string' },
    ];
    expect(
      encodeAbiParameters(params, [
        [
          [1n, true],
          [[[2n, 3n]], [[4n, 5n]]],
        ],
        'hi',
      ]),
    ).toBe(
      `0x${[
        word(1),
        word(1),
        word(2),
        word(3),
        word(4),
        word(5),
        word(0xe0),
        word(2),
        bytesWord('6869'),
      ].join('')}`,
    );
  });

  test.each(['tuple[]', 'tuple[1]'])(
    '%s elements size nested heads relative to each tuple',
    (type) => {
      const params: AbiParameter[] = [
        {
          type,
          components: [{ type: 'uint256[2]' }, { type: 'bytes' }],
        },
      ];
      expect(encodeAbiParameters(params, [[[[7n, 8n], '0xff']]])).toBe(
        `0x${[
          word(0x20),
          ...(type === 'tuple[]' ? [word(1)] : []),
          word(0x20), // pointer to the dynamic tuple
          word(7),
          word(8),
          word(0x60),
          word(1),
          bytesWord('ff'),
        ].join('')}`,
      );
    },
  );
});
