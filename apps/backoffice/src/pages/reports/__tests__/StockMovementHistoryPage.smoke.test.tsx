// apps/backoffice/src/pages/reports/__tests__/StockMovementHistoryPage.smoke.test.tsx
// Fiche de stock : titre, appel RPC, colonnes humaines, ref_no + libellé de
// type générés, export CSV (pas de PDF — DEV-S30-4.X-01).
//
// Lot G (campagne Reports 2026-08-15) — la page passe sur le socle Report shell
// v2 : bandeau, contrôle de période et menu d'export unique. Le TABLEAU, lui,
// est `StockLedgerTable` — partagé avec la page Inventory, hors périmètre du
// lot : il garde son propre tri de colonne, déjà pourvu d'`aria-sort`.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import StockMovementHistoryPage from '@/pages/reports/StockMovementHistoryPage.js';
import { useAuthStore } from '@/stores/authStore.js';

const mockRpc = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args: Record<string, unknown>) => {
      mockRpc(fn, args);
      if (fn === 'get_stock_movement_ledger_v4') {
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
      if (fn === 'get_operational_products_v2') {
        return Promise.resolve({ data: PRODUCTS, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

// Catalogue opérationnel minimal : deux articles suivis, un non suivi. Le nom
// diffère de la ligne de mouvement (« Flour ») : l'option du filtre ne doit pas
// doubler le texte que les tests attendent dans la table.
const PRODUCTS = [
  { id: 'prod-1', sku: 'FL-1', name: 'Wheat flour', track_inventory: true, variant_label: null, categories: null },
  { id: 'prod-2', sku: 'BU-1', name: 'Butter', track_inventory: true,  variant_label: null, categories: null },
  { id: 'prod-3', sku: 'CB-1', name: 'Combo',  track_inventory: false, variant_label: null, categories: null },
];

function renderPage(search = '') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[`/backoffice/reports/stock-movement-history${search}`]}>
        <StockMovementHistoryPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function ledgerArgs(): { p_product_id: string | null; p_movement_type: string | null }[] {
  return mockRpc.mock.calls
    .filter(([fn]) => fn === 'get_stock_movement_ledger_v4')
    .map(([, args]) => args as { p_product_id: string | null; p_movement_type: string | null });
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

  it('calls get_stock_movement_ledger_v4 with a date range', async () => {
    renderPage();
    await waitFor(() => {
      const call = mockRpc.mock.calls.find(([fn]) => fn === 'get_stock_movement_ledger_v4');
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

  it('garde son filtre par type de mouvement, désormais sur la barre du socle', async () => {
    renderPage();
    await screen.findByText('Flour');
    const bar = screen.getByTestId('report-filter-bar');
    const type = within(bar).getByLabelText('Movement type');
    // Enum complet, `production` compris (absent de l'ancienne liste en dur).
    expect(within(type).getByRole('option', { name: 'production' })).toBeInTheDocument();
    fireEvent.change(type, { target: { value: 'waste' } });
    await waitFor(() => {
      expect(ledgerArgs().at(-1)?.p_movement_type).toBe('waste');
    });
  });

  it('S3-22 — lit l’article dans l’URL au montage et le passe en p_product_id', async () => {
    renderPage('?product_id=prod-2&movement_type=sale');
    await waitFor(() => {
      expect(ledgerArgs().at(-1)).toMatchObject({ p_product_id: 'prod-2', p_movement_type: 'sale' });
    });
    expect(await screen.findByRole('option', { name: 'Butter' })).toBeInTheDocument();
    expect(screen.getByLabelText('Item')).toHaveValue('prod-2');
  });

  it('S3-22 — ne propose que les articles suivis en stock', async () => {
    renderPage();
    const item = await screen.findByLabelText('Item');
    await within(item).findByRole('option', { name: 'Wheat flour' });
    expect(within(item).queryByRole('option', { name: 'Combo' })).toBeNull();
  });

  it('S3-22 — choisir un article l’envoie au serveur, « Clear filters » le retire', async () => {
    renderPage('?movement_type=purchase');
    const item = await screen.findByLabelText('Item');
    await within(item).findByRole('option', { name: 'Wheat flour' });
    fireEvent.change(item, { target: { value: 'prod-1' } });
    await waitFor(() => {
      expect(ledgerArgs().at(-1)).toMatchObject({ p_product_id: 'prod-1', p_movement_type: 'purchase' });
    });
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => {
      expect(ledgerArgs().at(-1)).toMatchObject({ p_product_id: null, p_movement_type: null });
    });
    expect(screen.queryByTestId('filters-clear')).toBeNull();
  });

  it('S3-22 — un article inconnu de la liste reste visible et retirable', async () => {
    renderPage('?product_id=prod-gone');
    const item = await screen.findByLabelText('Item');
    await within(item).findByRole('option', { name: 'Wheat flour' });
    expect(item).toHaveValue('prod-gone');
    expect(screen.getByTestId('filter-product_id-unknown')).toHaveTextContent('Unknown (not in list)');
    await waitFor(() => { expect(ledgerArgs().at(-1)?.p_product_id).toBe('prod-gone'); });
    fireEvent.click(screen.getByTestId('filters-clear'));
    await waitFor(() => { expect(ledgerArgs().at(-1)?.p_product_id).toBeNull(); });
    expect(screen.queryByTestId('filter-product_id-unknown')).toBeNull();
  });

  it('S3-22 — un type hors enum lu dans l’URL ne part pas au serveur', async () => {
    renderPage('?movement_type=bogus');
    await waitFor(() => { expect(ledgerArgs().length).toBeGreaterThan(0); });
    expect(ledgerArgs().every((a) => a.p_movement_type === null)).toBe(true);
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
