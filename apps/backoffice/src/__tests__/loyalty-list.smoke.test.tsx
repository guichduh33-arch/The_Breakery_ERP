import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

    // Tier mapping is asserted per-row so a regression in tierFromLifetime
    // (e.g. wrong boundary) fails the smoke test instead of slipping through.
    // The badge wraps its label in its own <span>, so an exact-string match
    // resolves to the badge (not the row's name cell that contains "Bronze Bob").
    const bob   = screen.getByText('Bronze Bob').closest('tr')!;
    const sara  = screen.getByText('Silver Sara').closest('tr')!;
    const greta = screen.getByText('Gold Greta').closest('tr')!;
    expect(within(bob).getByText('Bronze')).toBeInTheDocument();
    expect(within(sara).getByText('Silver')).toBeInTheDocument();
    expect(within(greta).getByText('Gold')).toBeInTheDocument();
  });

  it('shows action buttons gated by permission', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Bronze Bob')).toBeInTheDocument());
    // The mocked authStore grants all required perms (see vi.mock above), so the
    // "New customer" entry must be visible. Regressions in the permission wiring
    // remove the trigger entirely → this test catches them.
    expect(screen.getByRole('button', { name: /new customer/i })).toBeInTheDocument();
  });
});
