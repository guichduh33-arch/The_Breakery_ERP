// apps/backoffice/src/pages/reports/__tests__/purchase-by-date-page.smoke.test.tsx
// S40 Wave B2 — Smoke test: PurchaseByDatePage renders heading, KPI cards, calls RPC, shows CSV.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><PurchaseByDatePage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('PurchaseByDatePage (smoke)', () => {
  it('renders heading, KPI cards, by_day rows, and CSV button; no PDF button', async () => {
    injectRpcError = false;
    renderPage();
    // Page heading
    expect(screen.getByRole('heading', { name: /Purchase by Date/i, level: 1 })).toBeInTheDocument();
    // KPI card labels
    await waitFor(() => {
      expect(screen.getByText('PO count')).toBeInTheDocument();
      // "Total" appears in KPI card and table header — confirm at least one exists
      expect(screen.getAllByText('Total').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('Received')).toBeInTheDocument();
      expect(screen.getByText('Pending')).toBeInTheDocument();
    });
    // by_day rows
    expect(screen.getByText('2026-06-01')).toBeInTheDocument();
    expect(screen.getByText('2026-06-05')).toBeInTheDocument();
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
