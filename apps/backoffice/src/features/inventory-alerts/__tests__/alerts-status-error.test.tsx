// apps/backoffice/src/features/inventory-alerts/__tests__/alerts-status-error.test.tsx
//
// Audit M4 — une requête en échec ne doit JAMAIS se lire comme « tout va bien ».
// Le compte de bas de stock tombe à zéro quand la requête échoue exactement
// comme quand tout est en ordre : la page doit distinguer les deux.
//
// 2026-08-08 — l'invariant a changé de porteur, pas de nature. Il vivait dans
// une tuile « Status » dont la valeur était une phrase (« All clear » /
// « Action needed » / « Unavailable ») ; il vit maintenant dans le sous-titre du
// bandeau. Les assertions suivent le nouveau texte, la garantie est la même.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider, type UseQueryResult } from '@tanstack/react-query';
import AlertsPage from '@/pages/inventory/AlertsPage.js';
import * as lowStockMod from '../hooks/useLowStock.js';
import type { LowStockRow } from '../hooks/useLowStock.js';

// ---- minimal mocks for child components that make their own queries ----

// LowStockTab, ReorderTab, ProductionAlertsTab each import hooks that call
// supabase. Mock the whole supabase client so those renders don't error.
vi.mock('@/lib/supabase.js', () => {
  const chain: Record<string, unknown> = {};
  const methods = ['select','eq','is','in','order','limit','neq','gt','lt','gte','lte','not','contains','filter','range'];
  for (const m of methods) chain[m] = () => Promise.resolve({ data: [], error: null });
  // Make every method chainable and terminal.
  for (const m of methods) {
    chain[m] = () => {
      const sub: Record<string, unknown> = {};
      for (const sm of methods) sub[sm] = () => Promise.resolve({ data: [], error: null });
      return sub;
    };
  }
  return {
    supabase: {
      from: () => chain,
      rpc: () => Promise.resolve({ data: [], error: null }),
    },
  };
});

// Mock authStore for components that read permissions.
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

// Le mock ne remplit que les trois champs que la page lit. Le cast est fait ICI
// une fois, sur un type nommé, plutôt que de rendre `any` à six appelants —
// `any` en retour propageait l'erreur de lint à chaque `mockReturnValue`.
type LowStockQuery = UseQueryResult<LowStockRow[], Error>;

function fakeQuery(
  overrides: Partial<{ data: LowStockRow[] | undefined; error: Error | null; isLoading: boolean }>,
): LowStockQuery {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    ...overrides,
  } as unknown as LowStockQuery;
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

const ALL_CLEAR = /nothing under threshold/i;
const UNAVAILABLE = /figures unavailable/i;

describe('AlertsPage — an errored query must not read as "all clear" (audit M4)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('says nothing is under threshold when data is empty and there is no error', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: [], error: null, isLoading: false }),
    );
    render(wrap(<AlertsPage />));
    expect(screen.getByText(ALL_CLEAR)).toBeInTheDocument();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it('reports the shortfall when there are low-stock items and no error', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({
        data: [{ product_id: 'p1', current_qty: 0, shortfall: 5 } as LowStockRow],
        error: null,
        isLoading: false,
      }),
    );
    render(wrap(<AlertsPage />));
    // Le compte, les produits à zéro et le déficit total — les trois faits que
    // le sous-titre porte, et qu'aucun onglet ne redit.
    expect(screen.getByText(/1 under threshold · 1 at zero · 5 units short/i)).toBeInTheDocument();
    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it('says the figures are unavailable (not "all clear") when the query errored with empty data', () => {
    // Le cœur de la régression M4 : le compte vaut zéro parce que la requête a
    // échoué, PAS parce que tout va bien.
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: undefined, error: new Error('boom'), isLoading: false }),
    );
    render(wrap(<AlertsPage />));

    expect(screen.queryByText(ALL_CLEAR)).toBeNull();
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
  });

  it('says the rest of the page still works when the query errored', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: undefined, error: new Error('network error'), isLoading: false }),
    );
    render(wrap(<AlertsPage />));
    // Un onglet en échec ne condamne pas les trois autres — la page le dit.
    expect(screen.getByText(/the rest of the page still works/i)).toBeInTheDocument();
  });

  it('does not claim unavailability when data loaded successfully (no false negatives)', () => {
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: [], error: null, isLoading: false }),
    );
    render(wrap(<AlertsPage />));
    expect(screen.queryByText(UNAVAILABLE)).toBeNull();
  });

  it('never shows a zero count on a tab — silence means nothing to see', () => {
    // Quatre « 0 » fabriquent quatre signaux là où il n'y en a aucun.
    vi.spyOn(lowStockMod, 'useLowStock').mockReturnValue(
      fakeQuery({ data: [], error: null, isLoading: false }),
    );
    render(wrap(<AlertsPage />));
    expect(screen.getByTestId('tab-low')).not.toHaveTextContent('0');
    expect(screen.getByTestId('tab-config')).not.toHaveTextContent('0');
  });
});
