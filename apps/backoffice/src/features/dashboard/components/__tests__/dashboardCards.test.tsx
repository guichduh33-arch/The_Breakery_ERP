// apps/backoffice/src/features/dashboard/components/__tests__/dashboardCards.test.tsx
//
// Écran 1c — les règles de lecture des cartes, celles qui changent une décision :
// le seuil d'ancienneté d'une commande ouverte, le compteur vitrine à zéro, le
// sens du vert sur un coût, et le fait qu'un 42501 se rende « restreint » et
// non en erreur rouge.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { NeedsYouBar } from '../NeedsYouBar.js';
import { OpenOrdersCard } from '../OpenOrdersCard.js';
import { DisplayStockCard } from '../DisplayStockCard.js';
import { CostMtdCard } from '../CostMtdCard.js';
import type { ActionQueue, DisplayStockPanel, OpenOrdersPanel } from '../../hooks/useDashboardPanels.js';
import type { CostMtd } from '../../hooks/useDashboardOverview.js';

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(cleanup);

describe('NeedsYouBar', () => {
  const queue: ActionQueue = {
    items: [
      { key: 'register_not_closed', severity: 'blocking', count: 1, label: 'Register not closed — 5 Aug', action: 'Reconcile', to: '/backoffice/cash-register/zreports' },
      { key: 'low_stock', severity: 'warning', count: 3, label: '3 items below reorder point', action: 'Review', to: '/backoffice/inventory/alerts' },
    ],
    total: 4,
    generated_at: '2026-08-06T09:42:00Z',
  };

  it('links each item to the screen that resolves it', () => {
    wrap(<NeedsYouBar queue={queue} isLoading={false} />);
    expect(screen.getByTestId('needs-you-register_not_closed'))
      .toHaveAttribute('href', '/backoffice/cash-register/zreports');
    expect(screen.getByTestId('needs-you-low_stock'))
      .toHaveAttribute('href', '/backoffice/inventory/alerts');
  });

  it('shows the total count, not the number of rows', () => {
    // Une ligne peut agréger plusieurs faits (« 3 items ») : le compteur du
    // bandeau doit dire le NOMBRE DE FAITS, sinon il contredit la pastille de
    // la cloche, qui compte les faits.
    wrap(<NeedsYouBar queue={queue} isLoading={false} />);
    expect(screen.getByTestId('needs-you-bar')).toHaveTextContent('4');
  });

  it('renders nothing at all when the role has none of the source permissions', () => {
    const { container } = wrap(<NeedsYouBar queue={null} isLoading={false} isRestricted />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('OpenOrdersCard', () => {
  const panel: OpenOrdersPanel = {
    orders: [
      { id: 'o1', order_number: '#1043', order_type: 'take_out', destination: 'Take-away', total: 64_000, minutes_open: 6 },
      { id: 'o2', order_number: '#1046', order_type: 'delivery', destination: 'Delivery', total: 97_000, minutes_open: 34 },
      { id: 'o3', order_number: '#1047', order_type: 'dine_in', destination: 'Table 1', total: 241_000, minutes_open: 48 },
    ],
    open_count: 3,
    open_total: 402_000,
    over_45_count: 1,
    generated_at: '2026-08-06T09:42:00Z',
  };

  it('escalates the age colour at 30 and 45 minutes', () => {
    wrap(<OpenOrdersCard panel={panel} isLoading={false} isRestricted={false} error={null} />);
    expect(screen.getByText('6 min').className).toMatch(/text-text-muted/);
    expect(screen.getByText('34 min').className).toMatch(/text-warning/);
    expect(screen.getByText('48 min').className).toMatch(/text-danger/);
  });

  it('warns in the footer when an order has been open over 45 min', () => {
    wrap(<OpenOrdersCard panel={panel} isLoading={false} isRestricted={false} error={null} />);
    expect(screen.getByTestId('card-open-orders')).toHaveTextContent(/1 order open over 45 min/i);
  });

  it('says "restricted" rather than showing a red error on a 42501', () => {
    wrap(<OpenOrdersCard panel={null} isLoading={false} isRestricted error={null} />);
    expect(screen.getByTestId('card-open-orders')).toHaveTextContent(/Restricted/i);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('DisplayStockCard', () => {
  const panel: DisplayStockPanel = {
    rows: [
      { product_id: 'p1', product_name: 'Croissant beurre', sku: 'CRO-001', unit: 'pc', quantity: 18, min_threshold: 5, last_sold_at: null, minutes_since_sale: 2 },
      { product_id: 'p2', product_name: 'Sourdough 800 g', sku: 'BRD-021', unit: 'pc', quantity: 3, min_threshold: 5, last_sold_at: null, minutes_since_sale: 14 },
      { product_id: 'p3', product_name: 'Quiche lorraine', sku: 'SAV-005', unit: 'pc', quantity: 0, min_threshold: 5, last_sold_at: null, minutes_since_sale: 38 },
    ],
    empty_count: 1,
    generated_at: '2026-08-06T09:42:00Z',
  };

  it('marks a counter at zero as blocking and one below threshold as a warning', () => {
    wrap(<DisplayStockCard panel={panel} isLoading={false} isRestricted={false} error={null} />);
    expect(screen.getByText('0 pc').className).toMatch(/text-danger/);
    expect(screen.getByText('3 pc').className).toMatch(/text-warning/);
    expect(screen.getByText('18 pc').className).toMatch(/text-text-primary/);
  });

  it('says the POS blocks the sale when a counter is empty', () => {
    wrap(<DisplayStockCard panel={panel} isLoading={false} isRestricted={false} error={null} />);
    expect(screen.getByTestId('card-display-stock')).toHaveTextContent(/POS blocks the sale/i);
  });
});

describe('CostMtdCard', () => {
  const cost: CostMtd = {
    cogs_total: 71_200_000, opex_total: 46_800_000, sales_mtd: 209_000_000,
    cogs_pct_of_sales: 34.1, opex_pct_of_sales: 22.4,
    total: 118_000_000, cost_per_basket: 19_100,
    lines: [
      { account_code: '5100', account_name: 'Flour & grains', family: 'cogs', amount: 24_600_000, mom_delta_pct: -2.1 },
      { account_code: '5200', account_name: 'Dairy & butter', family: 'cogs', amount: 19_300_000, mom_delta_pct: 8.4 },
    ],
  };

  it('paints a RISING cost red and a falling one green', () => {
    // Sur un coût, monter est mauvais : sans l'inversion, la carte féliciterait
    // une dérive d'achat.
    wrap(<CostMtdCard cost={cost} isLoading={false} error={null} />);
    const rising = screen.getByText('8,4%').parentElement;
    const falling = screen.getByText('2,1%').parentElement;
    expect(rising?.className).toMatch(/text-danger/);
    expect(falling?.className).toMatch(/text-success/);
  });
});
