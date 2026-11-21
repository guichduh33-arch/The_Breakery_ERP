// apps/backoffice/src/__tests__/customers-list.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for the rebuilt CustomersListPage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomersListPage from '@/pages/customers/CustomersListPage.js';

vi.mock('@/lib/supabase.js', () => {
  const customers = [
    {
      id: 'c1', name: 'Bali Organic Store', phone: '+6281234567890', email: null,
      customer_type: 'b2b',
      loyalty_points: 0, lifetime_points: 0, total_spent: 0, total_visits: 0,
      last_visit_at: null, category_id: 'cat-w', b2b_current_balance: 0,
      created_at: '2026-04-01T00:00:00Z',
      customer_categories: { id: 'cat-w', slug: 'wholesale', name: 'Wholesale' },
    },
    {
      id: 'c2', name: 'Walk-in Customer', phone: null, email: null,
      customer_type: 'retail',
      loyalty_points: 120, lifetime_points: 250, total_spent: 50000, total_visits: 4,
      last_visit_at: '2026-05-13T11:00:00Z',
      category_id: 'cat-g', b2b_current_balance: 0,
      created_at: '2026-04-01T00:00:00Z',
      customer_categories: { id: 'cat-g', slug: 'general', name: 'General' },
    },
  ];
  const cats = [
    { id: 'cat-g', name: 'General',   slug: 'general',   color: null, icon: null,
      price_modifier_type: 'retail', discount_percentage: 0,
      loyalty_enabled: true, points_multiplier: 1, is_default: true, is_active: true },
    { id: 'cat-w', name: 'Wholesale', slug: 'wholesale', color: null, icon: null,
      price_modifier_type: 'wholesale', discount_percentage: 0,
      loyalty_enabled: false, points_multiplier: 1, is_default: false, is_active: true },
  ];

  type Resolver = (v: unknown) => void;
  const make = (rows: unknown[]) => {
    const builder: Record<string, unknown> = {
      select:  () => builder,
      is:      () => builder,
      eq:      () => builder,
      or:      () => builder,
      gte:     () => builder,
      lte:     () => builder,
      order:   () => builder,
      limit:   () => builder,
      then:    (resolve: Resolver) => resolve({ data: rows, error: null }),
    };
    return builder;
  };

  return {
    supabase: {
      from: (table: string) => {
        if (table === 'customer_categories') return make(cats);
        return make(customers);
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const perms = vi.hoisted(() => ({
  granted: ['customers.read', 'customers.create', 'customer_categories.read'] as string[],
}));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => perms.granted.includes(p) }),
}));

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.search}</output>;
}

function renderPage(url = '/backoffice/customers') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <CustomersListPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomersListPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    perms.granted = ['customers.read', 'customers.create', 'customer_categories.read'];
  });

  it('opens on the Sales breadcrumb', () => {
    renderPage();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent('Sales');
    expect(crumbs).toHaveTextContent('Customers');
  });

  it('restores tier, sort, page size and search from the URL', () => {
    renderPage('/backoffice/customers?q=bali&tier=gold&sort=spend&size=100');
    expect(screen.getByLabelText('Search customers')).toHaveValue('bali');
    expect(screen.getByLabelText('Loyalty tier')).toHaveValue('gold');
    expect(screen.getByLabelText('Sort')).toHaveValue('spend');
    fireEvent.change(screen.getByLabelText('Loyalty tier'), { target: { value: 'silver' } });
    const search = screen.getByTestId('location').textContent ?? '';
    expect(search).toContain('tier=silver');
    expect(search).toContain('sort=spend');
    expect(search).toContain('q=bali');
  });

  it('ignores unknown URL values instead of filtering on them', () => {
    renderPage('/backoffice/customers?tier=diamond&sort=oops&category=not-a-uuid&page=-3&size=7');
    expect(screen.getByLabelText('Loyalty tier')).toHaveValue('all');
    expect(screen.getByLabelText('Sort')).toHaveValue('last_visit');
    expect(screen.getByLabelText('Category')).toHaveValue('');
  });

  it('commits the search to the URL after the debounce', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Search customers'), { target: { value: 'walk' } });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('q=walk'));
  });

  it('offers the export only with reports.export, like Orders', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: 'Export customers' })).not.toBeInTheDocument();
  });

  it('offers the export with reports.export', () => {
    perms.granted = [...perms.granted, 'reports.export'];
    renderPage();
    expect(screen.getByRole('button', { name: 'Export customers' })).toBeInTheDocument();
  });

  it('renders header, search, counter strip and rows', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /customers/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument();
    // Refonte List : les KPI tiles cèdent à la bande de compteurs — les
    // libellés vivent dans le strip, « Total customers » devient « Customers ».
    const strip = screen.getByTestId('customers-counters');
    expect(strip).toHaveTextContent(/customers/i);
    expect(strip).toHaveTextContent(/active this month/i);
    expect(strip).toHaveTextContent(/loyalty members/i);
    expect(strip).toHaveTextContent(/outstanding b2b/i);
    await waitFor(() => expect(screen.getByText('Bali Organic Store')).toBeInTheDocument());
    expect(screen.getByText('Walk-in Customer')).toBeInTheDocument();
  });

  it('shows + New Customer button and Categories link when permitted', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /new customer/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /categories/i })).toHaveAttribute(
      'href', '/backoffice/customers/categories',
    );
  });

  it('carries the navigation on a real link, not only on the row click', async () => {
    // Le clic-ligne du DataTable ne se prend ni au Tab ni à Entrée : la fiche
    // client était inatteignable au clavier depuis la liste (WCAG 2.1.1).
    renderPage();
    await waitFor(() => expect(screen.getByText('Bali Organic Store')).toBeInTheDocument());
    const link = screen.getByRole('link', { name: 'Bali Organic Store' });
    expect(link).toHaveAttribute('href', '/backoffice/customers/c1');
    expect(screen.getByRole('link', { name: 'Walk-in Customer' }))
      .toHaveAttribute('href', '/backoffice/customers/c2');
  });

  it('renders category chips for the retail and B2B customers', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Walk-in Customer')).toBeInTheDocument());
    // The chips live inside the table row — at least one match each must
    // appear (the filter dropdown also lists category names).
    expect(screen.getAllByText('General').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Wholesale').length).toBeGreaterThanOrEqual(1);
  });
});
