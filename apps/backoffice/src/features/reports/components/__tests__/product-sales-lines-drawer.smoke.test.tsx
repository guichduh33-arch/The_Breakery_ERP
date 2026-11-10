// apps/backoffice/src/features/reports/components/__tests__/product-sales-lines-drawer.smoke.test.tsx
//
// S3-21 — le tiroir des lignes de vente montre la création, le paiement et la
// table de la commande ; il trie côté client et exporte les lignes chargées,
// derrière le gate `reports.export`.

import type * as DomainModule from '@breakery/domain';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { downloadCsv } from '@breakery/domain';

vi.mock('@breakery/domain', async (original) => ({
  ...await original<typeof DomainModule>(), downloadCsv: vi.fn(),
}));

const LINES_DATA = {
  lines: [
    // Réglée, en salle.
    { id: 'l1', sold_at: '2026-06-30T09:15:00+08:00', created_at: '2026-06-30T08:40:00+08:00',
      paid_at: '2026-06-30T09:15:00+08:00', table_number: 'T-07',
      order_id: 'o9', order_number: '#0004', customer_id: null, customer_name: null,
      channel: 'counter', served_by_name: 'Mamat', name_snapshot: 'Croissant',
      quantity: 2, unit_price: 10_000, modifiers_total: 0, discount_amount: 0,
      discount_reason: null, line_total: 20_000 },
    // B2B non réglée, hors salle : paiement et table à tiret.
    { id: 'l2', sold_at: '2026-06-29T08:02:00+08:00', created_at: '2026-06-29T08:02:00+08:00',
      paid_at: null, table_number: null,
      order_id: 'o8', order_number: '#0011', customer_id: 'cu1', customer_name: 'Warung Sari',
      channel: 'b2b', served_by_name: 'Mamat', name_snapshot: 'Croissant',
      quantity: 10, unit_price: 9_000, modifiers_total: 0, discount_amount: 0,
      discount_reason: null, line_total: 90_000 },
  ],
  totals: { lines: 2, orders: 2, qty: 12, revenue: 110_000, discount: 0, counter_qty: 2, b2b_qty: 10 },
  next_cursor: null,
};

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string) => Promise.resolve(
      fn === 'get_product_sales_lines_v6'
        ? { data: LINES_DATA, error: null }
        : { data: null, error: null },
    ),
  },
}));

import { ProductSalesLinesDrawer } from '../ProductSalesLinesDrawer.js';
import { useAuthStore } from '@/stores/authStore.js';

function renderDrawer() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ProductSalesLinesDrawer
          product={{ id: 'p2', name: 'Croissant' }}
          start="2026-06-01"
          end="2026-06-30"
          onClose={() => { /* no-op */ }}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function orderNumbers(table: HTMLElement): string[] {
  return within(table).getAllByRole('link', { name: /#00/ }).map((a) => a.textContent ?? '');
}

beforeEach(() => {
  useAuthStore.setState({ permissions: ['reports.export'] });
  vi.mocked(downloadCsv).mockClear();
});

describe('ProductSalesLinesDrawer — created, paid, table', () => {
  it('shows Created, Paid and Table, with a dash when paid or table is missing', async () => {
    renderDrawer();
    const table = await screen.findByTestId('lines-table');
    for (const h of ['Sold at', 'Created', 'Paid', 'Table']) {
      expect(within(table).getByRole('columnheader', { name: new RegExp(`^${h}`) })).toBeInTheDocument();
    }
    const paid = within(screen.getByTestId('line-l1'));
    expect(paid.getByTestId('line-created')).toHaveTextContent(/30 Jun 2026, 08:40/);
    expect(paid.getByTestId('line-paid')).toHaveTextContent(/30 Jun 2026, 09:15/);
    expect(paid.getByTestId('line-table')).toHaveTextContent('T-07');
    const unpaid = within(screen.getByTestId('line-l2'));
    expect(unpaid.getByTestId('line-paid')).toHaveTextContent('—');
    expect(unpaid.getByTestId('line-table')).toHaveTextContent('—');
  });

  it('sorts client-side by column: asc, desc, then back to the server order', async () => {
    renderDrawer();
    const table = await screen.findByTestId('lines-table');
    expect(orderNumbers(table)).toEqual(['#0004', '#0011']);
    const btn = within(table).getByTestId('sort-line_total');
    fireEvent.click(btn);
    expect(orderNumbers(table)).toEqual(['#0004', '#0011']);
    expect(btn.closest('th')).toHaveAttribute('aria-sort', 'ascending');
    fireEvent.click(btn);
    expect(orderNumbers(table)).toEqual(['#0011', '#0004']);
    // Le paiement absent reste en bas dans les deux sens.
    fireEvent.click(within(table).getByTestId('sort-paid_at'));
    expect(orderNumbers(table)).toEqual(['#0004', '#0011']);
  });

  it('exports the loaded lines, in the displayed order, with the three fields', async () => {
    renderDrawer();
    const table = await screen.findByTestId('lines-table');
    fireEvent.click(within(table).getByTestId('sort-qty'));
    fireEvent.click(within(table).getByTestId('sort-qty'));   // desc : #0011 d'abord
    fireEvent.click(screen.getByTestId('lines-export-csv'));
    expect(downloadCsv).toHaveBeenCalledTimes(1);
    const [csv, filename] = vi.mocked(downloadCsv).mock.calls[0] as [string, string];
    expect(filename).toBe('product-sales-lines-2026-06-01_2026-06-30');
    const rows = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(rows[0]).toBe('Sold at,Created,Paid,Order #,Table,Customer,Channel,Sold as,Qty,Unit price,Discount,Line total');
    expect(rows[1]).toMatch(/^2026-06-29 08:02:00,2026-06-29 08:02:00,,#0011,,Warung Sari,B2B,/);
    expect(rows[2]).toMatch(/^2026-06-30 09:15:00,2026-06-30 08:40:00,2026-06-30 09:15:00,#0004,T-07,Walk-in,Counter,/);
  });

  it('disables the export without reports.export, and says why', async () => {
    useAuthStore.setState({ permissions: [] });
    renderDrawer();
    await screen.findByTestId('lines-table');
    const btn = screen.getByTestId('lines-export-csv');
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('title', 'Requires the reports.export permission.');
    fireEvent.click(btn);
    expect(downloadCsv).not.toHaveBeenCalled();
  });
});
