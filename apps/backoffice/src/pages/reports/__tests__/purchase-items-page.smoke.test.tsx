// apps/backoffice/src/pages/reports/__tests__/purchase-items-page.smoke.test.tsx
//
// S3-20 (2026-11-20) — la page lit l'agrégat PAR ARTICLE de
// `get_purchase_items_v2` (plus de plafond de 1 000 lignes ni de bannière de
// troncature), porte ses filtres dans l'URL jusqu'au serveur, et descend un
// article vers ses lignes d'achat paginées (`get_purchase_item_lines_v1`).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

let injectRpcError = false;
const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];

const ITEMS = {
  period:   { start: '2026-05-13', end: '2026-06-12' },
  previous: { start: '2026-04-12', end: '2026-05-12' },
  summary:  {
    line_count: 3, total_value: 500_000, po_count: 2, supplier_count: 2,
    product_count: 2, previous_total_value: 250_000,
  },
  items: [
    {
      product_id: 'p-1', product_name: 'All-Purpose Flour', sku: 'FLOUR-001',
      category_id: 'c-1', category_name: 'Flours', base_unit: 'kg', purchase_unit: null,
      base_quantity: 260, value: 300_000, share_pct: 60, avg_unit_cost: 1153.85,
      line_count: 2, po_count: 2, supplier_count: 1, last_order_date: '2026-06-05',
      last_received_date: '2026-06-06', previous_value: 250_000,
    },
    {
      product_id: 'p-2', product_name: 'Butter', sku: 'BTR-001',
      category_id: 'c-2', category_name: 'Dairy', base_unit: 'kg', purchase_unit: 'kg',
      base_quantity: 4, value: 200_000, share_pct: 40, avg_unit_cost: 50_000,
      line_count: 1, po_count: 1, supplier_count: 1, last_order_date: '2026-06-01',
      last_received_date: null, previous_value: 0,
    },
  ],
  trend: [
    { date: '2026-06-01', value: 200_000, previous_value: 0 },
    { date: '2026-06-05', value: 300_000, previous_value: 250_000 },
  ],
};

const LINES = {
  total_count: 2, limit: 50, offset: 0,
  lines: [
    {
      po_id: 'po-2', po_number: 'PO-2026-002', order_date: '2026-06-05', received_date: '2026-06-06',
      supplier_id: 's-1', supplier_name: 'Bali Flour', quantity: 10, unit: 'bag',
      received_quantity: 10, unit_cost: 25_000, subtotal: 250_000, status: 'received',
    },
    {
      po_id: 'po-1', po_number: 'PO-2026-001', order_date: '2026-06-01', received_date: null,
      supplier_id: 's-1', supplier_name: 'Bali Flour', quantity: 10, unit: 'kg',
      received_quantity: 0, unit_cost: 5_000, subtotal: 50_000, status: 'pending',
    },
  ],
};

vi.mock('@/lib/supabase.js', () => {
  // Chaîne PostgREST générique : toute méthode renvoie la chaîne, qui se
  // résout en liste vide (fournisseurs, catégories).
  const chain: Record<string, unknown> = {};
  const handler: ProxyHandler<Record<string, unknown>> = {
    get: (_t, prop) => {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => resolve({ data: [], error: null });
      }
      return () => proxy;
    },
  };
  const proxy: Record<string, unknown> = new Proxy(chain, handler);
  return {
    supabase: {
      rpc: (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        if (injectRpcError) return Promise.resolve({ data: null, error: new Error('RPC error: permission denied') });
        if (fn === 'get_purchase_items_v2') return Promise.resolve({ data: ITEMS, error: null });
        if (fn === 'get_purchase_item_lines_v1') return Promise.resolve({ data: LINES, error: null });
        return Promise.resolve({ data: null, error: null });
      },
      from: () => proxy,
    },
  };
});

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

