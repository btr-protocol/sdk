// The storage generations a coverage word can be defaulted for. A leaf module (no imports): the amm
// codec, the liability mirror and the storage layouts all read it, and none may import another.

/** `Pool.storageVersion()` of the v2 pool (layout v10): the coverage words exist and are required. */
export const STORAGE_V2 = 12;

/** The v1 pools (layout v5, `storageVersion` 5..9): no coverage word exists on them. A WHITELIST: any
 *  other version, a future one included, or an unknown one, is not v1. */
export const isLegacyLayout = (storageVersion: number | undefined): boolean =>
  storageVersion !== undefined &&
  Number.isInteger(storageVersion) &&
  storageVersion >= 5 &&
  storageVersion <= 9;
