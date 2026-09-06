// apps/backoffice/src/features/dashboard/components/__tests__/dashboardCards.test.tsx
//
// Écran 1c — les règles de lecture des cartes, celles qui changent une décision :
// le seuil d'ancienneté d'une commande ouverte, le compteur vitrine à zéro, le
// sens du vert sur un coût, et le fait qu'un 42501 se rende « restreint » et
// non en erreur rouge.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { OpenOrdersCard } from '../OpenOrdersCard.js';
import { DisplayStockCard } from '../DisplayStockCard.js';
import { CostMtdCard } from '../CostMtdCard.js';
import type { DisplayStockPanel, OpenOrdersPanel } from '../../hooks/useDashboardPanels.js';
import type { CostMtd } from '../../hooks/useDashboardOverview.js';

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(cleanup);

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
    expect(screen.getByText('6m').className).toMatch(/text-text-muted/);
    expect(screen.getByText('34m').className).toMatch(/text-warning/);
    expect(screen.getByText('48m').className).toMatch(/text-danger/);
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

  it('names the denominator window next to each ratio', () => {
    // Le P&L voisin mesure 28 jours. Deux ratios sans fenêtre se lisent comme
    // une contradiction alors qu'ils portent sur deux périodes différentes.
    wrap(<CostMtdCard cost={cost} isLoading={false} error={null} />);
    const card = screen.getByTestId('card-cost-mtd');
    expect(card).toHaveTextContent(/COGS · 34,1% of MTD sales/);
    expect(card).toHaveTextContent(/OpEx · 22,4% of MTD sales/);
  });

  it('stays silent while cost is below sales', () => {
    wrap(<CostMtdCard cost={cost} isLoading={false} error={null} />);
    expect(screen.queryByTestId('cost-mtd-reserve')).not.toBeInTheDocument();
  });

  it('keeps a ratio above 100% and states the reserve beside it', () => {
    // « OpEx · 1036,2% of MTD sales » est exact et se lit comme une panne. On
    // garde le chiffre — un mois déficitaire doit rester visible — et on dit
    // pourquoi il dépasse 100 %.
    const overrun: CostMtd = {
      ...cost,
      sales_mtd: 200_000, cogs_total: 223_700, opex_total: 2_072_400,
      total: 2_296_100, cogs_pct_of_sales: 111.9, opex_pct_of_sales: 1036.2,
    };
    wrap(<CostMtdCard cost={overrun} isLoading={false} error={null} />);
    const card = screen.getByTestId('card-cost-mtd');
    expect(card).toHaveTextContent(/OpEx · 1.036,2% of MTD sales/);
    expect(screen.getByTestId('cost-mtd-reserve')).toHaveTextContent(
      /exceeds month-to-date sales/i,
    );
  });
});
