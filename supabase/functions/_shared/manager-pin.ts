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
// Les échecs sont comptés par IP ET par appelant authentifié, sur toutes les EF.
// Ne pas les compter par manager : le PIN seul teste tous les candidats et
// une faute de frappe verrouillerait chacun d'eux. Aucun repli mémoire seul
// n'est autorisé pour cette vérification privilégiée.

import { getAdminClient } from './supabase-admin.ts';
import { PermissionsUnavailableError } from './permissions.ts';

const PIN_REGEX = /^\d{6}$/;
const MANAGER_ROLES = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'];

// Brute-force guard constants (SEC-07).
export const MANAGER_PIN_FAIL_MAX = 5;
export const MANAGER_PIN_FAIL_WINDOW_SEC = 900; // 15 minutes

function failureBuckets(ip: string, actingAuthUserId: string): string[] {
  if (!actingAuthUserId) throw new PermissionsUnavailableError();
  return [`ip:${ip}`, `actor:${actingAuthUserId}`];
}

/** Seulement après un PIN sans correspondance ; jamais après une panne DB. */
export async function recordManagerPinFailure(
  ip: string,
  functionName: string,
  actingAuthUserId: string,
): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const admin = getAdminClient();

  const results = await Promise.all(failureBuckets(ip, actingAuthUserId).map(async (bucketKey) => {
    try {
      // La RPC sérialise les compteurs entre instances. Une erreur ne doit
      // jamais être transformée en autorisation par le repli mémoire générique.
      const { data, error } = await admin.rpc('record_rate_limit_v1', {
        p_function_name: 'manager-pin-fail', p_bucket_key: bucketKey,
        p_ip_address: ip, p_max_per_window: MANAGER_PIN_FAIL_MAX,
        p_window_sec: MANAGER_PIN_FAIL_WINDOW_SEC,
      });
      const row = data?.[0];
      if (error || !row || typeof row.allowed !== 'boolean'
        || !Number.isInteger(row.retry_after_sec) || row.retry_after_sec < 0
        || !Number.isInteger(row.current_count) || row.current_count < 1) {
        throw new PermissionsUnavailableError();
      }
      return { blocked: !row.allowed, retryAfterSec: row.retry_after_sec };
    } catch {
      console.error('[manager-pin] durable failure counter unavailable');
      throw new PermissionsUnavailableError();
    }
  }));

  // Manager inconnu ; l'appelant vérifié reste attribuable sans confondre
  // auth.users.id et user_profiles.id dans actor_id.
  try {
    const { error: auditErr } = await admin.from('audit_logs').insert({
      actor_id:    null,
      action:      'manager_pin.failed',
      entity_type: 'edge_function',
      entity_id:   null,
      metadata:    { ip, function: functionName, acting_auth_user_id: actingAuthUserId },
    });
    if (auditErr) console.warn('[manager-pin] audit_logs insert failed', auditErr);
  } catch (auditErr) {
    console.warn('[manager-pin] audit_logs insert failed', auditErr);
  }

  return { blocked: results.some((r) => r.blocked),
    retryAfterSec: Math.max(...results.map((r) => r.retryAfterSec)) };
}

/** Lecture sans incrément ; une panne refuse l'autorisation privilégiée. */
export async function isManagerPinBlocked(ip: string, actingAuthUserId: string): Promise<boolean> {
  const admin = getAdminClient();
  const results = await Promise.all(failureBuckets(ip, actingAuthUserId).map(async (bucketKey) => {
    try {
      const { data, error } = await admin
        .from('edge_function_rate_limits')
        .select('request_count, window_end')
        .eq('function_name', 'manager-pin-fail')
        .eq('bucket_key', bucketKey)
        .gt('window_end', new Date().toISOString())
        .maybeSingle();
      if (error || data === undefined || (data !== null
        && (!Number.isInteger(data.request_count) || data.request_count < 0))) {
        throw new PermissionsUnavailableError();
      }
      return data !== null && data.request_count >= MANAGER_PIN_FAIL_MAX;
    } catch {
      console.error('[manager-pin] durable failure bucket unavailable');
      throw new PermissionsUnavailableError();
    }
  }));
  return results.some(Boolean);
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
      return { ok: false, reason: 'internal' };
    }
    if (typeof pinValid !== 'boolean') return { ok: false, reason: 'internal' };
    if (pinValid === true) {
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
