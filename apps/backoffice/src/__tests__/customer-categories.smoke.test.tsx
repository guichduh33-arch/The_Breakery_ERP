// apps/backoffice/src/__tests__/customer-categories.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for the read-only Customer Categories page.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CustomerCategoriesPage from '@/pages/customers/CustomerCategoriesPage.js';

vi.mock('@/lib/supabase.js', () => {
  const cats = [
    { id: 'c1', name: 'General',   slug: 'general',   color: null, icon: null,
      price_modifier_type: 'retail',              discount_percentage: 0,
      loyalty_enabled: true,  points_multiplier: 1, is_default: true,  is_active: true },
    { id: 'c2', name: 'Wholesale', slug: 'wholesale', color: null, icon: null,
      price_modifier_type: 'wholesale',           discount_percentage: 0,
      loyalty_enabled: false, points_multiplier: 1, is_default: false, is_active: true },
    { id: 'c3', name: 'VIP',       slug: 'vip',       color: null, icon: null,
      price_modifier_type: 'discount_percentage', discount_percentage: 15,
      loyalty_enabled: true,  points_multiplier: 1, is_default: false, is_active: true },
  ];
  type Resolver = (v: unknown) => void;
  const builder: Record<string, unknown> = {
    select: () => builder,
    is:     () => builder,
    order:  () => builder,
    then:   (resolve: Resolver) => resolve({ data: cats, error: null }),
  };
  return { supabase: { from: () => builder } };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => p === 'customer_categories.read' }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <CustomerCategoriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('CustomerCategoriesPage', () => {
  it('renders title and three category cards', async () => {
    renderPage();
    expect(await screen.findByText(/customer categories/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('General')).toBeInTheDocument());
    expect(screen.getByText('Wholesale')).toBeInTheDocument();
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText(/15% discount/i)).toBeInTheDocument();
  });

  it('renders New Category button as disabled (RPC missing)', async () => {
    renderPage();
    const btn = await screen.findByRole('button', { name: /new category/i });
    expect(btn).toBeDisabled();
  });
});
