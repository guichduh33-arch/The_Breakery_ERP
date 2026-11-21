import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useLocation } from 'react-router-dom';
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

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.search}</output>;
}

function renderPage(url = '/backoffice/loyalty') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <LoyaltyPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Loyalty BO page', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('opens on the Sales breadcrumb and a counter strip without icon tiles', () => {
    renderPage();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent('Sales');
    expect(crumbs).toHaveTextContent('Loyalty');
    expect(screen.getByRole('group', { name: 'Loyalty tier filters' })).toBeInTheDocument();
  });

  it('keeps the tier in the URL and ignores an unknown value', () => {
    renderPage('/backoffice/loyalty?tier=gold');
    expect(screen.getByLabelText('Tier filter')).toHaveValue('gold');
    fireEvent.click(screen.getByTestId('counter-silver'));
    expect(screen.getByTestId('location')).toHaveTextContent('?tier=silver');
    fireEvent.click(screen.getByTestId('counter-all'));
    expect(screen.getByTestId('location')).toHaveTextContent(/^$/);
  });

  it('falls back to all tiers for an unknown URL value', () => {
    renderPage('/backoffice/loyalty?tier=diamond');
    expect(screen.getByLabelText('Tier filter')).toHaveValue('all');
    expect(screen.getByTestId('counter-all')).toHaveAttribute('aria-pressed', 'true');
  });

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

  it('donne un anneau de focus VIVANT à la cellule du nom', async () => {
    // `focus-visible:ring-accent-primary` ne résolvait à aucune couleur du
    // preset : la cellule était atteignable au clavier et sans indicateur
    // (WCAG 2.4.7). L'anneau maison est la seule forme admise.
    renderPage();
    await waitFor(() => expect(screen.getByText('Bronze Bob')).toBeInTheDocument());
    const cell = screen.getByRole('button', { name: /view loyalty history for Bronze Bob/i });
    expect(cell.className).toContain('focus-visible:outline-gold');
    expect(cell.className).not.toContain('accent-primary');
  });

  it('shows action buttons gated by permission', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Bronze Bob')).toBeInTheDocument());
    // The mocked authStore grants all required perms (see vi.mock above), so the
    // "New member" entry must be visible. Regressions in the permission wiring
    // remove the trigger entirely → this test catches them.
    expect(screen.getByRole('button', { name: /new member/i })).toBeInTheDocument();
  });

  it('ouvre le menu partagé : vrai menu clavier, hors du tableau, fermé par Échap', async () => {
    // Audit Sales 2026-11-21 : le panneau local, rendu DANS la cellule, était
    // rogné par le conteneur du tableau sur les dernières lignes et ne se
    // fermait ni par Échap ni au clic extérieur. La page prend désormais le
    // menu partagé (RowActionsMenu), qui implémente le patron APG complet.
    renderPage();
    await waitFor(() => expect(screen.getByText('Bronze Bob')).toBeInTheDocument());

    const trigger = screen.getByRole('button', { name: 'Actions for Bronze Bob' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);
    const menu = screen.getByRole('menu', { name: 'Actions for Bronze Bob' });
    // Le panneau vit hors du tableau : aucun conteneur ne peut le rogner.
    expect(menu.closest('table')).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: 'View history' })).toHaveFocus();
    expect(within(menu).getByRole('menuitem', { name: 'Adjust points' })).toBeInTheDocument();
    expect(within(menu).getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument();

    fireEvent.keyDown(menu, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(trigger).toHaveFocus();
  });
});
