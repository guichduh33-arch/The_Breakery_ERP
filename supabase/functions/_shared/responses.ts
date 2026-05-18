// supabase/functions/_shared/responses.ts
// Session 22 / Phase 1.B.2 — DEV-S19-2.A-02. Shared HTTP response helpers
// beyond `jsonResponse` (which lives in cors.ts). This module hosts response
// builders that need to set additional header semantics (e.g. Retry-After).
//
// Why a separate module : keeps `cors.ts` focused on CORS basics and the
// generic JSON envelope. Helpers here are opinionated about HTTP semantics
// for specific status codes.

import { corsHeaders } from './cors.ts';

/**
 * Build a standard 429 Too Many Requests response with a `Retry-After` header
 * exposed via CORS. Body keeps the existing project shape `{ error, retry_after_sec }`
 * so callers that already parse it remain compatible.
 *
 * @param retryAfterSec  How many seconds the client should wait before retrying.
 *                       Clamped to a minimum of 1 (RFC 9110 §10.2.3 disallows 0
 *                       in delta-seconds form ; we also want browsers to back
 *                       off at least one tick).
 * @param errorCode      Optional body.error code override. Defaults to
 *                       'rate_limited' which mirrors the historical project
 *                       value emitted by all five rate-limited EFs.
 */
export function rateLimitedResponse(
  retryAfterSec: number,
  errorCode: string = 'rate_limited',
): Response {
  const safeRetryAfter = Math.max(1, Math.ceil(retryAfterSec || 1));
  // Expose `Retry-After` to browser fetch callers via CORS — without this header
  // in `Access-Control-Expose-Headers`, JS code cannot read response.headers.get('Retry-After')
  // when the response is cross-origin.
  const exposed = ['Retry-After'];
  return new Response(
    JSON.stringify({ error: errorCode, retry_after_sec: safeRetryAfter }),
    {
      status: 429,
      headers: {
        ...corsHeaders,
        'Content-Type': 'application/json',
        'Retry-After': String(safeRetryAfter),
        'Access-Control-Expose-Headers': exposed.join(', '),
      },
    },
  );
}
