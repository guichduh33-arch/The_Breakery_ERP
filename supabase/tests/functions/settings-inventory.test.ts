// supabase/tests/functions/settings-inventory.test.ts
// Task 1 — live integration tests for the inventory settings category.
// Verifies: get_settings_by_category_v1('inventory') returns allow_negative_stock
// and set_setting_v1('allow_negative_stock', ...) round-trips correctly.
//
// Pattern mirrors adjust-stock.test.ts / users.test.ts: PIN-login → JWT client → rpc().

import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE      = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const ANON         = process.env.SUPABASE_ANON_KEY
  ?? process.env.VITE_SUPABASE_ANON_KEY
  ?? 'sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH';
const PIN_FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

async function loginAs(employeeCode: string, pin: string): Promise<string> {
  const admin = createClient(SUPABASE_URL, SERVICE);
  await admin.from('user_profiles')
    .update({ failed_login_attempts: 0, locked_until: null })
    .eq('employee_code', employeeCode);
  const { data: profile } = await admin.from('user_profiles')
    .select('id').eq('employee_code', employeeCode).single();
  if (!profile) throw new Error(`No profile for ${employeeCode}`);

  const res = await fetch(PIN_FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_id: profile.id, pin, device_type: 'backoffice' }),
  });
  const body = await res.json() as { auth?: { access_token?: string } };
  if (!body.auth?.access_token) throw new Error(`Login failed for ${employeeCode}: ${JSON.stringify(body)}`);
  return body.auth.access_token;
}

function jwtClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('inventory settings — allow_negative_stock', () => {
  let adminToken: string;
  let cashierToken: string;

  beforeAll(async () => {
    adminToken   = await loginAs('EMP000', '123456');
    cashierToken = await loginAs('EMP001', '567890');
  });

  it('reads the inventory category with a boolean default', async () => {
    const sb = jwtClient(adminToken);
    const { data, error } = await sb.rpc('get_settings_by_category_v1', { p_category: 'inventory' });
    expect(error).toBeNull();
    expect(data.category).toBe('inventory');
    expect(typeof data.settings.allow_negative_stock).toBe('boolean');
  });

  it('round-trips a write through set_setting_v1', async () => {
    const sb = jwtClient(adminToken);
    const { error: setErr } = await sb.rpc('set_setting_v1', {
      p_key: 'allow_negative_stock',
      p_value: false,
      p_category: 'inventory',
    });
    expect(setErr).toBeNull();

    const { data: after, error: getErr } = await sb.rpc('get_settings_by_category_v1', { p_category: 'inventory' });
    expect(getErr).toBeNull();
    expect(after.settings.allow_negative_stock).toBe(false);

    // restore default
    await sb.rpc('set_setting_v1', {
      p_key: 'allow_negative_stock',
      p_value: true,
      p_category: 'inventory',
    });
  });

  it('rejects a non-boolean value', async () => {
    const sb = jwtClient(adminToken);
    const { error } = await sb.rpc('set_setting_v1', {
      p_key: 'allow_negative_stock',
      p_value: 'yes',
      p_category: 'inventory',
    });
    expect(error).not.toBeNull();
  });

  it('cashier cannot read settings (permission denied)', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('get_settings_by_category_v1', { p_category: 'inventory' });
    expect(error).not.toBeNull();
  });
});
