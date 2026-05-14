// apps/backoffice/src/__tests__/promotions-list.smoke.test.tsx
//
// Session 14 / Phase 5.B — smoke for the rebuilt PromotionsPage.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PromotionsPage from '@/pages/Promotions.js';

vi.mock('@/lib/supabase.js', () => {
  const promotions = [
    { id: 'p1', name: 'Spring 10%',  slug: 'spring-10', type: 'percentage',
      scope: null, priority: 50, is_active: true,  start_at: null, end_at: null,
      created_at: '2026-01-01T00:00:00Z' },
    { id: 'p2', name: 'BOGO Croissant', slug: 'bogo-croissant', type: 'bogo',
      scope: null, priority: 70, is_active: false, start_at: null, end_at: null,
      created_at: '2026-01-01T00:00:00Z' },
    { id: 'p3', name: 'Free coffee with cake', slug: 'free-coffee', type: 'free_product',
      scope: null, priority: 60, is_active: true,  start_at: null, end_at: null,
      created_at: '2026-01-01T00:00:00Z' },
  ];
  type Resolver = (v: unknown) => void;
  const builder: Record<string, unknown> = {
    select:  () => builder,
    is:      () => builder,
    eq:      () => builder,
    gte:     () => builder,
    lte:     () => builder,
    order:   () => builder,
    limit:   () => builder,
    range:   () => builder,
    in:      () => builder,
    or:      () => builder,
    then:    (resolve: Resolver) => resolve({ data: promotions, error: null }),
  };
  return {
    supabase: {
      from: () => builder,
      rpc:  () => Promise.resolve({ data: null, error: null }),
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({
      hasPermission: (p: string) =>
        ['promotions.read', 'promotions.create', 'promotions.update', 'promotions.delete'].includes(p),
    }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <PromotionsPage />
    </QueryClientProvider>,
  );
}

describe('PromotionsPage', () => {
  it('renders header, KPI tiles and table rows', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: /promotions/i, level: 1 })).toBeInTheDocument();
    expect(screen.getByText(/total promotions/i)).toBeInTheDocument();
    expect(screen.getByText(/active right now/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Spring 10%')).toBeInTheDocument());
    expect(screen.getByText('BOGO Croissant')).toBeInTheDocument();
  });

  it('shows + New promotion button when permitted', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: /new promotion/i })).toBeInTheDocument();
  });
});
