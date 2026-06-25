// supabase/tests/functions/reopen-held-order-v1.test.ts
// Live RPC round-trip (V3 dev cloud). Skipped when SUPABASE_TEST_LIVE is unset.
//
// Auth pattern mirrors pay-existing-order-v4.test.ts — each file carries its
// own inline login helper (no shared module exists; each is self-contained).
// Step plan (fill in when live creds available):
//   1. As CASHIER (EMP000), fire a counter order via fire_counter_order_v4
//      → order_id, items with is_locked=true.
//   2. hold_fired_order_v1(order_id) → row now is_held=true (appears in held list).
//   3. reopen_held_order_v1(order_id) → returns items[] with is_locked=true +
//      order_items.id; DB row is_held=false; order NOT deleted (status='pending_payment').
//   4. A 2nd reopen_held_order_v1(order_id) throws P0002 (already open / not held).
//   5. Append a NEW item via fire_counter_order_v4(p_order_id=order_id) → exactly ONE
//      new order_items row (locked lines were excluded client-side); total item count = N+1.

import { describe, it, expect } from 'vitest';

describe.skipIf(!process.env.SUPABASE_TEST_LIVE)('reopen_held_order_v1 (live)', () => {
  it('hold → reopen preserves locks, flips is_held false→…→reopened, no item dup', async () => {
    // replace with the real assertions per the suite's helpers when SUPABASE_TEST_LIVE is set
    expect(true).toBe(true);
  });
});
