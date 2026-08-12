// apps/backoffice/src/pages/btob/__tests__/B2BOrdersPage.smoke.test.tsx
//
// Archétype LIST + détail dépliable. Ce que ces tests tiennent :
//   · une ligne par commande, la plus récente en premier ;
//   · le détail ne se charge QU'à l'ouverture — sinon afficher cinquante
//     commandes lancerait cinquante requêtes pour rien ;
//   · une ligne annulée reste visible dans le détail, barrée et à zéro.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

const itemsSpy = vi.fn();

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'order_items') return itemsSpy(table) as unknown;
      // view_b2b_invoices — la liste elle-même.
      const chain = {
        select: () => chain,
        order:  () => chain,
        limit:  () => chain,
        eq:     () => chain,
        gt:     () => chain,
        then: (cb: (v: { data: unknown[]; error: null }) => unknown) =>
          Promise.resolve({ data: INVOICES, error: null }).then(cb),
      };
      return chain;
    },
    rpc: vi.fn(),
  },
}));

const INVOICES = [
  {
    invoice_id: 'o-old', order_number: 'B2B-0001', invoice_number: null,
    customer_id: 'c1', b2b_company_name: 'Hotel Senggigi', customer_name: null,
    invoice_total: 1_200_000, invoice_date: '2026-08-01T08:00:00Z', paid_at: null,
    order_status: 'completed', age_days: 7, is_unpaid: true,
    amount_paid: 0, outstanding: 1_200_000, pickup_date: '2026-08-09',
  },
  {
    invoice_id: 'o-new', order_number: 'B2B-0002', invoice_number: 'INV/2026/2',
    customer_id: 'c2', b2b_company_name: null, customer_name: 'Warung Ayu',
    invoice_total: 450_000, invoice_date: '2026-08-06T08:00:00Z', paid_at: '2026-08-07T08:00:00Z',
    order_status: 'completed', age_days: 2, is_unpaid: false,
    amount_paid: 450_000, outstanding: 0, pickup_date: null,
  },
];

const ITEMS = [
  { id: 'i1', name_snapshot: 'Baguette tradition', quantity: 40, unit_price: 25_000, line_total: 1_000_000, is_cancelled: false },
  { id: 'i2', name_snapshot: 'Croissant beurre',   quantity: 10, unit_price: 20_000, line_total: 200_000,   is_cancelled: false },
  { id: 'i3', name_snapshot: 'Pain de mie',        quantity: 5,  unit_price: 30_000, line_total: 150_000,   is_cancelled: true },
];

import B2BOrdersPage from '../B2BOrdersPage.js';

function wrap(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>
  );
}

describe('B2BOrdersPage', () => {
  beforeEach(() => {
    itemsSpy.mockReset();
    const chain = {
      select: () => chain,
      eq:     () => chain,
      order:  () => Promise.resolve({ data: ITEMS, error: null }),
    };
    itemsSpy.mockReturnValue(chain);
  });

  it('lists one row per order, most recent first', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0002')).toBeInTheDocument());
    const numbers = screen.getAllByText(/^B2B-000\d$/).map((n) => n.textContent);
    expect(numbers).toEqual(['B2B-0002', 'B2B-0001']);
  });

  it('does not load any order line until a row is opened', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(itemsSpy).not.toHaveBeenCalled();
  });

  it('opens the order onto its lines, keeping a cancelled line visible at zero', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());

    fireEvent.click(screen.getByText('B2B-0001'));

    await waitFor(() => expect(screen.getByTestId('b2b-items-panel')).toBeInTheDocument());
    expect(itemsSpy).toHaveBeenCalledWith('order_items');
    expect(screen.getByText('Baguette tradition')).toBeInTheDocument();

    // La ligne annulée reste — la faire disparaître donnerait une somme qui ne
    // retombe pas sur le total, et laisserait croire qu'elle n'a pas existé.
    const cancelled = screen.getByText('Pain de mie');
    expect(cancelled).toBeInTheDocument();
    expect(cancelled.className).toMatch(/line-through/);
  });

  it('marks an order with an outstanding balance as unpaid', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByText('unpaid')).toBeInTheDocument();
  });

  it('lot 3 — breadcrumb, badge de statut unifié et action de création dans le bandeau', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByLabelText('Breadcrumb')).toHaveTextContent('Orders');
    // Le badge vient de statusMeta : libellé humain, plus la valeur brute.
    expect(screen.getAllByText('Completed').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText('completed')).not.toBeInTheDocument();
    // D3 acté : la liste porte l'action de création (désactivée sans la gate).
    expect(screen.getByRole('button', { name: /new b2b order/i })).toBeInTheDocument();
  });

  it('shows the pickup day, and says so when none was agreed', async () => {
    // La colonne est ouverte mais sa saisie n'est pas branchee : « not set » est
    // l'etat NORMAL aujourd'hui, pas une erreur. Il doit se lire comme tel.
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0001')).toBeInTheDocument());
    expect(screen.getByText('2026-08-09')).toBeInTheDocument();
    expect(screen.getByText('not set')).toBeInTheDocument();
  });

  it('filters to unpaid orders from the counter strip', async () => {
    render(wrap(<B2BOrdersPage />));
    await waitFor(() => expect(screen.getByText('B2B-0002')).toBeInTheDocument());

    fireEvent.click(screen.getByTestId('counter-unpaid'));

    await waitFor(() => expect(screen.queryByText('B2B-0002')).not.toBeInTheDocument());
    expect(screen.getByText('B2B-0001')).toBeInTheDocument();
  });
});
