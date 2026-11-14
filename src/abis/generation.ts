/** The ABI generation this SDK build is pinned to: the one id sent as `?generation=` by the runtime
 * fetch and the postinstall script, and compared to the `x-btr-abi-generation` response header.
 * `abis.lock.json` chains.143.generation must equal it (asserted in test/abi-pin.test.ts). */
export const ABI_GENERATION = 'pool-v2-s12e';
