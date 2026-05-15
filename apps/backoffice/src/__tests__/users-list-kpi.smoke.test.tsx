// apps/backoffice/src/__tests__/users-list-kpi.smoke.test.tsx
// Session 14 / Phase 6.A — verifies the KPI strip on UsersListPage matches
// `user.jpg` (Total / Active / Inactive / Defined Roles).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

vi.mock('@/features/users/hooks/useUsersList.js', () => ({
  useUsersList: () => ({
    data: [
      { id: 'u-1', auth_user_id: null, employee_code: 'EMP-001', full_name: 'Annisa',
        role_code: 'CASHIER', is_active: true,  failed_login_attempts: 0, locked_until: null,
        last_login_at: null, created_at: '', updated_at: '', deleted_at: null },
      { id: 'u-2', auth_user_id: null, employee_code: 'EMP-002', full_name: 'Mamat',
        role_code: 'OWNER', is_active: true,  failed_login_attempts: 0, locked_until: null,
        last_login_at: null, created_at: '', updated_at: '', deleted_at: null },
      { id: 'u-3', auth_user_id: null, employee_code: 'EMP-003', full_name: 'Bob',
        role_code: 'CASHIER', is_active: false, failed_login_attempts: 0, locked_until: null,
        last_login_at: null, created_at: '', updated_at: '', deleted_at: null },
    ],
    isLoading: false,
    error: null,
  }),
  USERS_LIST_KEY: ['users-list'],
}));

vi.mock('@/features/users/hooks/useRolesList.js', () => ({
  useRolesList: () => ({
    data: [
      { code: 'OWNER',   name: 'Owner',   description: null, is_system: true },
      { code: 'MANAGER', name: 'Manager', description: null, is_system: true },
      { code: 'CASHIER', name: 'Cashier', description: null, is_system: true },
      { code: 'STAFF',   name: 'Staff',   description: null, is_system: true },
    ],
    isLoading: false,
    error: null,
  }),
  ROLES_LIST_KEY: ['roles-list'],
}));

function renderPage(Component: React.ComponentType) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('UsersListPage (KPI rebuild)', () => {
  beforeEach(() => { cleanup(); });

  it('renders the new "User Administration" title', { timeout: 30_000 }, async () => {
    const UsersListPage = (await import('@/pages/users/UsersListPage.js')).default;
    renderPage(UsersListPage);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/User Administration/i);
  });

  it('renders all 4 KPI tile labels', { timeout: 15_000 }, async () => {
    const UsersListPage = (await import('@/pages/users/UsersListPage.js')).default;
    renderPage(UsersListPage);
    expect(screen.getByText(/Total users/i)).toBeInTheDocument();
    // "Active" / "Inactive" also appear in table rows as status — multiple matches expected.
    expect(screen.getAllByText(/^Active$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/^Inactive$/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Defined roles/i)).toBeInTheDocument();
  });
});
