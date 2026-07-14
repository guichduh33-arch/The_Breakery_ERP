// supabase/tests/functions/auth-verify-pin-rate-limit.test.ts
// Session 13 / Phase 1.B — task 25-002 rate-limit hardening.
//
// Verifies the per-IP rate-limit on auth-verify-pin is 3/min. The 4th request
// within 60s from the same IP must 429.
//
// S78 (ré-armé — solde le skip daté S77 D-3) : la suite ne teste QUE des PINs
// faux — elle n'a jamais eu besoin du vrai PIN d'EMP000 (changé par le
// propriétaire, décision 2026-07-14 : privé, pas de reset). Repointée sur
// EMP003 pour ne plus matraquer le compteur d'échecs du compte owner.
//
// ⚠️ Redesign S78 : la gateway n'honore PAS un x-forwarded-for client — tout
// tombe dans le bucket de l'IP RÉELLE du runner (3/min). Les anciens buckets
// par IP spoofée sont morts. Chaque test travaille donc dans une FENÊTRE
// PROPRE (attente 65 s > fenêtre durable 60 s) sur le bucket unique du runner.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';

const FN_URL = `${SUPABASE_URL}/functions/v1/auth-verify-pin`;

const WINDOW_RESET_MS = 65_000;
const freshWindow = () => new Promise((r) => setTimeout(r, WINDOW_RESET_MS));

function postPinRaw(body: unknown): Promise<Response> {
  return fetch(FN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('auth-verify-pin rate-limit', () => {
  let adminUserId: string;

  beforeAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data } = await admin.from('user_profiles').select('id').eq('employee_code', 'EMP003').single();
    if (!data) throw new Error('Seed not loaded — EMP003 missing');
    adminUserId = data.id;
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', adminUserId);
  });

  afterAll(async () => {
    // S78 (D-7) : ne pas laisser un compteur d'échecs au compte partagé.
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin
      .from('user_profiles')
      .update({ failed_login_attempts: 0, locked_until: null })
      .eq('id', adminUserId);
  });

  it('returns 429 on the 4th invalid attempt within one minute', async () => {
    // Fenêtre propre : le trafic des fichiers précédents (loginAsViaPinEF…)
    // partage le même bucket runner.
    await freshWindow();

    const body = { user_id: adminUserId, pin: '999999', device_type: 'pos' };

    // Requests 1-3 should pass the rate-limit layer (401 invalid_credentials
    // post-redaction, or 403 account_locked if the failure counter tripped).
    for (let i = 0; i < 3; i++) {
      const res = await postPinRaw(body);
      expect([401, 403], `request ${i + 1} unexpectedly ${res.status}`).toContain(res.status);
    }

    // 4th request should hit 429
    const res4 = await postPinRaw(body);
    expect(res4.status).toBe(429);
    const errBody = await res4.json();
    expect(errBody.error).toBe('rate_limited');
    expect(errBody.retry_after_sec).toBeGreaterThan(0);
  }, 240_000);

  it('redacts user_not_found to invalid_credentials', async () => {
    // Fenêtre propre après le burst du test précédent.
    await freshWindow();

    const res = await postPinRaw({
      user_id: '00000000-0000-0000-0000-000000000999',
      pin: '123456',
      device_type: 'pos',
    });
    expect(res.status).toBe(401);
    const errBody = await res.json();
    expect(errBody.error).toBe('invalid_credentials');
  }, 240_000);

  // Session 19 / Phase 2.A — Cross-instance simulation.
  // Two separate supabase-js clients call auth-verify-pin. Even though each EF
  // invocation may land on a distinct edge instance with its own in-memory
  // bucket, the durable record_rate_limit_v1 RPC binds both clients to the
  // same Postgres bucket (per runner IP), so the combined attempts above
  // 3/min must 429.
  it('enforces 3/min across two clients', async () => {
    // Fenêtre propre : le test précédent a consommé 1 requête du bucket.
    await freshWindow();

    const client1 = createClient(SUPABASE_URL, SERVICE);
    const client2 = createClient(SUPABASE_URL, SERVICE);
    const body = { user_id: adminUserId, pin: '999999', device_type: 'pos' };

    // Two attempts from each → 4 total, max=3.
    const r1 = await client1.functions.invoke('auth-verify-pin', { body });
    const r2 = await client2.functions.invoke('auth-verify-pin', { body });
    const r3 = await client1.functions.invoke('auth-verify-pin', { body });
    const r4 = await client2.functions.invoke('auth-verify-pin', { body });

    // First 3 should NOT be 429 (they may be 401 invalid_credentials / 403
    // account_locked — that's fine, the durable RL allowed them through).
    expect(r1.error?.context?.status).not.toBe(429);
    expect(r2.error?.context?.status).not.toBe(429);
    expect(r3.error?.context?.status).not.toBe(429);
    // 4th attempt MUST be 429.
    expect(r4.error?.context?.status).toBe(429);
  }, 240_000);
});
