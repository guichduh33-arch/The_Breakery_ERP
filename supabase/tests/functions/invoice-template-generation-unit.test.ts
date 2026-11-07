import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INVOICE_PRINT_OPTIONS } from '../../functions/_shared/invoice-print-options.ts';

const state = vi.hoisted(() => ({ serve: vi.fn(), render: vi.fn(), from: vi.fn(), upload: vi.fn(),
  permission: true, missingTemplate: false, context: { doc: { save: () => Promise.resolve(new Uint8Array([1])) } } }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: state.serve }));
vi.mock('https://esm.sh/@supabase/supabase-js@2.47.10', () => ({ createClient: () => ({ rpc: () => Promise.resolve({ data: state.permission, error: null }) }) }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({ getClientIp: () => '127.0.0.1', checkRateLimitDurable: () => Promise.resolve({ allowed: true }) }));
vi.mock('../../functions/_shared/acting-user.ts', () => ({ getActingAuthUserId: () => Promise.resolve('test-user') }));
vi.mock('../../functions/_shared/api-keys.ts', () => ({ getPublishableApiKey: () => 'test-key' }));
vi.mock('../../functions/_shared/pdf-layout.ts', () => ({ initLayout: () => Promise.resolve(state.context) }));
vi.mock('../../functions/_shared/pdf-templates/index.ts', () => ({ TEMPLATES: { b2b_invoice: { permission: 'b2b.read', render: state.render } } }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ from: state.from,
  storage: { from: () => ({ upload: state.upload, createSignedUrl: () => Promise.resolve({ data: { signedUrl: 'https://example.test/invoice.pdf' }, error: null }) }) } }) }));

async function invoke() {
  await import('../../functions/generate-pdf/index.ts');
  const handler = state.serve.mock.calls[0]![0] as (request: Request) => Promise<Response>;
  return handler(new Request('https://example.test', { method: 'POST',
    headers: { authorization: 'Bearer test-only', 'content-type': 'application/json' },
    body: JSON.stringify({ template: 'b2b_invoice', filename: 'invoice-test', data: {},
      invoiceTemplate: { heading: 'CLIENT OVERRIDE', paper_width_mm: 1 } }) }));
}
describe('B2B invoice PDF template loading', () => {
  beforeEach(() => {
    vi.resetModules(); vi.clearAllMocks(); state.permission = true; state.missingTemplate = false;
    state.context = { doc: { save: () => Promise.resolve(new Uint8Array([1])) } };
    vi.stubGlobal('Deno', { env: { get: () => 'https://example.test' } });
    state.upload.mockResolvedValue({ error: null });
    state.from.mockImplementation((table: string) => {
      const chain = { select: () => chain, eq: () => chain, limit: () => chain,
        maybeSingle: () => Promise.resolve({ data: table === 'business_config' ? { name: 'The Breakery' }
          : state.missingTemplate ? null : { ...DEFAULT_INVOICE_PRINT_OPTIONS, heading: 'SAVED INVOICE' }, error: null }) };
      return chain;
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });
  it('uses saved server-side presentation and ignores a client override', async () => {
    expect((await invoke()).status).toBe(200);
    expect(state.from).toHaveBeenCalledWith('invoice_print_templates');
    expect(state.render.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      invoiceTemplate: expect.objectContaining({ heading: 'SAVED INVOICE', paper_width_mm: 210 }),
    }));
  });
  it('fails explicitly when the saved template cannot be loaded', async () => {
    state.missingTemplate = true;
    const response = await invoke();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: 'invoice_template_unavailable' });
    expect(state.render).not.toHaveBeenCalled();
    expect(state.upload).not.toHaveBeenCalled();
  });
  it('keeps the B2B permission check ahead of template reads and PDF generation', async () => {
    state.permission = false;
    expect((await invoke()).status).toBe(403);
    expect(state.from).not.toHaveBeenCalled();
    expect(state.render).not.toHaveBeenCalled();
  });
});
