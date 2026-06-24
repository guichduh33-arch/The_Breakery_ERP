// apps/backoffice/src/pages/reports/__tests__/purchase-items-page.smoke.test.tsx
// S40 Wave B2 — Smoke test: PurchaseItemsPage renders heading, calls RPC, shows CSV button.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

describe('PurchaseItemsPage (smoke)', () => {
  it('renders heading, product rows, total, and CSV export button; no PDF button', async () => {
    injectRpcError = false;
    renderPage();
    // Page heading
    expect(screen.getByRole('heading', { name: /Purchase Items/i, level: 1 })).toBeInTheDocument();
    // Product rows
    expect(await screen.findByText('All-Purpose Flour')).toBeInTheDocument();
    expect(screen.getByText('Butter')).toBeInTheDocument();
    // Summary footer shows line count
    expect(screen.getByText(/2 lines/i)).toBeInTheDocument();
    // CSV export button (no PDF for purchase reports)
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces role="alert" error element when RPC fails', async () => {
    injectRpcError = true;
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(screen.getByRole('alert').textContent).toMatch(/RPC error/i);
    injectRpcError = false;
  });
});
