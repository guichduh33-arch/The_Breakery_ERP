// apps/pos/src/features/lan/__tests__/lan-hub-typed-client.test.ts
//
// fix/pos-double-print-risk — handler consumes a typed SupabaseClient<Database>.
//
// Compile-time: this file imports the typed LanHandlerContext, so a wrong RPC
// name or arg key in the handler would fail `pnpm --filter @breakery/app-pos
// typecheck`. Runtime: assert the RPC name + arg shape for the non-gated handlers
// (heartbeat, print.request) that survive regardless of the P2 gate.

import { describe, it, expect, vi } from 'vitest';
import {
  handleLanMessage,
  type LanHandlerContext,
} from '../lanHubMessageHandler';
import type { HeartbeatMessage, PrintRequestMessage } from '@breakery/domain';

function makeCtx(rpc: ReturnType<typeof vi.fn>): LanHandlerContext {
  return {
    // The handler only uses `.rpc()`; cast the minimal stub through unknown to
    // the typed client surface. A real client would satisfy the full type.
    supabase: { rpc } as unknown as LanHandlerContext['supabase'],
    hubDeviceId: 'hub-1',
    reply: vi.fn(),
  };
}

describe('lanHubMessageHandler — typed client', () => {
  it('heartbeat calls update_lan_heartbeat_v1 with p_device_code', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const ctx = makeCtx(rpc);
    const msg: HeartbeatMessage = {
      version: 1,
      id: crypto.randomUUID(),
      from: 'kds-tablet-7',
      type: 'heartbeat',
      ts: Date.now(),
      payload: { device_type: 'kds' },
    };

    await handleLanMessage(msg, ctx);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('update_lan_heartbeat_v1', {
      p_device_code: 'kds-tablet-7',
    });
  });

  it('print.request calls enqueue_print_job_v1 with the request payload', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'job-1' }, error: null });
    const ctx = makeCtx(rpc);
    const msg: PrintRequestMessage = {
      version: 1,
      id: crypto.randomUUID(),
      from: 'pos-1',
      type: 'print.request',
      ts: Date.now(),
      payload: {
        ticket_type: 'receipt',
        data: { foo: 'bar' },
        reference_type: 'order',
        reference_id: 'ord-1',
        priority: 7,
      },
    };

    await handleLanMessage(msg, ctx);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('enqueue_print_job_v1', {
      p_device_id: null,
      p_payload: { foo: 'bar' },
      p_source: 'pos',
      p_reference_type: 'order',
      p_reference_id: 'ord-1',
      p_priority: 7,
    });
  });
});
