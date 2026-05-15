// apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx
//
// Session 14 / Phase 4.A — Sidebar smoke tests.
//
// Verifies:
//   - Group labels render in uppercase (OPERATIONS / MANAGEMENT / ADMIN)
//   - Active route highlight applied (NavLink isActive class)
//   - Permission-gated items are hidden when the role lacks the permission
//   - Navigation items are reachable via role=link

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Mock the alerts hooks BEFORE importing Sidebar so AlertsBadge doesn't fail.
vi.mock('@/features/inventory-alerts/hooks/useLowStock.js', () => ({
  useLowStock: () => ({ data: [] }),
}));
vi.mock('@/features/inventory-alerts/hooks/useReorderSuggestions.js', () => ({
  useReorderSuggestions: () => ({ data: [] }),
}));
vi.mock('@/features/inventory/hooks/useExpiringLots.js', () => ({
  useExpiringLots: () => ({ data: [] }),
}));

import { Sidebar } from '@/layouts/Sidebar.js';
import { useAuthStore } from '@/stores/authStore.js';

function setAuthState(perms: string[]) {
  useAuthStore.setState({
    user: { id: 'u-1', full_name: 'Mamat', role_code: 'OWNER', employee_code: 'E1' },
    sessionToken: 'tok',
    permissions: perms,
    isAuthenticated: true,
    isLoading: false,
    error: null,
  });
}

function renderWith(ui: React.ReactNode, route = '/backoffice') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Sidebar', () => {
  beforeEach(() => {
    cleanup();
  });

  it('renders the three group labels in uppercase', () => {
    setAuthState([
      'inventory.read', 'reports.read', 'users.read', 'settings.read',
    ]);
    renderWith(<Sidebar />);
    // SectionLabel renders the literal string; CSS uppercases it.
    // We assert the label exists via the rendered text + check class.
    const ops = screen.getByRole('heading', { name: /Operations/i });
    const mgmt = screen.getByRole('heading', { name: /Management/i });
    const admin = screen.getByRole('heading', { name: /Admin/i });
    expect(ops).toBeInTheDocument();
    expect(mgmt).toBeInTheDocument();
    expect(admin).toBeInTheDocument();
    // SectionLabel applies uppercase via Tailwind class
    expect(ops.className).toMatch(/uppercase/);
  });

  it('renders Dashboard link as active when on /backoffice', () => {
    setAuthState([]);
    renderWith(<Sidebar />, '/backoffice');
    const dash = screen.getByRole('link', { name: /Dashboard/i });
    // NavLink applies aria-current=page when active in v6
    expect(dash).toHaveAttribute('aria-current', 'page');
  });

  it('hides permission-gated items when permissions are missing', () => {
    setAuthState([]); // no permissions
    renderWith(<Sidebar />);
    // Settings requires settings.read → must be absent
    expect(screen.queryByRole('link', { name: /^Settings$/i })).toBeNull();
    // Reports requires reports.read → must be absent
    expect(screen.queryByRole('link', { name: /^Reports$/i })).toBeNull();
    // Dashboard has no permission gate → visible
    expect(screen.getByRole('link', { name: /Dashboard/i })).toBeInTheDocument();
  });

  it('shows AlertsBadge when user has inventory.read', () => {
    setAuthState(['inventory.read']);
    renderWith(<Sidebar />);
    // AlertsBadge renders a link to /backoffice/inventory/alerts
    const alerts = screen.getAllByRole('link', { name: /inventory alerts/i });
    expect(alerts.length).toBeGreaterThan(0);
  });
});
