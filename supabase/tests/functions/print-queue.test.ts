// supabase/tests/functions/print-queue.test.ts
// Session 13 / Phase 5.A — Vitest live RPC tests for print_queue.
//
// Coverage :
//   T_PQ_LIVE_01 : enqueue_print_job_v1 → returns a queued row
//   T_PQ_LIVE_02 : claim_print_job_v1 flips status to printing
//   T_PQ_LIVE_03 : mark_print_done_v1 sets done + printed_at
//   T_PQ_LIVE_04 : enqueue idempotency replay returns same id
//   T_PQ_LIVE_05 : mark_print_failed_v1 requeues then terminal-fails

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
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
    body: JSON.stringify({ user_id: profile.id, pin, device_type: 'pos' }),
  });
  const body = await res.json();
  if (!body.auth?.access_token) throw new Error(`Login failed: ${JSON.stringify(body)}`);
  return body.auth.access_token as string;
}

function jwtClient(token: string): SupabaseClient {
  return createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

function rpc(sb: SupabaseClient) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return sb.rpc as unknown as (fn: string, args?: Record<string, unknown>) => Promise<{ data: any; error: { message: string } | null }>;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('print_queue RPCs (live)', () => {
  let managerToken: string;
  let cleanupIds: string[] = [];

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
  });

  afterAll(async () => {
    const admin = createClient(SUPABASE_URL, SERVICE);
    if (cleanupIds.length > 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (admin as any).from('print_queue').delete().in('id', cleanupIds);
    }
  });

  it('T_PQ_LIVE_01: enqueue_print_job_v1 returns a queued row', async () => {
    const sb = jwtClient(managerToken);
    const refId = crypto.randomUUID();
    const { data, error } = await rpc(sb)('enqueue_print_job_v1', {
      p_device_id:      null,
      p_payload:        { ticket_type: 'kitchen_chit', data: { test: true } },
      p_source:         'vitest',
      p_reference_type: 'order',
      p_reference_id:   refId,
      p_priority:       5,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.status).toBe('queued');
    expect(data.retries).toBe(0);
    cleanupIds.push(data.id as string);
  });

  it('T_PQ_LIVE_02: claim_print_job_v1 flips status to printing', async () => {
    const sb = jwtClient(managerToken);
    // Enqueue a fresh job (high priority so we know we pick it)
    const enq = await rpc(sb)('enqueue_print_job_v1', {
      p_device_id:      null,
      p_payload:        { ticket_type: 'kitchen_chit' },
      p_source:         'vitest-claim',
      p_reference_type: 'order',
      p_reference_id:   crypto.randomUUID(),
      p_priority:       9, // highest
    });
    expect(enq.error).toBeNull();
    cleanupIds.push(enq.data.id as string);

    const { data, error } = await rpc(sb)('claim_print_job_v1', {
      p_device_id: null,
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data.status).toBe('printing');
    cleanupIds.push(data.id as string);
  });

  it('T_PQ_LIVE_03: mark_print_done_v1 sets status=done and printed_at', async () => {
    const sb = jwtClient(managerToken);
    const enq = await rpc(sb)('enqueue_print_job_v1', {
      p_device_id: null,
      p_payload: { ticket_type: 'receipt' },
      p_source: 'vitest-done',
      p_reference_type: 'order',
      p_reference_id: crypto.randomUUID(),
      p_priority: 8,
    });
    expect(enq.error).toBeNull();
    cleanupIds.push(enq.data.id as string);

    const claim = await rpc(sb)('claim_print_job_v1', { p_device_id: null });
    expect(claim.error).toBeNull();

    const { data, error } = await rpc(sb)('mark_print_done_v1', { p_id: claim.data.id });
    expect(error).toBeNull();
    expect(data.status).toBe('done');
    expect(data.printed_at).toBeTruthy();
  });

  it('T_PQ_LIVE_04: enqueue idempotency replay returns same row', async () => {
    const sb = jwtClient(managerToken);
    const refId = crypto.randomUUID();
    const args = {
      p_device_id: null,
      p_payload: { ticket_type: 'kitchen_chit' },
      p_source: 'vitest-idempotent',
      p_reference_type: 'order',
      p_reference_id: refId,
      p_priority: 5,
    };
    const a = await rpc(sb)('enqueue_print_job_v1', args);
    const b = await rpc(sb)('enqueue_print_job_v1', args);
    expect(a.error).toBeNull();
    expect(b.error).toBeNull();
    expect(a.data.id).toBe(b.data.id);
    cleanupIds.push(a.data.id as string);
  });

  it('T_PQ_LIVE_05: mark_print_failed_v1 requeues up to 3 times then terminal-fails', async () => {
    const sb = jwtClient(managerToken);
    const enq = await rpc(sb)('enqueue_print_job_v1', {
      p_device_id: null,
      p_payload: { ticket_type: 'receipt' },
      p_source: 'vitest-fail',
      p_reference_type: 'order',
      p_reference_id: crypto.randomUUID(),
      p_priority: 5,
    });
    expect(enq.error).toBeNull();
    cleanupIds.push(enq.data.id as string);

    const claim = await rpc(sb)('claim_print_job_v1', { p_device_id: null });
    expect(claim.error).toBeNull();
    const jobId = claim.data.id as string;

    // 4 failures total → first 3 requeue, 4th terminal
    for (let i = 1; i <= 4; i++) {
      const { data, error } = await rpc(sb)('mark_print_failed_v1', {
        p_id: jobId, p_error: `attempt ${i}`,
      });
      expect(error).toBeNull();
      if (i <= 3) {
        expect(data.status).toBe('queued');
      } else {
        expect(data.status).toBe('failed');
      }
      expect(data.retries).toBe(i);
    }
  });
});
