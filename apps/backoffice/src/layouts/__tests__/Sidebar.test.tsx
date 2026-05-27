// apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx
//
// Sidebar smoke tests — covers the 7-group reorg (2026-05-27).
//
// Verifies:
//   - All 7 group labels render (Operations / Sales / Purchase / Stock Management /
//     Finance / Reports / Settings)
//   - Subgroup labels render inside Finance / Reports / Settings when their items
//     are visible (SUPER_ADMIN render)
//   - Dropped entries (POS Terminal / Kitchen Display / "New user") never render
//   - Renamed labels render (Product Categories, Customer Categories,
//     B2B Credit Settings, Cash Closing, Live Movements, Stock Movement History,
//     RBAC Editor, Permissions Matrix)
//   - Active route highlight applied (NavLink aria-current=page)
//   - Permission-gated groups/items are hidden when the role lacks the permission
//   - AlertsBadge reachable when user has inventory.read

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

// Full SUPER_ADMIN permission set — every gate seen in Sidebar.tsx GROUPS.
const ALL_PERMS = [
  'print_queue.read',
  'orders.read',
  'customers.read',
  'customer_categories.read',
  'settings.read',
  'promotions.read',
  'loyalty.read',
  'purchasing.po.read',
  'suppliers.read',
  'categories.read',
  'inventory.read',
  'expenses.read',
  'expenses.thresholds.read',
  'accounting.coa.read',
  'accounting.gl.read',
  'accounting.tb.read',
  'accounting.read',
  'accounting.period.close',
  'zreports.read',
  'reports.read',
  'reports.sales.read',
  'reports.inventory.read',
  'reports.financial.read',
  'reports.audit.read',
  'lan.devices.read',
  'users.read',
  'rbac.read',
];

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

  it('renders all 7 top-level group labels with the SUPER_ADMIN perm set', () => {
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    expect(screen.getByRole('heading', { name: /^Operations$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Sales$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Purchase$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Stock Management$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Finance$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Reports$/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Settings$/i })).toBeInTheDocument();
    // SectionLabel applies uppercase via Tailwind
    expect(screen.getByRole('heading', { name: /^Operations$/i }).className).toMatch(/uppercase/);
  });

  it('renders subgroup labels inside Finance / Reports / Settings', () => {
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    // Finance subgroups
    expect(screen.getByText('Expenses', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Accounting', { selector: 'div' })).toBeInTheDocument();
    // Reports subgroups
    expect(screen.getByText('Sales reports', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Inventory reports', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Financial reports', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Marketing reports', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Audit', { selector: 'div' })).toBeInTheDocument();
    // Settings subgroups
    expect(screen.getByText('Devices', { selector: 'div' })).toBeInTheDocument();
    expect(screen.getByText('Users & Access', { selector: 'div' })).toBeInTheDocument();
  });

  it('renders the dropped entries nowhere (POS Terminal / Kitchen Display / New user)', () => {
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    expect(screen.queryByRole('link', { name: /POS Terminal/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Kitchen Display/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^New user$/i })).toBeNull();
  });

  it('renders the renamed labels (8 renames)', () => {
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    expect(screen.getByRole('link', { name: /Product Categories/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Customer Categories/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /B2B Credit Settings/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Cash Closing/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Live Movements/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Stock Movement History/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /RBAC Editor/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Permissions Matrix/i })).toBeInTheDocument();
  });

  it('renders Dashboard link as active when on /backoffice', () => {
    setAuthState([]);
    renderWith(<Sidebar />, '/backoffice');
    const dash = screen.getByRole('link', { name: /^Dashboard$/i });
    expect(dash).toHaveAttribute('aria-current', 'page');
  });

  it('hides permission-gated groups + items when permissions are missing', () => {
    setAuthState([]); // no permissions
    renderWith(<Sidebar />);
    // No perms → Finance / Reports / Settings groups should be empty and therefore
    // their group labels should NOT render (the filter drops empty groups).
    expect(screen.queryByRole('heading', { name: /^Finance$/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Reports$/i })).toBeNull();
    expect(screen.queryByRole('heading', { name: /^Settings$/i })).toBeNull();
    // Operations group still renders because Dashboard has no permission gate.
    expect(screen.getByRole('heading', { name: /^Operations$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Dashboard$/i })).toBeInTheDocument();
    // Print Queue is gated by print_queue.read → hidden
    expect(screen.queryByRole('link', { name: /Print Queue/i })).toBeNull();
  });

  it('shows AlertsBadge when user has inventory.read', () => {
    setAuthState(['inventory.read']);
    renderWith(<Sidebar />);
    // AlertsBadge renders a link to /backoffice/inventory/alerts
    const alerts = screen.getAllByRole('link', { name: /inventory alerts/i });
    expect(alerts.length).toBeGreaterThan(0);
  });
});
