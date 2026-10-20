import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import type { LoginResponse } from '@breakery/supabase';
import type * as BreakerySupabase from '@breakery/supabase';

const api = vi.hoisted(() => ({ login: vi.fn(), session: vi.fn(), logout: vi.fn(), from: vi.fn() }));
vi.mock('@/lib/supabase.js', () => ({ supabaseUrl: 'https://test.invalid', supabase: { from: api.from } }));
vi.mock('@breakery/supabase', async (original) => ({
  ...await original<typeof BreakerySupabase>(),
  loginWithPin: api.login, getSession: api.session, logoutSession: api.logout,
}));
vi.mock('@/features/auth/hooks/useLoginUsers.js', () => ({
  useLoginUsers: () => ({ data: [{ id: 'A', display_name: 'Alice', role: 'Manager' }], isLoading: false }),
}));

// Aucun mock du cache ni du résolveur : ce sont ceux réellement utilisés par App.
import { queryClient } from '@/lib/queryClient.js';
import { getSupabaseAccessToken } from '@breakery/supabase';
import { useAuthStore } from '../authStore.js';
import { ENTITY_NAMES_KEY, useEntityNames } from '@/features/accounting/hooks/useEntityNames.js';
import LoginPage from '@/pages/Login.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function loginResponse(id: string, token = `session-${id}`): LoginResponse {
  return {
    user: { id, full_name: id, employee_code: id, role_code: 'MANAGER' },
    session: { token, session_id: token, created_at: '2026-10-20T00:00:00Z' },
    auth: { access_token: `bearer-${token}`, refresh_token: 'unused', expires_at: Date.now() / 1000 + 3600 },
    permissions: ['orders.read'], session_timeout_minutes: 60,
  };
}

async function connect(id: string, token?: string) {
  api.login.mockResolvedValueOnce(loginResponse(id, token));
  expect(await useAuthStore.getState().login(id, '285741')).toBe(true);
}

function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

beforeEach(async () => {
  vi.resetAllMocks();
  api.logout.mockResolvedValue(undefined);
  await useAuthStore.getState().logout();
});

afterEach(() => { cleanup(); queryClient.clear(); });

