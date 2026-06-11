// apps/backoffice/src/pages/reports/__tests__/purchase-by-supplier-page.smoke.test.tsx
// S40 Wave B2 — Smoke test: PurchaseBySupplierPage renders heading, supplier rows, CSV button.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PurchaseBySupplierPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PurchaseBySupplierPage (smoke)', () => {
  it('renders heading, supplier rows, null avg_lead_days as em-dash, share %, and CSV button; no PDF', async () => {
    injectRpcError = false;
    renderPage();
    // Page heading
    expect(screen.getByRole('heading', { name: /Purchase by Supplier/i, level: 1 })).toBeInTheDocument();
    // Supplier rows
    expect(await screen.findByText('Bali Flour')).toBeInTheDocument();
    expect(screen.getByText('Bali Dairy')).toBeInTheDocument();
    // Bali Flour has avg_lead_days 3.5
    expect(screen.getByText('3.5')).toBeInTheDocument();
    // Bali Dairy has avg_lead_days null — rendered as em-dash
    expect(screen.getByText('—')).toBeInTheDocument();
    // share_pct with 2 decimals
    expect(screen.getByText('80.00%')).toBeInTheDocument();
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
