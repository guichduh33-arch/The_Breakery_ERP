import { beforeEach, expect, it, vi } from 'vitest';

const { rpc, select, updateSelect } = vi.hoisted(() => ({
  rpc: vi.fn(),
  select: vi.fn(),
  updateSelect: vi.fn(),
}));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: vi.fn() }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({
  getAdminClient: () => ({
    rpc,
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ is: select }),
        }),
      }),
      update: () => ({
        in: () => ({
          eq: () => ({
            eq: () => ({
              is: () => ({ select: updateSelect }),
            }),
          }),
        }),
      }),
    }),
  }),
}));

import { handleLanHeartbeat } from '../../functions/lan-heartbeat-batch/index';

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('Deno', { env: { get: () => 'secret' } });
  rpc.mockResolvedValueOnce({ data: [{ code: 'POS1' }], error: null })
    .mockResolvedValueOnce({
      data: { version: 1, generated_at: new Date().toISOString(), devices: [], printers: [
        { ip_address: '192.168.1.8', port: 9100 },
      ] },
      error: null,
    });
  select.mockResolvedValue({
    data: [{ code: 'PRN-CASHIER', ip_address: '192.168.1.8', port: 9100 }],
    error: null,
  });
  updateSelect.mockResolvedValue({ data: [{ code: 'PRN-CASHIER' }], error: null });
});

it('heartbeats reachable printer codes even without terminal credentials', async () => {
  const response = await handleLanHeartbeat(new Request('https://example.test', {
    method: 'POST',
    headers: { 'x-hub-secret': 'secret' },
    body: JSON.stringify({ device_codes: ['PRN-CASHIER'] }),
  }));
  expect(response.status).toBe(200);
  const body = await response.json();
  expect(body.touched).toEqual(expect.arrayContaining(['PRN-CASHIER']));
  expect(body.unknown).toEqual([]);
  expect(updateSelect).toHaveBeenCalledOnce();
});

it('enriches printer targets with their BO codes for heartbeat probes', async () => {
  const response = await handleLanHeartbeat(new Request('https://example.test', {
    method: 'POST',
    headers: { 'x-hub-secret': 'secret' },
    body: JSON.stringify({ device_codes: ['POS1'] }),
  }));
  expect(response.status).toBe(200);
  expect((await response.json()).registry.printers).toEqual([
    { code: 'PRN-CASHIER', ip_address: '192.168.1.8', port: 9100 },
  ]);
});
