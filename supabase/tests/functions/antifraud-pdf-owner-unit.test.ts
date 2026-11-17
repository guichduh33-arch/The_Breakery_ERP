import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ADR-039 (S1-08) : le stock suit `can_view_stock_v2` (reports.inventory.read),
// les états financiers `can_view_statements_v1` (reports.statements.read) ; les
// paiements par méthode restent réservés au propriétaire (`can_view_stock_v1`).
const GATES = ['can_view_stock_v1', 'can_view_stock_v2', 'can_view_statements_v1'] as const;
type Gate = (typeof GATES)[number];

const state = vi.hoisted(() => ({
  serve: vi.fn(), rpc: vi.fn(), admin: vi.fn(), render: vi.fn(),
  allowed: new Set<string>(),
}));
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
    'perishable_turnover', 'payment_by_method', 'pb1', 'daily_sales'].map((name) => [name, { permission: 'reports.read', render: state.render }])),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  state.allowed = new Set();
  state.rpc.mockImplementation(async (name: string) => ({
    data: (GATES as readonly string[]).includes(name) ? state.allowed.has(name) : true, error: null,
  }));
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

const CASES: Array<[template: string, gate: Gate, error: string]> = [
  ['pnl', 'can_view_statements_v1', 'financial_statements_required'],
  ['bs', 'can_view_statements_v1', 'financial_statements_required'],
  ['cf', 'can_view_statements_v1', 'financial_statements_required'],
  ['pb1', 'can_view_statements_v1', 'financial_statements_required'],
  ['stock_variance', 'can_view_stock_v2', 'stock_visibility_required'],
  ['stock_movements', 'can_view_stock_v2', 'stock_visibility_required'],
  ['wastage', 'can_view_stock_v2', 'stock_visibility_required'],
  ['perishable_turnover', 'can_view_stock_v2', 'stock_visibility_required'],
  ['payment_by_method', 'can_view_stock_v1', 'stock_visibility_owner_required'],
];

describe('Confidential PDF exports', () => {
  it.each(CASES)('refuses %s without its visibility gate', async (template, _gate, error) => {
    const response = await invoke(template);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error });
    expect(state.admin).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });
  it.each(CASES)('refuses %s when only the other gates are open', async (template, gate, error) => {
    for (const g of GATES) if (g !== gate) state.allowed.add(g);
    const response = await invoke(template);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error });
    expect(state.render).not.toHaveBeenCalled();
  });
  it.each(CASES)('allows %s once its visibility gate is open', async (template, gate) => {
    state.allowed.add(gate);
    expect((await invoke(template)).status).toBe(200);
    expect(state.render).toHaveBeenCalledOnce();
  });
  it('keeps a permitted sales PDF export accessible', async () => {
    expect((await invoke('daily_sales')).status).toBe(200);
    for (const g of GATES) expect(state.rpc).not.toHaveBeenCalledWith(g);
  });
});