function renderPage(url = '/backoffice/reports/purchase-items?start=2026-05-13&end=2026-06-12') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}><PurchaseItemsPage /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  injectRpcError = false;
  rpcCalls.length = 0;
  useAuthStore.setState({ permissions: ['reports.export'] });
});

async function loadedTable(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(within(screen.getByTestId('purchase-items-table')).getAllByRole('row').length).toBeGreaterThan(1);
  });
  return screen.getByTestId('purchase-items-table');
}

describe('PurchaseItemsPage — by article (S3-20)', () => {
  it('renders one row per article with the server total, and no truncation banner', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /Purchase Items/i, level: 1 })).toBeInTheDocument();
    const table = await loadedTable();
    expect(within(table).getByText('All-Purpose Flour')).toBeInTheDocument();
    expect(within(table).getByText('Butter')).toBeInTheDocument();
    expect(within(table).getAllByText('Rp 500.000').length).toBeGreaterThan(0);
    expect(screen.queryByText(/First 1000 lines/i)).toBeNull();
    expect(screen.queryByText('Units ordered')).toBeNull();
    expect(screen.getByTestId('kpi-suppliers')).toHaveTextContent('2');
  });

  it('says when an article was bought under several units', async () => {
    renderPage();
    const table = await loadedTable();
    expect(within(table).getByText('mixed units')).toBeInTheDocument();
  });

  it('states the real scope: confirmed orders, drafts and cancelled excluded', () => {
    renderPage();
    // Le sous-titre paraît aussi dans l'annonce live du ReportShell.
    expect(screen.getAllByText(/drafts and cancelled excluded/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/received purchase orders/i)).toBeNull();
  });

  it('sends the URL filters to the server', async () => {
    renderPage('/backoffice/reports/purchase-items?start=2026-05-13&end=2026-06-12&supplier_id=s-9&category_id=c-9&status=received&product_id=p-9');
    await waitFor(() => {
      expect(rpcCalls.some((c) => c.fn === 'get_purchase_items_v2')).toBe(true);
    });
    const call = rpcCalls.find((c) => c.fn === 'get_purchase_items_v2');
    expect(call?.args).toMatchObject({
      p_date_start: '2026-05-13', p_date_end: '2026-06-12',
      p_supplier_id: 's-9', p_category_id: 'c-9', p_status: 'received', p_product_id: 'p-9',
    });
  });

  it('ignores an unknown status in the URL', async () => {
    renderPage('/backoffice/reports/purchase-items?start=2026-05-13&end=2026-06-12&status=draft');
    await waitFor(() => {
      expect(rpcCalls.some((c) => c.fn === 'get_purchase_items_v2')).toBe(true);
    });
    expect(rpcCalls.find((c) => c.fn === 'get_purchase_items_v2')?.args).not.toHaveProperty('p_status');
  });

  it('opens the purchase lines of an article, paginated', async () => {
    renderPage();
    await loadedTable();
    fireEvent.click(screen.getByTestId('open-purchase-lines-p-1'));
    const drawer = await screen.findByTestId('purchase-item-lines-drawer');
    await waitFor(() => {
      expect(within(drawer).getByText('PO-2026-002')).toBeInTheDocument();
    });
    expect(rpcCalls.find((c) => c.fn === 'get_purchase_item_lines_v1')?.args).toMatchObject({
      p_product_id: 'p-1', p_limit: 50, p_offset: 0,
    });
    expect(within(drawer).getByTestId('purchase-lines-count')).toHaveTextContent('1–2 of 2 lines');
    expect(within(drawer).getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('offers a CSV export, and no PDF', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('export-menu')).not.toBeDisabled();
    });
    fireEvent.click(screen.getByTestId('export-menu'));
    expect(screen.getByTestId('export-csv')).toBeInTheDocument();
    expect(screen.queryByTestId('export-pdf')).toBeNull();
  });

  it('surfaces the error when the RPC fails', async () => {
    injectRpcError = true;
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('report-error')).toBeInTheDocument();
    });
    expect(screen.getByTestId('report-error').textContent).toMatch(/RPC error/i);
  });
});
