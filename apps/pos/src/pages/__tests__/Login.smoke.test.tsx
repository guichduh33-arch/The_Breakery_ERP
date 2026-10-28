// apps/pos/src/pages/__tests__/Login.smoke.test.tsx
//
// Vague 0 / Tâche 3 (S58) — smoke test for the POS login picker.
//
// Covers the regression this ticket fixes: the picker used to be hardcoded
// to 2 seed accounts (`SEED_USERS`) — an employee created in the BackOffice
// was invisible here. It now consumes `useLoginUsers()`
// (→ `list_login_users_v1`). Also covers the loading/error/empty states and
// the PIN copy now reading "6-digit" (was "4-6 digit").

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouterDom from 'react-router-dom';
import LoginPage from '../Login';
import { useAuthStore } from '@/stores/authStore';

const navigateMock = vi.fn();
const nativeMock = vi.hoisted(() => vi.fn(() => false));
vi.mock('@/lib/nativeShell', () => ({ isNativeShell: nativeMock }));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof ReactRouterDom>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const { loginMock, setErrorMock } = vi.hoisted(() => ({
  loginMock: vi.fn(),
  setErrorMock: vi.fn(),
}));

vi.mock('@/stores/authStore', async () => {
  const { create } = await import('zustand');
  return {
    useAuthStore: create(() => ({
      login: loginMock,
      error: null as string | null,
      setError: setErrorMock,
      isLoading: false,
      user: { role_code: 'CASHIER' },
    })),
  };
});

const loginUsersState = {
  current: {
    data: [
      { id: 'u1', display_name: 'Mamat (Owner)', role: 'Super Admin' },
      { id: 'u2', display_name: 'New Hire', role: 'Cashier' },
    ] as { id: string; display_name: string; role: string }[] | undefined,
    isLoading: false,
    isError: false,
    isFetching: false,
  },
  refetch: vi.fn(),
};

vi.mock('@/features/auth/hooks/useLoginUsers', () => ({
  useLoginUsers: () => ({
    data: loginUsersState.current.data,
    isLoading: loginUsersState.current.isLoading,
    isError: loginUsersState.current.isError,
    isFetching: loginUsersState.current.isFetching,
    refetch: loginUsersState.refetch,
  }),
}));

