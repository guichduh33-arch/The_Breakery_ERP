import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

// S78 (ré-armé — solde le skip daté S77 D-3) : la suite visait EMP000, dont le
// PIN a été changé PAR LE PROPRIÉTAIRE (décision 2026-07-14 : il reste privé,
// pas de reset). La mécanique testée (format/mauvais PIN/succès) n'est pas
// liée à un compte : repointée sur EMP003 (Manager Demo, PIN seed 111111).
//
// ⚠️ Rate-limit 3/min PAR IP RÉELLE : la gateway n'honore pas un
// x-forwarded-for client (constaté S78 — tout spoof retombe dans le bucket du
// runner). Chaque POST passe donc par postPin() qui, sur 429, attend
// retry_after_sec et réessaie — même discipline que loginAsViaPinEF.
async function postPin(body: unknown): Promise<Response> {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status !== 429) return res;
    const parsed = await res.json().catch(() => ({}));
    const waitSec = Math.min(Number(parsed?.retry_after_sec) || 30, 65);
    await new Promise((r) => setTimeout(r, (waitSec + 1) * 1000));
  }
  throw new Error('auth-verify-pin: still 429 after 4 attempts');
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('auth-verify-pin', () => {
  let managerUserId: string;

  const EMPLOYEE = 'EMP003';
  const PIN_VALID = '111111';

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('user_profiles').select('id').eq('employee_code', EMPLOYEE).single();
    if (!data) throw new Error('Seed not loaded — EMP003 missing');
    managerUserId = data.id;
    // Reset any lockout from previous test runs
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', managerUserId);
  });

  afterAll(async () => {
    // S78 (D-7) : ne pas laisser un compteur d'échecs au compte partagé.
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', managerUserId);
  });

  it('returns 400 if pin format invalid', async () => {
    const res = await postPin({ user_id: managerUserId, pin: 'abc', device_type: 'pos' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_pin_format');
  }, 240_000);

  it('returns 401 if pin wrong', async () => {
    // S58 : PIN 6 chiffres partout — un 4-digit serait un invalid_pin_format.
    const res = await postPin({ user_id: managerUserId, pin: '999999', device_type: 'pos' });
    expect(res.status).toBe(401);
    const body = await res.json();
    // S78 : l'EF redacte (error-redact) — invalid_pin sort en invalid_credentials.
    expect(['invalid_pin', 'invalid_credentials']).toContain(body.error);
  }, 240_000);

  it('returns 200 + session/auth tokens on valid pin', async () => {
    // First reset failed attempts
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('user_profiles').update({ failed_login_attempts: 0, locked_until: null }).eq('id', managerUserId);

    const res = await postPin({ user_id: managerUserId, pin: PIN_VALID, device_type: 'pos' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.full_name).toBe('Manager Demo');
    expect(body.session.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.auth.access_token).toBeTruthy();
    expect(body.permissions).toContain('pos.sale.create');
  }, 240_000);
});
