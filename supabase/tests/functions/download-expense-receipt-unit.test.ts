import { beforeEach, describe, expect, it, vi } from 'vitest';
const api = vi.hoisted(() => ({ serve: vi.fn(), session: vi.fn(), rpc: vi.fn(),
  from: vi.fn(), download: vi.fn(), limit: vi.fn() }));
vi.mock('https://deno.land/std@0.224.0/http/server.ts', () => ({ serve: api.serve }));
vi.mock('../../functions/_shared/session-auth.ts', () => ({ requireSession: api.session }));
vi.mock('../../functions/_shared/rate-limit.ts', () => ({ checkRateLimitDurable: api.limit, getClientIp: () => '127.0.0.1' }));
vi.mock('../../functions/_shared/supabase-admin.ts', () => ({ getAdminClient: () => ({ rpc: api.rpc, storage: { from: api.from } }) }));
import '../../functions/download-expense-receipt/index';
const handler = api.serve.mock.calls[0][0] as (req: Request) => Promise<Response>;
const expenseId = '00000000-0000-4000-8000-000000000001';
const path = `expenses/${expenseId}/private.pdf`;
const request = (body: unknown = { expense_id: expenseId }, method = 'POST') => new Request('https://example.test', {
  method, headers: { 'x-session-token': 'opaque' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
});
beforeEach(() => {
  vi.clearAllMocks(); api.session.mockResolvedValue({ sessionId: 'verified-session', userId: 'profile' });
  api.limit.mockResolvedValue({ allowed: true }); api.rpc.mockResolvedValue({ data: path, error: null });
  api.from.mockReturnValue({ download: api.download });
  api.download.mockResolvedValue({ data: new Blob(['private bytes']), error: null });
});
async function checkNoStore(response: Response, status: number) {
  expect(response.status).toBe(status);
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect(response.headers.get('CDN-Cache-Control')).toBe('no-store');
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  return response;
}
describe('receipt download authorization boundary', () => {
  it('returns bytes only after two current authorizations, with no URL or cache', async () => {
    const res = await checkNoStore(await handler(request()), 200);
    expect(await res.text()).toBe('private bytes');
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(res.headers.get('Content-Disposition')).toBe(`attachment; filename="receipt-${expenseId}.pdf"`);
    expect(api.rpc).toHaveBeenCalledTimes(2);
    expect(api.rpc).toHaveBeenNthCalledWith(1, 'authorize_expense_receipt_download_v1', { p_session_id: 'verified-session', p_expense_id: expenseId });
    expect(api.from).toHaveBeenCalledExactlyOnceWith('expense-receipts');
    expect(api.download).toHaveBeenCalledExactlyOnceWith(path);
  });
  it.each([401, 503])('preserves session rejection %s without reading a file', async status => {
    api.session.mockResolvedValue(new Response('{}', { status, headers: { 'Access-Control-Allow-Origin': '*' } }));
    await checkNoStore(await handler(request()), status); expect(api.rpc).not.toHaveBeenCalled(); expect(api.download).not.toHaveBeenCalled();
  });
  it.each(['PT401', 'P0002', 'XX000'])('maps SQL rejection %s without a path or bytes', async code => {
    api.rpc.mockResolvedValue({ data: null, error: { code, message: 'private database detail' } });
    const res = await checkNoStore(await handler(request()), code === 'PT401' ? 401 : code === 'P0002' ? 404 : 503);
    expect(await res.text()).not.toContain('private'); expect(api.download).not.toHaveBeenCalled();
  });
  it('discards bytes if logout commits during Storage IO', async () => {
    api.rpc.mockResolvedValueOnce({ data: path, error: null }).mockResolvedValueOnce({ data: null, error: { code: 'PT401' } });
    const res = await checkNoStore(await handler(request()), 401); expect(await res.text()).not.toContain('private bytes');
  });
  it('discards a receipt superseded during IO', async () => {
    api.rpc.mockResolvedValueOnce({ data: path, error: null }).mockResolvedValueOnce({ data: 'new.pdf', error: null });
    const res = await checkNoStore(await handler(request()), 409); expect(await res.text()).not.toContain('private bytes');
  });
  it.each([null, [], {}, { expense_id: 'bad' }, { expense_id: expenseId, storage_path: 'arbitrary' }, { expense_id: expenseId, session_id: 'untrusted' }])('rejects invalid or authority-bearing body %j', async body => {
    await checkNoStore(await handler(request(body)), 400); expect(api.rpc).not.toHaveBeenCalled();
  });
  it('returns a retryable failure when Storage fails', async () => {
    api.download.mockResolvedValue({ data: null, error: { message: 'secret path' } });
    await checkNoStore(await handler(request()), 503);
  });
  it('does not leak thrown backend errors', async () => {
    api.session.mockRejectedValue(new Error('secret'));
    const res = await checkNoStore(await handler(request()), 503); expect(await res.text()).not.toContain('secret');
  });
  it('preserves the durable rate limit and retry header', async () => {
    api.limit.mockResolvedValue({ allowed: false, retryAfterSec: 15 });
    const res = await checkNoStore(await handler(request()), 429); expect(res.headers.get('Retry-After')).toBe('15');
    expect(api.rpc).not.toHaveBeenCalled();
  });
  it.each(['GET', 'OPTIONS'])('handles %s without fetching an object', async method => {
    await checkNoStore(await handler(request(undefined, method)), method === 'OPTIONS' ? 200 : 405);
    expect(api.session).not.toHaveBeenCalled(); expect(api.download).not.toHaveBeenCalled();
  });
});
