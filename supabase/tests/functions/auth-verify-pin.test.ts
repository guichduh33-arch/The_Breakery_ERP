import { describe, it, expect, beforeAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';
// S77: anon key from the shared helper (real publishable fallback) — the
// `?? ''` form fed an empty key in CI where the unset secret is "".
import { ANON_KEY as ANON } from './_helpers/auth';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

// ⚠️ EXCLUSION DATÉE 2026-07-14 (S77, D-3) : cette suite POSTe le PIN d'EMP000
// à l'EF — c'est l'objet du test — mais le PIN d'EMP000 a DÉRIVÉ sur la base
// dev vivante (aucun PIN historique ne vérifie ; probablement changé par un
// humain via l'app — finding F-2, INDEX S77). Ne PAS reset sans décision
// propriétaire. Ré-armer ce describe dès que le PIN est connu/décidé.
describe.skip('auth-verify-pin', () => {
  let adminUserId: string;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('user_profiles').select('id').eq('employee_code', 'EMP000').single();
    if (!data) throw new Error('Seed not loaded — run supabase db reset');
    adminUserId = data.id;
    // Reset any lockout from previous test runs
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', adminUserId);
  });

  it('returns 400 if pin format invalid', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: adminUserId, pin: 'abc', device_type: 'pos' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_pin_format');
  });

  it('returns 401 if pin wrong', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: adminUserId, pin: '9999', device_type: 'pos' }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('invalid_pin');
    expect(body.attempts_remaining).toBeGreaterThanOrEqual(0);
  });

  it('returns 200 + session/auth tokens on valid pin', async () => {
    // First reset failed attempts
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('user_profiles').update({ failed_login_attempts: 0, locked_until: null }).eq('id', adminUserId);

    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: adminUserId, pin: '1234', device_type: 'pos' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.full_name).toBe('Mamat (Owner)');
    expect(body.session.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.auth.access_token).toBeTruthy();
    expect(body.permissions).toContain('pos.sale.create');
  });
});
