// apps/pos/src/features/lan/__tests__/lan-hub-no-kitchen-chit.smoke.test.tsx
//
// fix/pos-double-print-risk P2 (GATED — gate b) — kds.bump must NOT enqueue a
// kitchen_chit print job by default once Path A (S34 bridge) is canonical.
// Gate verdict (S35a, ratified): the print-bridge is NOT yet deployed
// (DEV-S34-W0-02 open), so the legacy chit ships behind the feature flag
// VITE_LEGACY_KITCHEN_CHIT, OFF by default (no silent-kitchen P0 regression):
//   flag OFF (default/unset) → no chit on bump.
//   flag ON ('1')           → chit re-enqueued (proves the flag works).
// printService.ts pattern: env read at call time via import.meta.env, so flag
// cases vi.stubEnv + vi.resetModules() then dynamically import the handler.

import { describe, it, expect, vi, afterEach } from 'vitest';
import type { KdsBumpMessage } from '@breakery/domain';

function bumpPreparing(): KdsBumpMessage {
  return {
    version: 1,
    id: crypto.randomUUID(),
    from: 'kds-tablet-7',
    type: 'kds.bump',
    ts: Date.now(),
    payload: {
      order_item_id: 'oi-1',
      order_id: 'ord-1',
      station: 'kitchen',
      new_status: 'preparing',
    },
  };
}

function isKitchenChitCall(call: unknown[]): boolean {
  if (call[0] !== 'enqueue_print_job_v1') return false;
  const args = call[1] as { p_payload?: { ticket_type?: string } } | undefined;
  return args?.p_payload?.ticket_type === 'kitchen_chit';
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('lan hub — kds.bump no longer enqueues kitchen_chit (gate b: flag OFF)', () => {
  it('[gate b] flag OFF (unset) → no kitchen_chit', async () => {
    vi.stubEnv('VITE_LEGACY_KITCHEN_CHIT', '');
    vi.resetModules();
    const { handleLanMessage } = await import('../lanHubMessageHandler');
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = {
      supabase: { rpc } as never,
      queryClient: { invalidateQueries: vi.fn() } as never,
      hubDeviceId: 'hub-1',
      reply: vi.fn(),
    };

    await handleLanMessage(bumpPreparing(), ctx);

    expect(rpc.mock.calls.filter(isKitchenChitCall)).toHaveLength(0);
  });

  it('[gate b] flag ON → kitchen_chit re-enqueued (proves the flag works)', async () => {
    vi.stubEnv('VITE_LEGACY_KITCHEN_CHIT', '1');
    vi.resetModules();
    const { handleLanMessage } = await import('../lanHubMessageHandler');
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = {
      supabase: { rpc } as never,
      queryClient: { invalidateQueries: vi.fn() } as never,
      hubDeviceId: 'hub-1',
      reply: vi.fn(),
    };

    await handleLanMessage(bumpPreparing(), ctx);

    expect(rpc.mock.calls.filter(isKitchenChitCall)).toHaveLength(1);
  });
});
