import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import type * as SupabasePackage from '@breakery/supabase';

const { rpc, change, state } = vi.hoisted(() => ({
  rpc: vi.fn(), change: vi.fn(),
  state: { user: { id: 'actor' }, sessionToken: 'opaque-session' },
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc }, supabaseUrl: 'https://example.test' }));
vi.mock('@/stores/authStore.js', () => ({ useAuthStore: { getState: () => state } }));
vi.mock('@breakery/supabase', async (importOriginal) => ({
  ...await importOriginal<typeof SupabasePackage>(), changePin: change,
}));
import { useResetUserPin } from '../hooks/useResetUserPin';

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useResetUserPin(), {
    wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

describe('contrats PIN BO', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.sessionToken = 'opaque-session';
    rpc.mockResolvedValue({ error: null });
    change.mockResolvedValue(undefined);
  });
  it('envoie le changement personnel au wrapper EF authentifié', async () => {
    const { result } = setup();
    const args = { user_id: 'actor', new_pin: '285741', current_pin: '936027' };
    await act(async () => { await result.current.mutateAsync(args); });
    expect(change).toHaveBeenCalledWith('https://example.test', 'opaque-session', args);
    expect(rpc).not.toHaveBeenCalled();
  });
  it('refuse le changement personnel sans PIN courant', async () => {
    const { result } = setup();
    await act(async () => {
      await expect(result.current.mutateAsync({ user_id: 'actor', new_pin: '285741' }))
        .rejects.toThrow('current_pin_required');
    });
    expect(change).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it('réserve la RPC publique au reset d’un autre utilisateur', async () => {
    const { result } = setup();
    await act(async () => { await result.current.mutateAsync({ user_id: 'target', new_pin: '285741' }); });
    expect(rpc).toHaveBeenCalledWith('reset_user_pin_v2', { p_user_id: 'target', p_new_pin: '285741' });
    expect(change).not.toHaveBeenCalled();
  });
});
