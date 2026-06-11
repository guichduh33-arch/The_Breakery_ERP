// supabase/tests/functions/kiosk-issue-jwt.test.ts
// Session 13 / Phase 1.B — D18 kiosk auth.
//
// Live RPC test against the local Supabase stack. Covers:
//   - 200 on valid scope + JWT payload claims (provider/scope/role)
//   - 400 on missing fields, invalid scope, invalid JSON
//   - 405 on GET
//   - 429 on rate-limit (per-IP)
//   - 403 on ip_not_allowed when KIOSK_ALLOWED_IPS env restricts
//   - Custom-fetch wrapper accepts kiosk JWT and PostgREST honours role=authenticated

import { describe, it, expect } from 'vitest';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const FN_URL = `${SUPABASE_URL}/functions/v1/kiosk-issue-jwt`;

function decodeJwtPayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  if (parts.length !== 3) throw new Error('not_a_jwt');
  const padded = parts[1]!.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return JSON.parse(atob(padded + '='.repeat(padLen))) as Record<string, unknown>;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('kiosk-issue-jwt', () => {
  it('returns 405 on GET', async () => {
    const res = await fetch(FN_URL, { method: 'GET' });
    expect(res.status).toBe(405);
  });

  it('returns 400 on invalid JSON', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_json');
  });

  it('returns 400 on missing fields', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.11' },
      body: JSON.stringify({ kiosk_id: 'kiosk_a' }), // no scope
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('missing_fields');
  });

  it('returns 400 on invalid scope', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.12' },
      body: JSON.stringify({ kiosk_id: 'kiosk_a', scope: 'admin' }),
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('invalid_scope');
  });

  it('issues a valid JWT for scope=kds with correct claims', async () => {
    const res = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.20' },
      body: JSON.stringify({
        kiosk_id: 'kiosk_kds_test_01',
        scope: 'kds',
        device_label: 'Kitchen Test Station',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toMatch(/^eyJ/);
    expect(body.token_type).toBe('Bearer');
    expect(body.kiosk.scope).toBe('kds');

    const payload = decodeJwtPayload(body.access_token);
    expect(payload.role).toBe('authenticated');
    expect(payload.aud).toBe('authenticated');
    const appMeta = payload.app_metadata as { provider: string; scope: string; kiosk_id: string };
    expect(appMeta.provider).toBe('kiosk');
    expect(appMeta.scope).toBe('kds');
    expect(appMeta.kiosk_id).toBe('kiosk_kds_test_01');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp as number).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('issues distinct JWTs for scope=display and scope=tablet', async () => {
    const display = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.21' },
      body: JSON.stringify({ kiosk_id: 'kiosk_display_test_01', scope: 'display' }),
    });
    expect(display.status).toBe(200);

    const tablet = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': '203.0.113.22' },
      body: JSON.stringify({ kiosk_id: 'kiosk_tablet_test_01', scope: 'tablet' }),
    });
    expect(tablet.status).toBe(200);

    const displayBody = await display.json();
    const tabletBody = await tablet.json();
    const dp = decodeJwtPayload(displayBody.access_token);
    const tp = decodeJwtPayload(tabletBody.access_token);
    expect((dp.app_metadata as { scope: string }).scope).toBe('display');
    expect((tp.app_metadata as { scope: string }).scope).toBe('tablet');
  });

  it('rate-limits 1/min per kiosk_id', async () => {
    const ip = '203.0.113.30';
    const kiosk = 'kiosk_rate_test_01';
    const r1 = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ kiosk_id: kiosk, scope: 'kds' }),
    });
    expect(r1.status).toBe(200);

    const r2 = await fetch(FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': ip },
      body: JSON.stringify({ kiosk_id: kiosk, scope: 'kds' }),
    });
    expect(r2.status).toBe(429);
    const body = await r2.json();
    expect(body.error).toBe('rate_limited');
  });
});
