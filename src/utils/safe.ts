// ─────────────────────────────────────────────────────────────
// Timing & Retry
// ─────────────────────────────────────────────────────────────

/**
 * Sleep utility
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `e.message` of an `Error`, else `fallback` (default `String(e)`): the one `catch` -> text. */
export const errMsg = (e: unknown, fallback = String(e)): string =>
  e instanceof Error ? e.message : fallback;
