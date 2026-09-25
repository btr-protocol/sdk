// ─────────────────────────────────────────────────────────────
// Safe JSON Parsing
// ─────────────────────────────────────────────────────────────

/**
 * Safe JSON parsing with type safety
 * Validates that result is an object (not array, not null)
 */
export const safeJson = <T extends object>(text: string): T | undefined => {
  try {
    const v = JSON.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : undefined;
  } catch {
    return undefined;
  }
};