describe('frontières de session avec le singleton réel', () => {
  it('purge queries et mutations dès le logout puis à l’acceptation du nouveau login', async () => {
    await connect('A');
    queryClient.setQueryData(['customers'], ['private A']);
    queryClient.getMutationCache().build(queryClient, { mutationFn: () => Promise.resolve('A') });
    const remote = deferred<void>();
    api.logout.mockReturnValueOnce(remote.promise);
    const leaving = useAuthStore.getState().logout();
    expect(queryClient.getQueryCache().getAll()).toHaveLength(0);
    expect(queryClient.getMutationCache().getAll()).toHaveLength(0);
    expect(getSupabaseAccessToken()).toBeNull();

    queryClient.setQueryData(['login-users'], ['pre-auth']);
    await connect('B');
    expect(queryClient.getQueryData(['login-users'])).toBeUndefined();
    queryClient.setQueryData(['customers'], ['private B']);
    remote.resolve();
    await leaving;
    expect(queryClient.getQueryData(['customers'])).toEqual(['private B']);
    expect(getSupabaseAccessToken()).toBe('bearer-session-B');
  });

  it('une query A tardive ne remplace pas B, même si le transport ignore AbortSignal', async () => {
    await connect('A');
    const remote = deferred<string>();
    const pending = queryClient.fetchQuery({ queryKey: ['customers'], queryFn: () => remote.promise, retry: false });
    // Attacher immédiatement le rejet : cancelQueries rejette la promesse observée.
    const settled = pending.catch(() => undefined);
    await connect('B');
    queryClient.setQueryData(['customers'], 'private B');
    remote.resolve('private A');
    await settled;
    expect(queryClient.getQueryData(['customers'])).toBe('private B');
  });

  it('un nouveau token du même utilisateur purge aussi le cache', async () => {
    await connect('A', 'first-session');
    queryClient.setQueryData(['customers'], ['first-session data']);
    await connect('A', 'second-session');
    expect(queryClient.getQueryData(['customers'])).toBeUndefined();
  });

  it('fast boot et renouvellement du même token gardent le cache et le snapshot immédiat', async () => {
    await connect('A');
    queryClient.setQueryData(['customers'], ['same session']);
    const remote = deferred<ReturnType<typeof sessionResponse>>();
    api.session.mockReturnValueOnce(remote.promise);
    await useAuthStore.getState().bootstrap();
    expect(useAuthStore.getState().bootstrapStatus).toBe('ready');
    expect(queryClient.getQueryData(['customers'])).toEqual(['same session']);
    const refresh = useAuthStore.getState().validateSession();
    expect(api.session).toHaveBeenCalledOnce();
    remote.resolve(sessionResponse());
    await refresh;
    expect(queryClient.getQueryData(['customers'])).toEqual(['same session']);
    expect(getSupabaseAccessToken()).toBe('renewed-A');
  });

  it('le vrai useEntityNames ne recrée aucun nom A après purge et résolution B', async () => {
    await connect('A');
    interface Rows { data: { id: string; name: string }[]; error: null }
    const old = deferred<Rows>();
    api.from.mockImplementation((table: string) => ({ select: () => ({ in: () => old.promise.then((response) =>
      table === 'customers' ? response : { data: [], error: null }) }) }));
    const a = renderHook(() => useEntityNames(['shared', 'only-a']), { wrapper });
    await waitFor(() => expect(api.from).toHaveBeenCalledTimes(3));
    await act(async () => { await connect('B'); });
    a.unmount();

    api.from.mockImplementation((table: string) => ({ select: () => ({ in: () => Promise.resolve({
      data: table === 'customers' ? [{ id: 'shared', name: 'Customer B' }] : [], error: null,
    }) }) }));
    const b = renderHook(() => useEntityNames(['shared']), { wrapper });
    await waitFor(() => expect(b.result.current.get('shared')).toBe('Customer B'));
    await act(async () => {
      old.resolve({ data: [{ id: 'shared', name: 'Customer A' }], error: null });
      await old.promise;
    });
    expect(queryClient.getQueryData([...ENTITY_NAMES_KEY, 'shared'])).toBe('Customer B');
    // A aurait aussi inscrit null pour only-a après une réponse complète.
    expect(queryClient.getQueryState([...ENTITY_NAMES_KEY, 'only-a'])).toBeUndefined();
  });
});

function sessionResponse() {
  const response = loginResponse('A');
  return {
    ...response.user, auth: { ...response.auth, access_token: 'renewed-A' },
    permissions: response.permissions, session_timeout_minutes: 60,
  };
}

describe('navigation après login accepté uniquement', () => {
  function renderLogin() {
    render(<MemoryRouter initialEntries={['/login']}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/backoffice" element={<p>Accepted destination</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByTestId('user-picker-A'));
    fireEvent.change(screen.getByLabelText('PIN for Alice'), { target: { value: '285741' } });
  }

  it('reste au login quand sa réponse est devenue obsolète', async () => {
    const remote = deferred<LoginResponse>();
    api.login.mockReturnValueOnce(remote.promise);
    // Un password n'a pas de rôle textbox implicite : cibler son label.
    render(<MemoryRouter initialEntries={['/login']}><Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/backoffice" element={<p>Accepted destination</p>} />
    </Routes></MemoryRouter>);
    fireEvent.click(screen.getByTestId('user-picker-A'));
    fireEvent.change(screen.getByLabelText('PIN for Alice'), { target: { value: '285741' } });
    await waitFor(() => expect(api.login).toHaveBeenCalledOnce());
    await act(async () => { await useAuthStore.getState().logout(); });
    await act(async () => { remote.resolve(loginResponse('A')); await remote.promise; });
    expect(screen.queryByText('Accepted destination')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign in to The Breakery backoffice' })).toBeInTheDocument();
  });

  it('navigue pour un login accepté', async () => {
    api.login.mockResolvedValueOnce(loginResponse('A'));
    renderLogin();
    expect(await screen.findByText('Accepted destination')).toBeInTheDocument();
  });
});
