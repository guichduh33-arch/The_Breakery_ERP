// apps/backoffice/src/pages/reports/__tests__/purchase-items-page.smoke.test.tsx
// S40 Wave B2 — Smoke test: PurchaseItemsPage renders heading, calls RPC, shows CSV button.

//
// Lot F (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : le graphe en barres horizontales cède la place à une carte de
// ventilation (un classement de valeurs étiquetées n'a pas besoin d'un axe), et
// l'export passe par le menu unique du bandeau.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// Mutable flag: tests set this to true to inject an RPC error.
let injectRpcError = false;

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => {
      if (fn === 'get_purchase_items_v1') {
        if (injectRpcError) {
          return Promise.resolve({ data: null, error: new Error('RPC error: permission denied') });
        }
        return Promise.resolve({
          data: {
            period:  { start: '2026-05-13', end: '2026-06-12' },
            summary: { line_count: 2, total_value: 500_000 },
            lines: [
              {
                po_id:             'po-1',
                po_number:         'PO-2026-001',
                order_date:        '2026-06-01',
                supplier_name:     'Bali Flour',
                product_id:        'p-1',
                product_name:      'All-Purpose Flour',
                sku:               'FLOUR-001',
                quantity:          10,
                received_quantity: 10,
                unit_cost:         25_000,
                subtotal:          250_000,
                status:            'received',
              },
              {
                po_id:             'po-2',
                po_number:         'PO-2026-002',
                order_date:        '2026-06-05',
                supplier_name:     'Bali Dairy',
                product_id:        'p-2',
                product_name:      'Butter',
                sku:               'BTR-001',
                quantity:          5,
                received_quantity: 5,
                unit_cost:         50_000,
                subtotal:          250_000,
                status:            'received',
              },
            ],
            truncated: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
    // Supplier options via .from('suppliers')
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

import PurchaseItemsPage from '@/pages/reports/PurchaseItemsPage.js';
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
      <MemoryRouter><PurchaseItemsPage /></MemoryRouter>
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
    expect(within(screen.getByTestId('purchase-items-table')).getAllByRole('row').length)
      .toBeGreaterThan(1);
  });
  return screen.getByTestId('purchase-items-table');
}

describe('PurchaseItemsPage (smoke)', () => {
  it('renders heading, line rows and the summary footer', async () => {
    injectRpcError = false;
    renderPage();
    expect(screen.getByRole('heading', { name: /Purchase Items/i, level: 1 })).toBeInTheDocument();
    const table = await loadedTable();
    // Les noms paraissent AUSSI dans la carte de ventilation : on porte
    // l'assertion sur la table.
    expect(within(table).getByText('All-Purpose Flour')).toBeInTheDocument();
    expect(within(table).getByText('Butter')).toBeInTheDocument();
    expect(within(table).getByText(/2 lines/i)).toBeInTheDocument();
  });

  it('ventilates the top products instead of drawing a bar axis', async () => {
    injectRpcError = false;
    renderPage();
    const card = await screen.findByTestId('breakdown-purchase-products');
    await waitFor(() => {
      expect(within(card).getByText('All-Purpose Flour')).toBeInTheDocument();
    });
    expect(within(card).getByText('Total purchased')).toBeInTheDocument();
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
