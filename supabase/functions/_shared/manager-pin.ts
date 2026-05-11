// supabase/functions/_shared/manager-pin.ts
// Session 10 — manager-PIN verification helper used by cancel-item / void-order / refund-order.
//
// The cashier types the manager's 6-digit PIN; the EF doesn't know WHICH manager.
// We iterate active manager-tier profiles (MANAGER/ADMIN/SUPER_ADMIN) and call
// verify_user_pin RPC against each; the first match wins.
//
// This is fine for The Breakery scale (typically <10 managers). For larger
// organisations a dedicated lookup table or manager-id-with-PIN UX is preferable.

import { getAdminClient } from './supabase-admin.ts';

const PIN_REGEX = /^\d{6}$/;
const MANAGER_ROLES = ['MANAGER', 'ADMIN', 'SUPER_ADMIN'];

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
