// apps/backoffice/src/pages/users/__tests__/UserDetailPage.smoke.test.tsx
// Session 19 — Phase 3.B — Smoke test for the weak-PIN warn UX on UserDetailPage.
//
// Asserts :
//   1. Typing a weak PIN (123456) shows the inline weak-hint while typing.
//   2. After EF/RPC returns weak:true, the yellow weak-banner appears.
//   3. After EF/RPC returns weak:false, the banner does NOT appear (only
//      the green "PIN updated" success line shows).
//
// Mocking pattern : we mock the useResetUserPin hook module so we can drive
// the mutation behavior directly. Page reads userId from useParams (react-
// router) so we wrap with MemoryRouter + a /users/:id route. Other hook
// modules (useUsersList, useRolesList) are mocked to short-circuit network.
// useAuthStore is mocked to grant users.update permission.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// ---- Hook mocks ------------------------------------------------------------

// useResetUserPin — mutation we control via mockMutate.
type ResetArgs = { user_id: string; new_pin: string };
type ResetResult = { ok: true; weak: boolean; weak_reason?: 'sequence'|'repetition'|'common' };
type Callbacks = {
  onSuccess?: (data: ResetResult) => void;
  onError?: (e: Error) => void;
};

let mockMutateImpl: (args: ResetArgs, cb: Callbacks) => void = () => {};

const mockResetHook = vi.fn(() => ({
  mutate: (args: ResetArgs, cb: Callbacks) => mockMutateImpl(args, cb),
  isPending: false,
}));

vi.mock('@/features/users/hooks/useResetUserPin.js', () => ({
  useResetUserPin: () => mockResetHook(),
}));

// useUserDetail — return a fixed loaded user.
const FIXED_USER = {
  id:                    'user-1',
  auth_user_id:          'auth-1',
  employee_code:         'EMP001',
  full_name:             'Alice Baker',
  role_code:             'manager',
  is_active:             true,
  failed_login_attempts: 0,
  locked_until:          null,
  last_login_at:         '2026-05-17T08:00:00Z',
  created_at:            '2026-01-01T00:00:00Z',
  updated_at:            '2026-05-10T00:00:00Z',
  deleted_at:            null,
};

vi.mock('@/features/users/hooks/useUsersList.js', () => ({
  useUserDetail: () => ({ data: FIXED_USER, isLoading: false, error: null }),
  USER_DETAIL_KEY: (id: string) => ['user-detail', id],
  USERS_LIST_KEY:  ['users-list'],
}));

vi.mock('@/features/users/hooks/useRolesList.js', () => ({
  useRolesList: () => ({ data: [], isLoading: false, error: null }),
}));

// useAuthStore — grant users.update, pretend caller is NOT the target user.
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: <T,>(selector: (s: {
    hasPermission: (p: string) => boolean;
    user: { id: string } | null;
  }) => T) =>
    selector({
      hasPermission: () => true,
      user:          { id: 'caller-1' },
    }),
}));

// Dialog components are not exercised in these tests but must resolve.
vi.mock('@/features/users/components/RoleChangeDialog.js', () => ({
  RoleChangeDialog: () => null,
}));
vi.mock('@/features/users/components/DeleteUserDialog.js', () => ({
  DeleteUserDialog: () => null,
}));

// ---- Import after mocks ----------------------------------------------------

import UserDetailPage from '@/pages/users/UserDetailPage.js';

// ---- Helpers ---------------------------------------------------------------

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/users/user-1']}>
        <Routes>
          <Route path="/backoffice/users/:id" element={<UserDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// ---- Tests -----------------------------------------------------------------

describe('UserDetailPage — weak PIN warn UX (Session 19 Phase 3.B)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateImpl = () => {};
  });

  // S21 / 1.C.3 — PIN regex now requires exactly 6 digits (DEV-S19-3.B-01).
  it('rejects PIN shorter than 6 digits with validation error', () => {
    let mutateCalled = false;
    mockMutateImpl = () => { mutateCalled = true; };
    renderPage();
    const input = screen.getByLabelText(/new pin/i);
    fireEvent.change(input, { target: { value: '12345' } }); // 5 digits
    fireEvent.click(screen.getByRole('button', { name: /reset pin/i }));
    expect(screen.getByText(/exactly 6 digits/i)).toBeInTheDocument();
    expect(mutateCalled).toBe(false);
  });

  it('accepts PIN of exactly 6 digits and calls mutation', () => {
    let mutateCalled = false;
    mockMutateImpl = (_args, cb) => {
      mutateCalled = true;
      cb.onSuccess?.({ ok: true, weak: false });
    };
    renderPage();
    const input = screen.getByLabelText(/new pin/i);
    fireEvent.change(input, { target: { value: '285741' } }); // 6 digits, strong
    fireEvent.click(screen.getByRole('button', { name: /reset pin/i }));
    expect(mutateCalled).toBe(true);
    expect(screen.queryByText(/exactly 6 digits/i)).toBeNull();
  });

  it('shows inline weak hint while typing a weak PIN (123456)', async () => {
    renderPage();
    const input = await screen.findByLabelText(/new pin/i);
    fireEvent.change(input, { target: { value: '123456' } });
    const hint = await screen.findByTestId('pin-weak-hint');
    expect(hint).toBeInTheDocument();
    expect(hint.textContent).toContain('sequence');
  });

  it('shows weak banner after mutation returns weak:true', async () => {
    mockMutateImpl = (_args, cb) => {
      cb.onSuccess?.({ ok: true, weak: true, weak_reason: 'sequence' });
    };

    renderPage();
    const input = await screen.findByLabelText(/new pin/i);
    fireEvent.change(input, { target: { value: '123456' } });
    fireEvent.click(screen.getByRole('button', { name: /reset pin/i }));

    const banner = await screen.findByTestId('pin-weak-banner');
    expect(banner).toBeInTheDocument();
    expect(banner.getAttribute('role')).toBe('alert');
    expect(banner.textContent).toContain('weak');
    expect(banner.textContent).toContain('sequence');
  });

  it('does NOT show weak banner when mutation returns weak:false', async () => {
    mockMutateImpl = (_args, cb) => {
      cb.onSuccess?.({ ok: true, weak: false });
    };

    renderPage();
    const input = await screen.findByLabelText(/new pin/i);
    // Use a strong PIN — no inline hint, no banner.
    fireEvent.change(input, { target: { value: '285741' } });
    fireEvent.click(screen.getByRole('button', { name: /reset pin/i }));

    await waitFor(() => {
      expect(screen.getByText(/pin updated/i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId('pin-weak-banner')).toBeNull();
  });
});
