// apps/backoffice/src/pages/reports/__tests__/StockMovementHistoryPage.smoke.test.tsx
// Fiche de stock : titre, appel RPC, colonnes humaines, ref_no + libellé de
// type générés, export CSV (pas de PDF — DEV-S30-4.X-01).
//
// Lot G (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : bandeau, contrôle de période et menu d'export unique. Le TABLEAU, lui,
// est `StockLedgerTable` — partagé avec la page Inventory, hors périmètre du
// lot : il garde son propre tri de colonne, déjà pourvu d'`aria-sort`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StockMovementHistoryPage from '@/pages/reports/StockMovementHistoryPage.js';
import { useAuthStore } from '@/stores/authStore.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_stock_movement_ledger_v1') {
        return Promise.resolve({
          data: {
            lines: [
              {
                id: 'sm-1',
                movement_date:   '2026-05-20',
                created_time:    '2026-05-20T08:00:00Z',
                movement_type:   'incoming',
                product_id:      'prod-1',
                product_name:    'Flour',
                product_group:   'Ingredient',
                unit:            'kg',
                incoming_qty:    100,
                outgoing_qty:    0,
                beginning_qty:   0,
                balance_qty:     100,
                price:           5000,
                movement_amount: 500_000,
                reference_type:  'admin_action',
                reference_id:    null,
                reason:          null,
                reference_label: null,
                created_by_name: 'Admin',
              },
            ],
            truncated: false,
            row_count: 1,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><StockMovementHistoryPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

// L'export est gouverné par `reports.export`. Ce test vérifie le CÂBLAGE de
// l'export, pas le RBAC : on seede la permission.
beforeEach(() => {
  sessionStorage.clear();
  useAuthStore.setState({ permissions: ['reports.export'] });
});

describe('StockMovementHistoryPage (smoke)', () => {
  beforeEach(() => { mockRpc.mockReset(); });

  it('renders the page heading', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Stock Movement History/i, level: 1 })).toBeInTheDocument();
  });

  it('calls get_stock_movement_ledger_v1 with a date range', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_movement_ledger_v1');
      expect(call).toBeDefined();
      const args = (call as [string, { p_start: string; p_end: string }])[1];
      expect(args.p_start).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(args.p_end).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  it('renders the 10 slim stock-card columns', async () => {
    renderPage();
    await screen.findByText('Flour');
    // Human headers, not the ledger field names (design audit 2026-08-04).
    for (const h of ['Date', 'Type', 'Product', 'Unit',
      'Opening', 'In', 'Out', 'Balance', 'Price', 'Amount']) {
      expect(screen.getByRole('columnheader', { name: h })).toBeInTheDocument();
    }
    // The raw field names must not leak back into the header row.
    expect(screen.queryByRole('columnheader', { name: 'beginning_qty' })).toBeNull();
    // Detail-only fields are NOT top-level columns anymore.
    expect(screen.queryByRole('columnheader', { name: 'created_time' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'ref_no' })).toBeNull();
    expect(screen.queryByRole('columnheader', { name: 'product_group' })).toBeNull();
  });

  it('renders the type label in the main row and ref_no only after expanding', async () => {
    renderPage();
    expect(await screen.findByText('Flour')).toBeInTheDocument();
    expect(screen.getByText('INCOMING')).toBeInTheDocument();          // type label, main row
    expect(screen.queryByText('IN26052000000001')).toBeNull();          // ref_no hidden until expanded
    fireEvent.click(screen.getByRole('button', { name: /Expand movement detail/i }));
    expect(screen.getByText('IN26052000000001')).toBeInTheDocument();   // incoming → IN prefix
    expect(screen.getByText('Stock in')).toBeInTheDocument();           // origin label
  });

  it('offers a CSV export through the toolbar menu, but NOT a PDF', async () => {
    renderPage();
    await waitFor(() => { expect(screen.getByTestId('export-menu')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('garde son filtre par type de mouvement dans le bandeau', async () => {
    renderPage();
    await screen.findByText('Flour');
    expect(screen.getByLabelText('Filter by movement type')).toBeInTheDocument();
  });

  it('le tri de colonne du tableau partagé reste en place (aria-sort)', async () => {
    renderPage();
    await screen.findByText('Flour');
    const header = screen.getByRole('columnheader', { name: 'Product' });
    expect(header).toHaveAttribute('aria-sort', 'none');
    fireEvent.click(screen.getByRole('button', { name: 'Product' }));
    expect(screen.getByRole('columnheader', { name: 'Product' })).toHaveAttribute('aria-sort', 'ascending');
  });
});
