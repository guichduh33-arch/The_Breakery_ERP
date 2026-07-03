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
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import LoginPage from '../Login';

const navigateMock = vi.fn();
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateMock };
});

const authState = { current: { error: null as string | null, isLoading: false } };
const loginMock = vi.fn();
const setErrorMock = vi.fn();

vi.mock('@/stores/authStore', () => ({
  useAuthStore: Object.assign(
    <T,>(selector: (s: {
      login: typeof loginMock;
      error: string | null;
      setError: typeof setErrorMock;
      isLoading: boolean;
    }) => T) =>
      selector({
        login: loginMock,
        error: authState.current.error,
        setError: setErrorMock,
        isLoading: authState.current.isLoading,
      }),
    { getState: () => ({ user: { role_code: 'CASHIER' } }) },
  ),
}));

const loginUsersState = {
  current: {
    data: [
      { id: 'u1', display_name: 'Mamat (Owner)', role: 'Super Admin' },
      { id: 'u2', display_name: 'New Hire', role: 'Cashier' },
    ] as Array<{ id: string; display_name: string; role: string }> | undefined,
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

function renderPage() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>,
  );
}

describe('POS LoginPage — dynamic user picker (S58 T3)', () => {
  beforeEach(() => {
    navigateMock.mockReset();
    loginMock.mockReset();
    loginMock.mockResolvedValue(undefined);
    setErrorMock.mockReset();
    loginUsersState.refetch.mockReset();
    authState.current = { error: null, isLoading: false };
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

  it('defaults to the first returned user — not a hardcoded seed', () => {
    renderPage();
    expect(screen.getByText('Mamat (Owner)')).toBeInTheDocument();
  });

  it('lists a newly-created employee (regression: used to be invisible)', () => {
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
    for (const d of ['1', '2', '3', '4', '5', '6']) {
      fireEvent.click(screen.getByRole('button', { name: d }));
    }
    expect(loginMock).toHaveBeenCalledWith('u1', '123456');
  });
});