function renderPage(returnTo?: unknown) {
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/login', state: { returnTo } }]}>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('POS LoginPage — dynamic user picker (S58 T3)', () => {
  beforeEach(() => {
    localStorage.clear();
    nativeMock.mockReturnValue(false);
    navigateMock.mockReset();
    loginMock.mockReset();
    loginMock.mockResolvedValue(undefined);
    setErrorMock.mockReset();
    setErrorMock.mockImplementation((error: string | null) => useAuthStore.setState({ error }));
    loginUsersState.refetch.mockReset();
    useAuthStore.setState({ error: null, isLoading: false });
    loginUsersState.current = {
      data: [
        { id: 'u1', display_name: 'Mamat (Owner)', role: 'Super Admin' },
        { id: 'u2', display_name: 'New Hire', role: 'Cashier' },
      ],
      isLoading: false,
      isError: false,
      isFetching: false,
    };
  });

  it('does not preselect an arbitrary user — the picker is open until a choice is made', () => {
    renderPage();
    // Both users are offered ; nobody is "Welcome"-ed by default and the
    // digits are inert (a reflex-typed PIN can no longer lock a colleague).
    expect(screen.getByText('Who is signing in?')).toBeInTheDocument();
    expect(screen.getByText('Mamat (Owner)')).toBeInTheDocument();
    expect(screen.getByText('New Hire')).toBeInTheDocument();
    expect(screen.queryByText(/welcome,/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeDisabled();
  });

  it('remembers the last user who signed in on this terminal', () => {
    localStorage.setItem('pos:last_login_user', 'u2');
    renderPage();
    expect(screen.getByText(/welcome,/i)).toBeInTheDocument();
    expect(screen.getByText('New Hire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1' })).toBeEnabled();
  });

  it('lists a newly-created employee (regression: used to be invisible)', () => {
    localStorage.setItem('pos:last_login_user', 'u1');
    renderPage();
    fireEvent.click(screen.getByText('Switch'));
    expect(screen.getByText('New Hire')).toBeInTheDocument();
  });

  it('shows a loading state instead of a blank picker', () => {
    loginUsersState.current = { data: undefined, isLoading: true, isError: false, isFetching: false };
    renderPage();
    expect(screen.getByTestId('login-users-loading')).toBeInTheDocument();
  });

  it('shows an error + retry affordance on fetch failure (offline)', () => {
    loginUsersState.current = { data: undefined, isLoading: false, isError: true, isFetching: false };
    renderPage();
    expect(screen.getByTestId('login-users-error')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(loginUsersState.refetch).toHaveBeenCalled();
  });

  it('shows an empty state when no active staff are returned', () => {
    loginUsersState.current = { data: [], isLoading: false, isError: false, isFetching: false };
    renderPage();
    expect(screen.getByTestId('login-users-empty')).toBeInTheDocument();
  });

  it('reads the PIN copy as exactly 6 digits (was "4-6 digit")', () => {
    renderPage();
    expect(screen.getByText(/enter your 6-digit pin/i)).toBeInTheDocument();
  });

  it('auto-submits login(userId, pin) once 6 digits are typed', () => {
    renderPage();
    fireEvent.click(screen.getByText('Mamat (Owner)'));
    for (const d of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(loginMock).toHaveBeenCalledWith('u1', '123456');
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('sends one request while pending and after success when navigation is delayed', async () => {
    let resolveLogin!: (accepted: boolean) => void;
    loginMock.mockImplementation(() => {
      useAuthStore.setState({ isLoading: true });
      return new Promise<boolean>((resolve) => { resolveLogin = resolve; });
    });
    navigateMock.mockReturnValue(new Promise<void>(() => { /* La navigation reste en attente. */ }));
    renderPage();
    fireEvent.click(screen.getByText('Mamat (Owner)'));
    for (const digit of '123456') fireEvent.click(screen.getByRole('button', { name: digit }));

    expect(loginMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '6' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '6' }));
    expect(loginMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAuthStore.setState({ isLoading: false });
      resolveLogin(true);
      await Promise.resolve();
    });
    expect(navigateMock).toHaveBeenCalledWith('/pos', { replace: true });
    expect(screen.getByText('6 of 6 digits entered')).toBeInTheDocument();
    expect(loginMock).toHaveBeenCalledTimes(1);
  });

  it('allows the same PIN to be entered again after a failed request', async () => {
    let resolveLogin!: (accepted: boolean) => void;
    let rejectLogin!: (error: Error) => void;
    loginMock.mockImplementation(() => {
      useAuthStore.setState({ isLoading: true });
      return new Promise<boolean>((resolve, reject) => {
        resolveLogin = resolve;
        rejectLogin = reject;
      });
    });
    renderPage();
    fireEvent.click(screen.getByText('Mamat (Owner)'));
    for (const digit of '123456') fireEvent.click(screen.getByRole('button', { name: digit }));

    await act(async () => {
      useAuthStore.setState({ error: 'invalid_credentials', isLoading: false });
      rejectLogin(new Error('invalid_credentials'));
      await Promise.resolve();
    });
    expect(screen.getByText('0 of 6 digits entered')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(loginMock).toHaveBeenCalledTimes(1);

    for (const digit of '123456') fireEvent.click(screen.getByRole('button', { name: digit }));
    expect(loginMock).toHaveBeenCalledTimes(2);
    expect(loginMock).toHaveBeenNthCalledWith(2, 'u1', '123456');
    await act(async () => {
      useAuthStore.setState({ isLoading: false });
      resolveLogin(true);
      await Promise.resolve();
    });
    expect(navigateMock).toHaveBeenCalledWith('/pos', { replace: true });
    expect(loginMock).toHaveBeenCalledTimes(2);
  });

  it('ouvre la salle après connexion dans l’APK, même avec un compte habilité non waiter', async () => {
    nativeMock.mockReturnValue(true);
    renderPage();
    fireEvent.click(screen.getByText('Mamat (Owner)'));
    for (const digit of '123456') fireEvent.click(screen.getByRole('button', { name: digit }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/tablet/order', { replace: true }));
  });

  it.each(['/tablet/order', '/tablet/orders'])('conserve la destination tablette %s après le PIN sur le web', async (route) => {
    renderPage(route);
    fireEvent.click(screen.getByText('Mamat (Owner)'));
    for (const digit of '123456') fireEvent.click(screen.getByRole('button', { name: digit }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(route, { replace: true }));
  });

  it.each([undefined, 'https://example.com/tablet/order', '//example.com', '/pos/settings'])('ignore une destination de retour non autorisée %s', async (route) => {
    renderPage(route);
    fireEvent.click(screen.getByText('Mamat (Owner)'));
    for (const digit of '123456') fireEvent.click(screen.getByRole('button', { name: digit }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/pos', { replace: true }));
  });
});
