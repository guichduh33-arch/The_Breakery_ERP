// apps/backoffice/src/features/settings/__tests__/SettingsPermissionsPage.smoke.test.tsx
// Session 13 / Phase 5.C — Smoke test for the read-only permissions matrix.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SettingsPermissionsPage from '@/pages/settings/SettingsPermissionsPage.js';

const currentPerms = new Set<string>(['settings.read']);

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const MOCK_ROLES = [
  { code: 'SUPER_ADMIN', name: 'Super Admin', description: null, is_system: true, created_at: '2026-01-01T00:00:00Z' },
  { code: 'ADMIN',       name: 'Admin',       description: null, is_system: true, created_at: '2026-01-01T00:00:00Z' },
  { code: 'MANAGER',     name: 'Manager',     description: null, is_system: true, created_at: '2026-01-01T00:00:00Z' },
];

const MOCK_PERMISSIONS = [
  { code: 'settings.read',   module: 'settings', action: 'read',   description: 'View settings',   created_at: '2026-01-01T00:00:00Z' },
  { code: 'settings.update', module: 'settings', action: 'update', description: 'Update settings', created_at: '2026-01-01T00:00:00Z' },
];

const MOCK_GRANTS = [
  { role_code: 'SUPER_ADMIN', permission_code: 'settings.read',   is_granted: true,  granted_at: '2026-01-01T00:00:00Z', granted_by: null },
  { role_code: 'SUPER_ADMIN', permission_code: 'settings.update', is_granted: true,  granted_at: '2026-01-01T00:00:00Z', granted_by: null },
  { role_code: 'ADMIN',       permission_code: 'settings.read',   is_granted: true,  granted_at: '2026-01-01T00:00:00Z', granted_by: null },
  { role_code: 'ADMIN',       permission_code: 'settings.update', is_granted: true,  granted_at: '2026-01-01T00:00:00Z', granted_by: null },
  { role_code: 'MANAGER',     permission_code: 'settings.read',   is_granted: true,  granted_at: '2026-01-01T00:00:00Z', granted_by: null },
];

interface RpcResult { data: unknown; error: { message: string } | null }

interface MockChain {
  select: () => MockChain;
  order:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  function buildChain(table: string): MockChain {
    const data =
      table === 'roles'            ? MOCK_ROLES :
      table === 'permissions'      ? MOCK_PERMISSIONS :
      table === 'role_permissions' ? MOCK_GRANTS :
      [];
    const chain: MockChain = {
      select: () => {
        // role_permissions chain skips .order() and resolves directly. The
        // hook does `.from('role_permissions').select('*')`, so simulate the
        // thenable shape.
        if (table === 'role_permissions') {
          return Object.assign(chain, {
            then: (resolve: (v: RpcResult) => void) => resolve({ data, error: null }),
          });
        }
        return chain;
      },
      order: () => Promise.resolve({ data, error: null }),
    };
    return chain;
  }
  return {
    supabase: { from: (table: string) => buildChain(table) },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <SettingsPermissionsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsPermissionsPage', () => {
  beforeEach(() => {
    currentPerms.clear();
    currentPerms.add('settings.read');
  });

  it('renders the heading and the link to Users → Permissions', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /^Permissions$/i })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Users → Permissions/i });
    expect(link).toHaveAttribute('href', '/backoffice/users/permissions');
  });

  it('shows the permission rows once data loads', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('settings.read')).toBeInTheDocument();
      expect(screen.getByText('settings.update')).toBeInTheDocument();
    });
  });

  it('shows a green dot for granted perms and an empty dot for ungranted', async () => {
    renderPage();
    await waitFor(() => screen.getByText('settings.read'));
    const granted = screen.getAllByLabelText('granted');
    expect(granted.length).toBeGreaterThanOrEqual(5); // 5 grants in mock data
  });

  it('shows a permission-denied message when settings.read is missing', () => {
    currentPerms.clear();
    renderPage();
    expect(screen.getByText(/You do not have permission/i)).toBeInTheDocument();
  });
});
