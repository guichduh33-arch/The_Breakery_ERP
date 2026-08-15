// apps/backoffice/src/pages/reports/__tests__/purchase-by-date-page.smoke.test.tsx
// S40 Wave B2 — Smoke test: PurchaseByDatePage renders heading, KPI cards, calls RPC, shows CSV.

//
// Lot F (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : bande de KPI comparée, et l'aire empilée devient des barres appariées
// courant/précédent (une aire interpole entre deux jours et donne à lire une
// valeur qui n'existe pas). Le partage reçu/en-attente n'est pas perdu — il vit
// dans deux tuiles et dans les deux colonnes de la table.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mutable flag: tests set this to true to inject an RPC error.
let injectRpcError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (fn === 'get_purchase_by_date_v1') {
        if (injectRpcError) {
          return Promise.resolve({ data: null, error: new Error('RPC error: permission denied') });
        }
        return Promise.resolve({
          data: {
            period:  { start: '2026-05-13', end: '2026-06-12' },
            summary: {
              po_count:       5,
              total:          2_500_000,
              received_count: 3,
              pending_count:  2,
            },
            by_day: [
              {
                date:           '2026-06-01',
                po_count:       2,
                total:          1_000_000,
                received_total:   500_000,
                pending_total:    500_000,
              },
              {
                date:           '2026-06-05',
                po_count:       3,
                total:          1_500_000,
                received_total: 1_500_000,
                pending_total:          0,
              },
            ],
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import PurchaseByDatePage from '@/pages/reports/PurchaseByDatePage.js';
import { useAuthStore } from '@/stores/authStore.js';

// recharts' ResponsiveContainer needs ResizeObserver, absent in jsdom.
class StubResizeObserver {
  observe()    { /* no-op */ }
  unobserve()  { /* no-op */ }
  disconnect() { /* no-op */ }
}
Object.defineProperty(globalThis, 'ResizeObserver', {
  configurable: true, writable: true, value: StubResizeObserver,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PurchaseByDatePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`, et les pages a export maison desactivent leur bouton. Ce
// test verifie le CABLAGE de l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
});

describe('PurchaseByDatePage (smoke)', () => {
  it('renders heading, the KPI band and the by_day rows', async () => {
    injectRpcError = false;
    renderPage();
    expect(screen.getByRole('heading', { name: /Purchase by Date/i, level: 1 })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId('kpi-total')).toBeInTheDocument();
    });
    expect(screen.getByTestId('kpi-po-count')).toBeInTheDocument();
    // Le partage reçu / en-attente survit à la disparition de l'aire empilée.
    expect(screen.getByTestId('kpi-received-value')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-pending-value')).toBeInTheDocument();

    const table = screen.getByTestId('purchase-by-date-table');
    expect(within(table).getByText('2026-06-01')).toBeInTheDocument();
    expect(within(table).getByText('2026-06-05')).toBeInTheDocument();
  });

  it('charts the daily value with the paired-bars component', async () => {
    injectRpcError = false;
    renderPage();
    expect(await screen.findByTestId('chart-purchase-by-day')).toBeInTheDocument();
  });

  it('offers a CSV export, and no PDF — no template is registered for this report', async () => {
    injectRpcError = false;
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces role="alert" error element when RPC fails', async () => {
    injectRpcError = true;
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('report-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('report-error').textContent).toMatch(/RPC error/i);
    injectRpcError = false;
  });
});
