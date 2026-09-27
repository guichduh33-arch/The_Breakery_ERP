import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const { verify } = vi.hoisted(() => ({ verify: vi.fn() }));
vi.mock('https://deno.land/x/djwt@v3.0.2/mod.ts', () => ({ verify }));
import { getActingAuthUserId } from '../../functions/_shared/acting-user';
beforeEach(() => { vi.stubGlobal('Deno', { env: { get: () => 'test-signing-secret' } }); });
afterEach(() => vi.unstubAllGlobals());
describe('identité employé après vérification de signature simulée', () => {
  it.each([
    { role: 'kiosk_display', app_metadata: { provider: 'kiosk' }, sub: 'device' },
    { role: 'authenticated', app_metadata: { provider: 'kiosk' }, sub: 'legacy-device' },
    { role: 'authenticated', sub: 'unknown' },
  ])('refuse %j', async (payload) => {
    verify.mockResolvedValue(payload);
    expect(await getActingAuthUserId(new Request('https://example.test', { headers: { authorization: 'Bearer test' } }))).toBeNull();
  });
  it('accepte le fournisseur PIN', async () => {
    verify.mockResolvedValue({ role: 'authenticated', app_metadata: { provider: 'pin' }, sub: 'employee' });
    expect(await getActingAuthUserId(new Request('https://example.test', { headers: { authorization: 'Bearer test' } }))).toBe('employee');
  });
});
