// packages/domain/src/payment/retryClassifier.ts
//
// Session 13 / Phase 4.A — Classify checkout / pay_existing_order errors into
// three buckets so the PaymentTerminal can pick the right UX:
//
// - `retryable`     : transient — show "Retry" button, preserve the same
//                     `idempotency_key` so the server returns the same row
//                     on replay (no double-charge).
// - `already_paid`  : the order was already finalized (idempotent replay or
//                     duplicate submission). Show a non-destructive banner;
//                     close the modal without retry.
// - `fatal`         : business validation failure (insufficient stock, fiscal
//                     period closed, invalid promotion). Show error; user
//                     must fix the cart, NOT retry with the same key.
//
// Pure TS — IO-free, unit-testable. Server `error` codes mirror the Postgres
// EXCEPTION codes raised by `complete_order_with_payment_v9` and
// `pay_existing_order_v6` ; see migration `20260517000015` body.

/**
 * Structured payload returned by Supabase RPC errors. The `details` field is
 * populated by `useCheckout` (`Object.assign(new Error(...), { details })`).
 */
export interface CheckoutErrorShape {
  /** The bare Postgres / EF error string, e.g. 'session_closed', 'already_paid'. */
  code?: string;
  /** Free-form server message; included in fatal `userMessage` as fallback. */
  message?: string;
}

export type RetryClassification =
  | { kind: 'retryable'; userMessage: string }
  | { kind: 'already_paid'; userMessage: string; orderNumber?: string }
  | { kind: 'fatal'; userMessage: string };

/**
 * Set of error codes the server returns for already-paid / replay conflicts.
 * Drawn from `complete_order_with_payment_v9` and `pay_existing_order_v6`
 * raise EXCEPTION sites:
 * - `already_paid`         : the order_id is already in `status='paid'`.
 * - `idempotent_replay`    : same `idempotency_key` already produced a row
 *                            (server returned the original; flag in JSON).
 * - `duplicate_payment`    : `(session_id, idempotency_key)` UNIQUE collision.
 */
const ALREADY_PAID_CODES = new Set<string>([
  'already_paid',
  'idempotent_replay',
  'duplicate_payment',
]);

/**
 * Errors the user can safely retry without changing the cart. Network blips,
 * stale sessions about to refresh, 5xx from the EF.
 */
const RETRYABLE_CODES = new Set<string>([
  'network_error',
  'fetch_failed',
  'timeout',
  'server_error',
  '5xx',
  'pgrst301', // PostgREST internal server error envelope (compared lowercase)
]);

/**
 * Classify a checkout error. Falls back to `fatal` when the code is unknown
 * (safer default — the user sees the message and can decide).
 *
 * @param err - The thrown error from `useCheckout.mutateAsync`. Expected to
 *              carry `.details.error` (set by the hook) OR `.details.code`.
 *              We probe both keys defensively.
 */
export function classifyCheckoutError(err: unknown): RetryClassification {
  const shape = extractErrorShape(err);
  const code = (shape.code ?? '').toLowerCase();

  if (code && ALREADY_PAID_CODES.has(code)) {
    return {
      kind: 'already_paid',
      userMessage: 'This order was already finalized. No action needed.',
    };
  }

  if (code && RETRYABLE_CODES.has(code)) {
    return {
      kind: 'retryable',
      userMessage:
        'Payment did not reach the server. Tap Retry to resend — your customer will not be charged twice.',
    };
  }

  // Heuristic: a network error from `fetch` typically throws a TypeError with
  // message 'Failed to fetch' (Chromium) / 'NetworkError when attempting to
  // fetch resource' (Firefox). Treat that as retryable.
  const msg = (shape.message ?? '').toLowerCase();
  if (msg.includes('failed to fetch') || msg.includes('networkerror') || msg.includes('network request failed')) {
    return {
      kind: 'retryable',
      userMessage:
        'Network unavailable. Tap Retry once the connection is back — the same payment ID will be reused.',
    };
  }

  return {
    kind: 'fatal',
    userMessage: friendlyFatalMessage(code, shape.message),
  };
}

/**
 * Convert raw error envelopes from `useCheckout.mutateAsync` to a canonical
 * shape. The hook attaches `details` for RPC errors and `details.error` for
 * EF errors — we read both.
 */
function extractErrorShape(err: unknown): CheckoutErrorShape {
  if (!err || typeof err !== 'object') return { message: String(err ?? '') };
  const e = err as {
    message?: string;
    details?: { error?: string; code?: string; message?: string };
  };
  const code = e.details?.error ?? e.details?.code;
  const message = e.message ?? e.details?.message;
  const out: CheckoutErrorShape = {};
  if (code) out.code = code;
  if (message) out.message = message;
  return out;
}

/**
 * Map known fatal codes to friendly copy ; default to "unknown error" wrapper.
 */
function friendlyFatalMessage(code: string, message?: string): string {
  switch (code) {
    case 'session_closed':
      return 'Your shift is closed. Open a new shift before charging.';
    case 'fiscal_period_closed':
      return 'The current fiscal period is closed. Contact your accountant.';
    case 'insufficient_stock':
      return 'One or more items are out of stock. Update the cart and try again.';
    case 'invalid_promotion':
    case 'promotion_not_applicable':
      return 'A promotion in this cart is no longer valid. Remove it and try again.';
    case 'invalid_loyalty_redemption':
      return 'Loyalty redemption is invalid (insufficient points or expired tier).';
    case 'account_locked':
      // S38 SEC-06 — the named manager hit 5 failed discount PINs.
      return 'Compte manager verrouillé 15 min (PIN erronés).';
    case '':
      return message ?? 'Payment failed for an unknown reason. Try again or contact support.';
    default:
      // Surface the raw code first so support / logs can correlate ; suffix
      // server message when present for human context.
      return message ? `Payment failed (${code}): ${message}` : `Payment failed (${code}).`;
  }
}
