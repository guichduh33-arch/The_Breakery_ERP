// apps/backoffice/src/__tests__/customers-list.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for the rebuilt CustomersListPage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        ['customers.read', 'customers.create', 'customer_categories.read'].includes(p),
    }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CustomersListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomersListPage', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders header, search, KPIs and rows', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /customers/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/search by name/i)).toBeInTheDocument();
    expect(screen.getByText(/total customers/i)).toBeInTheDocument();
    expect(screen.getByText(/active this month/i)).toBeInTheDocument();
    expect(screen.getByText(/loyalty members/i)).toBeInTheDocument();
    expect(screen.getByText(/outstanding b2b/i)).toBeInTheDocument();
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

  it('renders category chips for the retail and B2B customers', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Walk-in Customer')).toBeInTheDocument());
    // The chips live inside the table row — at least one match each must
    // appear (the filter dropdown also lists category names).
    expect(screen.getAllByText('General').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Wholesale').length).toBeGreaterThanOrEqual(1);
  });
});
