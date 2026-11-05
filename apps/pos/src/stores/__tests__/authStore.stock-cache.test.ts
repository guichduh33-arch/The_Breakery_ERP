import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as Supabase from '@breakery/supabase';
const api = vi.hoisted(() => ({ login: vi.fn(), logout: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ supabaseUrl: 'https://test.invalid', supabase: {} }));
vi.mock('@breakery/supabase', async (original) => ({ ...await original<typeof Supabase>(),
  loginWithPin: api.login, logoutSession: api.logout,
}));
import { useAuthStore } from '../authStore';
import { queryClient } from '@/lib/queryClient';

beforeEach(async () => {
  localStorage.clear();
  vi.clearAllMocks();
  api.logout.mockResolvedValue(undefined);
  await useAuthStore.getState().logout();
});
describe('Stock cache session isolation', () => {
  it('removes theoretical stock immediately on logout', async () => {
    queryClient.setQueryData(['pos-stock-products'], [{ current_stock: 812 }]);
    await useAuthStore.getState().logout();
    expect(queryClient.getQueryData(['pos-stock-products'])).toBeUndefined();
  });
  it('cancels late Owner queries before accepting another session', async () => {
    let resolve!: (value: number) => void;
    const remote = new Promise<number>((yes) => { resolve = yes; });
    const pending = queryClient.fetchQuery({ queryKey: ['products'], queryFn: () => remote, retry: false }).catch(() => undefined);
    api.login.mockResolvedValue({ user: { id: 'admin', full_name: 'Admin', employee_code: 'A', role_code: 'ADMIN' },
      session: { token: 'new-session' }, auth: { access_token: 'test-token', expires_at: 9999999999 },
      permissions: [], session_timeout_minutes: 60 });
    await useAuthStore.getState().login('admin', 'fixture-pin');
    queryClient.setQueryData(['products'], [{ current_stock: null }]);
    resolve(812);
    await pending;
    expect(queryClient.getQueryData(['products'])).toEqual([{ current_stock: null }]);
  });
});
