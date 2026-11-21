// apps/backoffice/src/pages/orders/__tests__/OutstandingOrdersPage.test.tsx
//
// Audit Sales 2026-11-21 — la recherche et la page des tickets impayés vivent
// dans l'URL (`q`, `page` en base 1), et la page ouvre sur « Sales › POS
// Outstanding ». Le panneau partagé est remplacé par un témoin : il a ses
// propres tests dans `@breakery/ui`, on ne vérifie ici que ce que la page lui
// transmet et ce qu'elle écrit dans l'URL.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const rpc = vi.hoisted(() => vi.fn());

vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

vi.mock('@/stores/authStore.js', () => {
  const state = {
    user: { id: 'u-1' },
    sessionToken: 'tok',
    isAuthenticated: true,
    isLoading: false,
    hasPermission: () => true,
  };
  const useAuthStore = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state },
  );
  return { useAuthStore };
});

vi.mock('@breakery/ui', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  OutstandingOrdersPanel: (p: {
    search: string; page: number;
    onSearch: (v: string) => void; onPage: (n: number) => void;
  }) => (
    <div>
      <output data-testid="panel-search">{p.search}</output>
      <output data-testid="panel-page">{p.page}</output>
      <button type="button" onClick={() => p.onSearch('kuta')}>search</button>
      <button type="button" onClick={() => p.onPage(p.page + 1)}>next</button>
    </div>
  ),
}));

import OutstandingOrdersPage from '../OutstandingOrdersPage.js';

function LocationProbe() {
  const loc = useLocation();
  return <output data-testid="location">{loc.search}</output>;
}

function renderPage(url = '/backoffice/orders/outstanding') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <OutstandingOrdersPage />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('OutstandingOrdersPage', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: [], error: null });
  });

  it('opens on the Sales breadcrumb', () => {
    renderPage();
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(crumbs).toHaveTextContent('Sales');
    expect(crumbs).toHaveTextContent('POS Outstanding');
  });

  it('restores search and page from the URL and queries with them', async () => {
    renderPage('/backoffice/orders/outstanding?q=bali&page=3');
    expect(screen.getByTestId('panel-search')).toHaveTextContent('bali');
    expect(screen.getByTestId('panel-page')).toHaveTextContent('2');
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('list_pos_outstanding_v1',
      { p_search: 'bali', p_offset: 100, p_limit: 50 }));
  });

  it('writes the search to the URL and returns to the first page', () => {
    renderPage('/backoffice/orders/outstanding?page=2');
    fireEvent.click(screen.getByRole('button', { name: 'search' }));
    expect(screen.getByTestId('location')).toHaveTextContent('?q=kuta');
    fireEvent.click(screen.getByRole('button', { name: 'next' }));
    expect(screen.getByTestId('location').textContent).toContain('page=2');
  });

  it('ignores an unreadable page value', () => {
    renderPage('/backoffice/orders/outstanding?page=abc');
    expect(screen.getByTestId('panel-page')).toHaveTextContent('0');
  });
});
