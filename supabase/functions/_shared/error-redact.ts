// supabase/functions/_shared/error-redact.ts
// Redact PII / stack traces / internal hints from error responses sent to
// the client. Used by auth-verify-pin and other sensitive EFs (task 25-004).
//
// Threat: a `console.error(err)` followed by `jsonResponse({ error: err.message })`
// can leak DB column names, user emails, internal IP, stack frames pointing at
// source paths — all useful to an attacker. This helper centralizes the safe
// mapping from error → generic error code.
//
// Plan ref : docs/workplan/plans/2026-05-13-session-13-INDEX.md Phase 1.B (25-004)

const GENERIC_AUTH_ERROR = 'invalid_credentials';
const GENERIC_INTERNAL   = 'internal_error';

// Errors keyed here pass through unmodified (already client-safe).
const SAFE_PASSTHROUGH = new Set<string>([
  'rate_limited',
  'invalid_pin_format',
  'invalid_device_type',
  'invalid_json',
  'missing_fields',
  'invalid_scope',
  'kiosk_revoked',
  'kiosk_scope_mismatch',
  'ip_not_allowed',
  'kiosk_secret_required',
  'method_not_allowed',
  'server_misconfigured_no_jwt_secret',
  // Auth-domain client-safe codes
  'user_inactive',
  'account_locked',
  'network_timeout',
]);

// Auth/identity errors collapse to a single opaque code so an attacker cannot
// distinguish "unknown user" from "wrong PIN".
const AUTH_COLLAPSE = new Set<string>([
  'user_not_found',
  'invalid_pin',
  'kiosk_not_found',
  'kiosk_secret_invalid',
  'forbidden',
  'permission_denied',
]);

interface RedactedError {
  error: string;
  // Preserved fields per error code (whitelist):
  attempts_remaining?: number;
  retry_after_sec?: number;
  minutes_left?: number;
  code?: string;
}

export function redactError(
  rawError: string,
  preserved: Partial<RedactedError> = {},
): RedactedError {
  if (SAFE_PASSTHROUGH.has(rawError)) {
    return { error: rawError, ...preserved };
  }
  if (AUTH_COLLAPSE.has(rawError)) {
    return { error: GENERIC_AUTH_ERROR };
  }
  // Default: unknown error → generic internal. Never echo raw error message.
  return { error: GENERIC_INTERNAL };
}

/**
 * Log full error context server-side but emit a redacted body to the client.
 */
export function logAndRedact(
  context: string,
  rawError: unknown,
  preserved: Partial<RedactedError> = {},
): RedactedError {
  // Server-side logging keeps the raw error for forensics ; client gets a
  // generic message.
  const msg = rawError instanceof Error ? rawError.message : String(rawError);
  console.error(`[${context}]`, msg);
  return redactError(msg, preserved);
}
