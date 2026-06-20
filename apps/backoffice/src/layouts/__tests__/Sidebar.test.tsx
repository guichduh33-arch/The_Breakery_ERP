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
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const SUBGROUP_STORAGE_KEY = 'bo:sidebar:subgroups';
const GROUP_STORAGE_KEY = 'bo:sidebar:groups';
const ALL_TOP_GROUPS = [
  'Operations',
  'Sales',
  'Purchase',
  'Stock Management',
  'Finance',
  'Reports',
  'Settings',
];
/** Pre-open every top-level category so nested subgroup buttons/links render. */
function openAllTopGroups() {
  localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(ALL_TOP_GROUPS));
}
const ALL_NAMED_SUBGROUPS = [
  'Finance::Expenses',
  'Finance::Accounting',
  'Reports::Sales reports',
  'Reports::Inventory reports',
  'Reports::Financial reports',
  'Reports::Marketing reports',
  'Reports::Audit',
  'Settings::Devices',
  'Settings::Users & Access',
];

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
  'combos.read',
  'inventory.read',
  'inventory.receive',
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
    localStorage.clear();
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

  it('renders subgroup toggle buttons inside Finance / Reports / Settings', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    // Named subgroups now render as clickable <button> toggles (collapsed by default).
    expect(screen.getByRole('button', { name: /^Expenses/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Accounting/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Sales reports/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Inventory reports/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Financial reports/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Marketing reports/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Audit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Devices/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Users & Access/i })).toBeInTheDocument();
  });

  it('renders the dropped entries nowhere (POS Terminal / Kitchen Display / New user)', () => {
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    expect(screen.queryByRole('link', { name: /POS Terminal/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /Kitchen Display/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^New user$/i })).toBeNull();
  });

  it('renders the renamed labels (8 renames) when all named subgroups are opened via localStorage', () => {
    // Pre-open every top-level category + named subgroup so renames inside
    // Finance / Reports / Settings render.
    openAllTopGroups();
    localStorage.setItem(SUBGROUP_STORAGE_KEY, JSON.stringify(ALL_NAMED_SUBGROUPS));
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

  it('renders Incoming / Transfers / Expiring stock links under Stock Management (audit M6)', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    expect(screen.getByRole('link', { name: /^Incoming$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Transfers$/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /^Expiring stock$/i })).toBeInTheDocument();
  });

  it('renders the Combos link under Stock Management gated on combos.read (S48)', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    const combos = screen.getByRole('link', { name: /^Combos$/i });
    expect(combos).toBeInTheDocument();
    expect(combos).toHaveAttribute('href', '/backoffice/products/combos');
  });

  it('hides the Combos link when combos.read is missing (S48)', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS.filter((p) => p !== 'combos.read'));
    renderWith(<Sidebar />);
    expect(screen.queryByRole('link', { name: /^Combos$/i })).toBeNull();
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

  it('keeps named subgroup items collapsed by default; unnamed subgroup items stay visible', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    // Items inside named subgroups (Finance/Reports/Settings) are hidden at first load.
    expect(screen.queryByRole('link', { name: /^Profit & Loss$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^Expense Thresholds$/i })).toBeNull();
    expect(screen.queryByRole('link', { name: /^RBAC Editor$/i })).toBeNull();
    // The toggle button itself reports aria-expanded=false.
    expect(screen.getByRole('button', { name: /^Expenses/i })).toHaveAttribute('aria-expanded', 'false');
    // Items inside unnamed subgroups (Reports Hub line, General settings line) stay visible.
    expect(screen.getByRole('link', { name: /Reports Hub/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /General settings/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Permissions Matrix/i })).toBeInTheDocument();
  });

  it('toggles a subgroup open on click — items appear and aria-expanded flips', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    const expensesBtn = screen.getByRole('button', { name: /^Expenses/i });
    expect(expensesBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /^Expense Thresholds$/i })).toBeNull();
    fireEvent.click(expensesBtn);
    expect(expensesBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /^Expense Thresholds$/i })).toBeInTheDocument();
    // Toggling back collapses it again.
    fireEvent.click(expensesBtn);
    expect(expensesBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /^Expense Thresholds$/i })).toBeNull();
  });

  it('restores subgroup state from localStorage on mount', () => {
    openAllTopGroups();
    localStorage.setItem(SUBGROUP_STORAGE_KEY, JSON.stringify(['Reports::Financial reports']));
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    // Pre-opened subgroup renders its items.
    expect(screen.getByRole('link', { name: /^Profit & Loss$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Financial reports/i })).toHaveAttribute('aria-expanded', 'true');
    // Other subgroups stay closed.
    expect(screen.queryByRole('link', { name: /^Expense Thresholds$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Expenses/i })).toHaveAttribute('aria-expanded', 'false');
  });

  it('writes opened subgroups to localStorage on toggle', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />);
    fireEvent.click(screen.getByRole('button', { name: /^Devices/i }));
    const raw = localStorage.getItem(SUBGROUP_STORAGE_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw!);
    expect(stored).toContain('Settings::Devices');
  });

  // ---- Top-level category collapsibility (collapsible accordion) ----

  it('collapses top-level categories by default — only the active route category is open', () => {
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />, '/backoffice'); // Dashboard → Operations is active
    // Operations is auto-opened → Dashboard link visible.
    expect(screen.getByRole('link', { name: /^Dashboard$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Operations$/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // Sales is NOT active → collapsed → its links are not rendered.
    expect(screen.queryByRole('link', { name: /^Orders$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^Sales$/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('auto-opens the category that owns the active deep route', () => {
    setAuthState(ALL_PERMS);
    // /backoffice/inventory/recipes lives under Stock Management.
    renderWith(<Sidebar />, '/backoffice/inventory/recipes');
    expect(screen.getByRole('button', { name: /^Stock Management$/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: /^Recipes$/i })).toBeInTheDocument();
    // Operations (not the active group) stays collapsed.
    expect(screen.getByRole('button', { name: /^Operations$/i })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('toggles a top-level category open/closed and persists to localStorage', () => {
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />, '/backoffice');
    const salesBtn = screen.getByRole('button', { name: /^Sales$/i });
    expect(salesBtn).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /^Orders$/i })).toBeNull();

    fireEvent.click(salesBtn);
    expect(salesBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: /^Orders$/i })).toBeInTheDocument();

    const stored = JSON.parse(localStorage.getItem(GROUP_STORAGE_KEY)!);
    expect(stored).toContain('Sales');
  });

  it('restores top-level category state from localStorage on mount', () => {
    localStorage.setItem(GROUP_STORAGE_KEY, JSON.stringify(['Sales']));
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />, '/backoffice');
    // Sales was persisted-open even though it does not own the active route.
    expect(screen.getByRole('button', { name: /^Sales$/i })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getByRole('link', { name: /^Orders$/i })).toBeInTheDocument();
  });

  it('wires each category trigger to its panel via aria-controls', () => {
    openAllTopGroups();
    setAuthState(ALL_PERMS);
    renderWith(<Sidebar />, '/backoffice');
    const opsBtn = screen.getByRole('button', { name: /^Operations$/i });
    const panelId = opsBtn.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    expect(document.getElementById(panelId!)).not.toBeNull();
  });
});
