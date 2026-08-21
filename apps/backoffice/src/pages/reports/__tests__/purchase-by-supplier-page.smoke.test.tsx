// apps/backoffice/src/pages/reports/__tests__/purchase-by-supplier-page.smoke.test.tsx
// S40 Wave B2 — Smoke test: PurchaseBySupplierPage renders heading, supplier rows, CSV button.

//
// Lot F (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 et le DONUT devient une carte de ventilation à pistes : un anneau force à
// comparer des angles et réclame une légende pour dire quel arc est quel
// fournisseur. `CostDonut` n'avait plus d'autre consommateur et disparaît avec
// cette migration.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mutable flag: tests set this to true to inject an RPC error.
let injectRpcError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (fn === 'get_purchase_by_supplier_v1') {
        if (injectRpcError) {
          return Promise.resolve({ data: null, error: new Error('RPC error: permission denied') });
        }
        return Promise.resolve({
          data: {
            period: { start: '2026-05-13', end: '2026-06-12' },
            by_supplier: [
              {
                supplier_id:     's-1',
                supplier_name:   'Bali Flour',
                po_count:        4,
                total:           2_000_000,
                received_count:  3,
                cancelled_count: 1,
                avg_lead_days:   3.5,
                share_pct:       80.00,
              },
              {
                supplier_id:     's-2',
                supplier_name:   'Bali Dairy',
                po_count:        1,
                total:           500_000,
                received_count:  1,
                cancelled_count: 0,
                avg_lead_days:   null,
                share_pct:       20.00,
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

import PurchaseBySupplierPage from '@/pages/reports/PurchaseBySupplierPage.js';
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
      <MemoryRouter><PurchaseBySupplierPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// Audit Reports 2026-08-01, lot C / D3 — <ExportButtons> ne rend rien sans
// `reports.export`, et les pages a export maison desactivent leur bouton. Ce
// test verifie le CABLAGE de l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
});

async function loadedTable(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(within(screen.getByTestId('purchase-by-supplier-table')).getAllByRole('row').length)
      .toBeGreaterThan(1);
  });
  return screen.getByTestId('purchase-by-supplier-table');
}

describe('PurchaseBySupplierPage (smoke)', () => {
  it('renders heading, supplier rows, null avg_lead_days as em-dash and the server share', async () => {
    injectRpcError = false;
    renderPage();
    expect(screen.getByRole('heading', { name: /Purchase by Supplier/i, level: 1 })).toBeInTheDocument();
    const table = await loadedTable();
    expect(within(table).getByText('Bali Flour')).toBeInTheDocument();
    expect(within(table).getByText('Bali Dairy')).toBeInTheDocument();
    // Bali Flour porte 3,5 j — et le pied de table porte la même valeur, la
    // moyenne pondérée étant tirée par ce seul fournisseur mesuré. On cible donc
    // la LIGNE, pas le document.
    const flourRow = within(table).getAllByRole('row')
      .find((r) => r.textContent?.includes('Bali Flour'));
    expect(flourRow!.textContent).toMatch(/3\.5/);
    // Bali Dairy has avg_lead_days null — rendered as em-dash
    expect(within(table).getAllByText('—').length).toBeGreaterThanOrEqual(1);
    // La part vient du SERVEUR, 2 décimales.
    expect(within(table).getByText('80,00%')).toBeInTheDocument();
  });

  it('ventilates the spend by supplier instead of drawing a donut', async () => {
    injectRpcError = false;
    renderPage();
    const card = await screen.findByTestId('breakdown-purchase-suppliers');
    await waitFor(() => {
      expect(within(card).getByText('Bali Flour')).toBeInTheDocument();
    });
    expect(within(card).getByText('Total purchased')).toBeInTheDocument();
  });

  // Le délai moyen est pondéré par les commandes : (3,5×4) / 4 = 3,5 j — le
  // fournisseur sans délai mesuré ne tire pas la moyenne vers zéro.
  it('weights the average lead time by orders, and ignores the supplier without one', async () => {
    injectRpcError = false;
    renderPage();
    const tile = await screen.findByTestId('kpi-lead');
    expect(tile.textContent).toMatch(/3\.5 d/);
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
