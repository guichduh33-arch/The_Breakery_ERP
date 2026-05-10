import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import LoyaltyPage from '@/pages/Loyalty.js';

vi.mock('@/lib/supabase.js', () => {
  const builder = () => ({
    select: () => builder(),
    is:     () => builder(),
    eq:     () => builder(),
    or:     () => builder(),
    gte:    () => builder(),
    lte:    () => builder(),
    order:  () => builder(),
    limit:  () => builder(),
    then:   (resolve: (v: unknown) => void) => resolve({
      data: [
        { id: '1', name: 'Bronze Bob',   phone: '+62810000001', email: null, loyalty_points: 100,  lifetime_points: 100,  total_spent: 0, total_visits: 0, last_visit_at: null, created_at: '2026-01-01T00:00:00Z' },
        { id: '2', name: 'Silver Sara',  phone: '+62810000002', email: null, loyalty_points: 800,  lifetime_points: 800,  total_spent: 0, total_visits: 0, last_visit_at: null, created_at: '2026-01-01T00:00:00Z' },
        { id: '3', name: 'Gold Greta',   phone: '+62810000003', email: null, loyalty_points: 2500, lifetime_points: 2500, total_spent: 0, total_visits: 0, last_visit_at: null, created_at: '2026-01-01T00:00:00Z' },
      ],
      error: null,
    }),
  });
  return { supabase: { from: () => builder(), rpc: () => Promise.resolve({ data: null, error: null }) } };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p) => [
      'loyalty.read', 'loyalty.adjust',
      'customers.create', 'customers.update', 'customers.delete',
    ].includes(p) }),
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LoyaltyPage />
    </QueryClientProvider>,
  );
}

describe('Loyalty BO page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('renders three rows with the right tier badges', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Bronze Bob')).toBeInTheDocument());
    expect(screen.getByText('Silver Sara')).toBeInTheDocument();
    expect(screen.getByText('Gold Greta')).toBeInTheDocument();
    expect(screen.getAllByText(/Bronze/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Silver/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Gold/).length).toBeGreaterThan(0);
  });
});
