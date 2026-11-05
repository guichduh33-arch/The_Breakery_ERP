import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ serve: vi.fn(), rpc: vi.fn(), admin: vi.fn(), render: vi.fn(), owner: false }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: state.serve }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.47.10', () => ({ createClient: () => ({ rpc: state.rpc }) }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({
  checkRateLimitDurable: async () => ({ allowed: true }), getClientIp: () => '127.0.0.1',
}));
vi.mock('../../functions/_shared/acting-user.ts', () => ({ getActingAuthUserId: async () => 'profile-auth' }));
vi.mock('../../functions/_shared/api-keys.ts', () => ({ getPublishableApiKey: () => 'test-publishable' }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: state.admin }));
vi.mock('../../functions/_shared/pdf-layout.ts', () => ({
  initLayout: async () => ({ doc: { save: async () => new Uint8Array([1]) } }),
}));
vi.mock('../../functions/_shared/pdf-templates/index.ts', () => ({
  TEMPLATES: Object.fromEntries(['pnl', 'bs', 'cf', 'stock_variance', 'stock_movements', 'wastage',
    'perishable_turnover', 'daily_sales'].map((name) => [name, { permission: 'reports.read', render: state.render }])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  state.owner = false;
  state.rpc.mockImplementation(async (name: string) => ({ data: name === 'can_view_stock_v1' ? state.owner : true, error: null }));
  state.admin.mockReturnValue({
    from: () => ({ select: () => ({ limit: () => ({ maybeSingle: async () => ({ data: {}, error: null }) }) }) }),
    storage: { from: () => ({ upload: async () => ({ error: null }),
      createSignedUrl: async () => ({ data: { signedUrl: 'https://example.test/report' }, error: null }) }) },
  });
  vi.stubGlobal('Deno', { env: { get: () => 'https://example.test' } });
});
afterEach(() => vi.unstubAllGlobals());

async function invoke(template: string) {
  await import('../../functions/generate-pdf/index.ts');
  const handler = state.serve.mock.calls[0][0] as (request: Request) => Promise<Response>;
  return handler(new Request('https://example.test', { method: 'POST',
    headers: { authorization: 'Bearer test-only', 'content-type': 'application/json' },
    body: JSON.stringify({ template, data: {}, filename: 'test-report' }) }));
}

describe('Confidential stock PDF exports', () => {
  it.each(['pnl', 'bs', 'cf', 'stock_variance', 'stock_movements', 'wastage', 'perishable_turnover'])(
    'refuses %s for an ADMIN with export permissions', async (template) => {
      const response = await invoke(template);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: 'stock_visibility_owner_required' });
      expect(state.admin).not.toHaveBeenCalled();
      expect(state.render).not.toHaveBeenCalled();
    },
  );
  it('keeps a permitted sales PDF export accessible', async () => {
    expect((await invoke('daily_sales')).status).toBe(200);
    expect(state.rpc).not.toHaveBeenCalledWith('can_view_stock_v1');
  });
  it('allows an Owner to export the financial report', async () => {
    state.owner = true;
    expect((await invoke('pnl')).status).toBe(200);
    expect(state.render).toHaveBeenCalledOnce();
  });
});
