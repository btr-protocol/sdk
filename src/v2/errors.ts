/**
 * Typed errors for the chain-mode (`/v2`) surface.
 *
 * The v1 client read a bare `Error` message (and a regex over a 429 body); the front had to parse
 * prose to tell "quotes unavailable" from "no liquidity" from "slow down". Here the HTTP status
 * and the server's `{error}` code become one closed union, so a caller branches on a value.
 */

export type V2ErrorKind =
  | 'bad_request'
  | 'no_route'
  | 'rate_limited'
  | 'rpc_unavailable'
  | 'deadline'
  | 'refused'
  | 'transport'
  | 'floor_violation'
  | 'stale_block'
  | 'not_implemented';

export class V2Error extends Error {
  readonly kind: V2ErrorKind;
  /** HTTP status when the failure came from a response; 0 for a client-side rejection. */
  readonly status: number;
  /** Seconds to wait on `rate_limited`/`rpc_unavailable`, from `Retry-After`. */
  readonly retryAfterSecs: number | undefined;
  /** The server's `detail`, or the raw body when it did not parse. */
  readonly detail: string | undefined;

  constructor(
    kind: V2ErrorKind,
    message: string,
    opts: { status?: number; retryAfterSecs?: number; detail?: string } = {},
  ) {
    super(message);
    this.name = 'V2Error';
    this.kind = kind;
    this.status = opts.status ?? 0;
    this.retryAfterSecs = opts.retryAfterSecs;
    this.detail = opts.detail;
  }
}

/** HTTP status → the closed union. 200 is the caller's to handle, never passed here. */
export function parseV2Error(status: number, body: string, retryAfterSecs?: number): V2Error {
  let detail: string | undefined;
  let code = '';
  try {
    const j = JSON.parse(body) as { error?: unknown; detail?: unknown };
    if (typeof j.error === 'string') code = j.error;
    if (typeof j.detail === 'string') detail = j.detail;
  } catch {
    detail = body || undefined;
  }
  const kind: V2ErrorKind =
    status === 429
      ? 'rate_limited'
      : status === 503
        ? 'rpc_unavailable'
        : status === 504
          ? 'deadline'
          : status === 501
            ? 'not_implemented'
            : status === 422
              ? 'no_route'
              : status === 400
                ? 'bad_request'
                : 'transport';
  const message = code || detail || `BTR v2 API ${status}`;
  return new V2Error(kind, message, { status, retryAfterSecs, detail });
}
