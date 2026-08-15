// apps/backoffice/src/features/reports/__tests__/SalesByHourPage.smoke.test.tsx
//
// Smoke au niveau RPC : la page rend son titre et interroge
// `get_sales_by_hour_v3` sur le BON jour.
//
// Lot D (campagne Reports 2026-08-15) — deux propriétés ajoutées, qui tiennent
// la migration sur la période unifiée :
//
//  · le rapport est horaire, donc il lit UN jour : la borne haute de la fenêtre
//    (`end`), et la veille pour la comparaison ;
//  · l'ancien paramètre `?date=` est lu en REPLI — un lien copié avant
//    l'unification doit continuer d'ouvrir la même journée.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import SalesByHourPage from '@/pages/reports/SalesByHourPage.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_sales_by_hour_v3') {
        // 24-bucket zero-filled response shape
        const data = Array.from({ length: 24 }, (_, hour) => ({
          hour,
          total:       hour === 8 ? 12_345 : 0,
          order_count: hour === 8 ? 3      : 0,
        }));
        return Promise.resolve({ data, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

// Recharts uses ResizeObserver under the hood; jsdom doesn't ship it.
class StubResizeObserver {
  observe()   { /* no-op */ }
  unobserve() { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true,
  writable: true,
  value: StubResizeObserver,
});

function renderPage(search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/sales-by-hour${search}`]}>
        <SalesByHourPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function datesQueried(): string[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_sales_by_hour_v3')
    .map(([, args]) => (args as { p_date: string }).p_date);
}

describe('SalesByHourPage (smoke)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    sessionStorage.clear();
  });

  it('renders the heading and queries get_sales_by_hour_v3 with a YYYY-MM-DD day', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Sales by Hour', level: 1 })).toBeInTheDocument();

    await waitFor(() => {
      expect(datesQueried().length).toBeGreaterThan(0);
    });
    for (const d of datesQueried()) expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('lit la borne haute de la fenêtre, et la VEILLE pour la comparaison', async () => {
    renderPage('?start=2026-06-01&end=2026-06-07');
    await waitFor(() => {
      expect(datesQueried()).toContain('2026-06-07');
    });
    // La comparaison d'un rapport horaire est le jour précédent, pas la fenêtre
    // précédente : `previousPeriod('2026-06-07','2026-06-07')` → 2026-06-06.
    expect(datesQueried()).toContain('2026-06-06');
    // Et jamais le premier jour de la fenêtre : agréger 7 jours d'heures ne
    // voudrait rien dire.
    expect(datesQueried()).not.toContain('2026-06-01');
  });

  it('repli sur l’ancien paramètre `date` — un lien copié ouvre le même jour', async () => {
    renderPage('?date=2026-05-20');
    await waitFor(() => {
      expect(datesQueried()).toContain('2026-05-20');
    });
    expect(datesQueried()).toContain('2026-05-19');
  });
});
