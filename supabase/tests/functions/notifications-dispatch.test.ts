// supabase/tests/functions/notifications-dispatch.test.ts
//
// Session 13 / Phase 5.B — live Vitest integration test for the
// notification pipeline. Tests :
//   1. Manager can enqueue via enqueue_notification_v1.
//   2. Cashier cannot (permission gate).
//   3. notification-dispatch EF picks up the queued row, marks it
//      'sent' (console mode in CI : RESEND_API_KEY unset).
//   4. Idempotency replay returns the same outbox id.
//
// Requires : staging EF deployed + RESEND_API_KEY UNSET (default in CI)
// → all dispatches succeed in 'console' mode.

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { loginAs, jwtClient } from './_helpers/auth';

const SUPABASE_URL  = process.env.VITE_SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SERVICE       = process.env.SUPABASE_SERVICE_ROLE_KEY ?? '';
const DISPATCH_FN_URL = `${SUPABASE_URL}/functions/v1/notification-dispatch`;

interface OutboxRow {
  id: string;
  status: string;
  retries: number;
  sent_at: string | null;
  provider_message_id: string | null;
  error_message: string | null;
}

describe.skipIf(!process.env.SUPABASE_SERVICE_ROLE_KEY)('notifications — pipeline (Phase 5.B)', () => {
  let managerToken: string;
  let cashierToken: string;
  let createdIds: string[] = [];

  beforeAll(async () => {
    managerToken = await loginAs('EMP003', '111111');
    cashierToken = await loginAs('EMP001', '111111');
  });

  afterEach(async () => {
    if (createdIds.length === 0) return;
    const admin = createClient(SUPABASE_URL, SERVICE);
    await admin.from('notification_outbox').delete().in('id', createdIds);
    createdIds = [];
  });

  it('cashier cannot enqueue (permission gate)', async () => {
    const sb = jwtClient(cashierToken);
    const { error } = await sb.rpc('enqueue_notification_v1', {
      p_template_code: 'order_complete',
      p_recipient:     'forbidden@example.com',
      p_variables:     { order_number: 'X', customer_name: 'X', total: '0' },
    });
    expect(error).not.toBeNull();
    expect(error?.message ?? '').toMatch(/permission|forbidden|denied|42501/i);
  });

  it('manager can enqueue and EF marks the row sent (console mode)', async () => {
    const sbMgr = jwtClient(managerToken);
    const recipient = `live-${Date.now()}@example.com`;

    // 1. Enqueue.
    const { data: enqueueId, error: enqErr } = await sbMgr.rpc('enqueue_notification_v1', {
      p_template_code: 'order_complete',
      p_recipient:     recipient,
      p_variables: {
        order_number:  'ORD-LIVE-01',
        customer_name: 'Live Tester',
        total:         '125000',
      },
    });
    expect(enqErr).toBeNull();
    expect(typeof enqueueId).toBe('string');
    createdIds.push(enqueueId as unknown as string);

    // 2. Confirm row is queued.
    const admin = createClient(SUPABASE_URL, SERVICE);
    const { data: queued } = await admin
      .from('notification_outbox')
      .select('id, status, subject, body')
      .eq('id', enqueueId as unknown as string)
      .single();
    expect(queued?.status).toBe('queued');
    expect(queued?.subject).toBe('Order ORD-LIVE-01 is ready');
    expect(queued?.body ?? '').toMatch(/Live Tester/);

    // 3. Invoke the dispatch EF as manager. CI has no
    //    NOTIFICATION_DISPATCH_SECRET set, so we use the Bearer path.
    const dispatchRes = await fetch(DISPATCH_FN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${managerToken}`,
        'Content-Type':  'application/json',
      },
    });
    expect(dispatchRes.ok).toBe(true);
    const summary = await dispatchRes.json();
    // The batch picks up >=1 row : may pick up rows from other tests
    // (cleanup happens in afterEach but during the test our row is
    // present).
    expect(summary.processed).toBeGreaterThanOrEqual(1);
    expect(summary.sent).toBeGreaterThanOrEqual(1);
    expect(summary.mode).toMatch(/^(console|resend)$/);

    // 4. Verify our row is now `sent`.
    const { data: after } = await admin
      .from('notification_outbox')
      .select('id, status, retries, sent_at, provider_message_id, error_message')
      .eq('id', enqueueId as unknown as string)
      .single();
    const row = after as OutboxRow | null;
    expect(row?.status).toBe('sent');
    expect(row?.sent_at).not.toBeNull();
    expect(row?.provider_message_id).toBeTruthy();
    expect(row?.error_message).toBeNull();
  }, 30_000);

  it('idempotent enqueue : same key returns same id', async () => {
    const sbMgr = jwtClient(managerToken);
    const idem = crypto.randomUUID();

    const args = {
      p_template_code:   'payment_received',
      p_recipient:       `idem-${Date.now()}@example.com`,
      p_variables: {
        order_number: 'ORD-IDEM',
        customer_name: 'IdemTester',
        amount: '50000',
        payment_method: 'cash',
      },
      p_channel:         null as string | null,
      p_scheduled_for:   null as string | null,
      p_idempotency_key: idem,
    };

    const { data: first,  error: e1 } = await sbMgr.rpc('enqueue_notification_v1', args);
    const { data: second, error: e2 } = await sbMgr.rpc('enqueue_notification_v1', args);
    expect(e1).toBeNull();
    expect(e2).toBeNull();
    expect(first).toBe(second);
    createdIds.push(first as unknown as string);
  });

  it('unauthorized invocation is rejected', async () => {
    // No Bearer, no secret.
    const res = await fetch(DISPATCH_FN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthorized');
  });
});
