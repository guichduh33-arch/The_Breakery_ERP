// supabase/functions/_shared/manager-pin.ts
// Session 10 — manager-PIN verification helper used by cancel-item / void-order / refund-order.
//
// The cashier types the manager's 6-digit PIN; the EF doesn't know WHICH manager.
// We iterate active manager-tier profiles (MANAGER/ADMIN/SUPER_ADMIN) and call
// verify_user_pin RPC against each; the first match wins.
//
// This is fine for The Breakery scale (typically <10 managers). For larger
// organisations a dedicated lookup table or manager-id-with-PIN UX is preferable.
//
// Session 38 (Wave B1, SEC-07) — brute-force hardening:
//   Added per-IP fail bucket (MANAGER_PIN_FAIL_MAX attempts per MANAGER_PIN_FAIL_WINDOW_SEC).
//   WARNING: do NOT count failures per-manager — a wrong PIN fails against ALL candidates,
//   so per-manager counting would lock ALL managers on each typo (DoS vector).
//   The bucket is per-IP only, via checkRateLimitDurable with function_name='manager-pin-fail'.

import { getAdminClient } from './supabase-admin.ts';
import { checkRateLimitDurable } from './rate-limit.ts';

const PIN_REGEX = /^\d{6}$/;
const MANAGER_ROLES = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'];

// Brute-force guard constants (SEC-07).
export const MANAGER_PIN_FAIL_MAX = 5;
export const MANAGER_PIN_FAIL_WINDOW_SEC = 900; // 15 minutes

/**
 * Records a manager-PIN failure for the given IP in the durable rate-limit bucket.
 * Also inserts an audit_logs row (actor_id NULL — no known actor on wrong PIN).
 * Returns whether the IP is now blocked and for how long.
 *
 * ONLY call this on `verifyManagerPin` returning `{ok: false, reason: 'no_match'}`.
 * Do NOT call on invalid_pin_format (format errors are not brute-force signals).
 */
export async function recordManagerPinFailure(
  ip: string,
  functionName: string,
): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const admin = getAdminClient();

  // Consume a slot in the fail bucket (this increments the counter).
  const rl = await checkRateLimitDurable({
    functionName:  'manager-pin-fail',
    bucketKey:     `ip:${ip}`,
    ipAddress:     ip,
    maxPerWindow:  MANAGER_PIN_FAIL_MAX,
    windowSec:     MANAGER_PIN_FAIL_WINDOW_SEC,
  });

  // Audit the failure (actor_id is NULL — the PIN didn't match anyone).
  // supabase-js does not throw on DB errors — check the returned error explicitly.
  try {
    const { error: auditErr } = await admin.from('audit_logs').insert({
      actor_id:    null,
      action:      'manager_pin.failed',
      entity_type: 'edge_function',
      entity_id:   null,
      metadata:    { ip, function: functionName },
    });
    if (auditErr) console.warn('[manager-pin] audit_logs insert failed', auditErr);
  } catch (auditErr) {
    console.warn('[manager-pin] audit_logs insert failed', auditErr);
  }

  return { blocked: !rl.allowed, retryAfterSec: rl.retryAfterSec };
}

/**
 * Peek-only check: returns true if the IP is already blocked in the fail bucket
 * WITHOUT incrementing the counter.
 *
 * Reads directly from edge_function_rate_limits; returns false on DB error (fail-open).
 */
export async function isManagerPinBlocked(ip: string): Promise<boolean> {
  const admin = getAdminClient();
  try {
    const { data, error } = await admin
      .from('edge_function_rate_limits')
      .select('request_count, window_end')
      .eq('function_name', 'manager-pin-fail')
      .eq('bucket_key', `ip:${ip}`)
      .gt('window_end', new Date().toISOString())
      .maybeSingle();

    if (error) {
      console.warn('[manager-pin] isManagerPinBlocked read error, fail-open', error);
      return false;
    }
    if (!data) return false;
    return data.request_count >= MANAGER_PIN_FAIL_MAX;
  } catch (e) {
    console.warn('[manager-pin] isManagerPinBlocked unexpected error, fail-open', e);
    return false;
  }
}

export type ManagerPinResult =
  | { ok: true; manager_profile_id: string; role_code: string; full_name: string }
  | { ok: false; reason: 'invalid_pin_format' | 'no_match' | 'internal' };

export async function verifyManagerPin(pin: string): Promise<ManagerPinResult> {
  if (!PIN_REGEX.test(pin)) return { ok: false, reason: 'invalid_pin_format' };

  const admin = getAdminClient();

  // 1. Pull active manager-tier profiles.
  const { data: candidates, error: profilesErr } = await admin
    .from('user_profiles')
    .select('id, role_code, full_name, is_active, locked_until')
    .in('role_code', MANAGER_ROLES)
    .eq('is_active', true)
    .is('deleted_at', null);

  if (profilesErr) {
    console.error('[manager-pin] profiles fetch error', profilesErr);
    return { ok: false, reason: 'internal' };
  }
  if (!candidates || candidates.length === 0) {
    return { ok: false, reason: 'no_match' };
  }

  const now = Date.now();

  for (const c of candidates) {
    if (c.locked_until && new Date(c.locked_until).getTime() > now) continue;
    const { data: pinValid, error } = await admin.rpc('verify_user_pin', {
      p_user_id: c.id,
      p_pin: pin,
    });
    if (error) {
      console.error('[manager-pin] verify_user_pin error', error);
      continue;  // Try next candidate
    }
    if (pinValid) {
      return {
        ok: true,
        manager_profile_id: c.id,
        role_code: c.role_code,
        full_name: c.full_name,
      };
    }
  }

  return { ok: false, reason: 'no_match' };
}
