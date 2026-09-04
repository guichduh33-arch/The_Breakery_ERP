// apps/backoffice/src/features/dashboard/components/__tests__/dashboardKpiStrip.test.tsx
//
// Écran 1c — la bande KPI et les DEUX états où une comparaison n'a pas d'objet.
//
//  · La journée n'a pas commencé (couvert par `hasNoSalesYetToday`).
//  · La journée a vendu, mais la période COMPARÉE était vide. Le RPC répond
//    alors `null` sur les six comparaisons du créneau et la bande alignait six
//    tirets — indiscernables d'une panne. Une mention les remplace.
//
// Le test porte sur ce que le lecteur VOIT : la présence ou l'absence des
// libellés de période (« yest », « D-7 ») et la phrase qui les remplace.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import { DashboardKpiStrip } from '../DashboardKpiStrip.js';
import type { DashboardKpis } from '../../hooks/useDashboardOverview.js';

function wrap(ui: React.ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

afterEach(cleanup);

/** Journée pleine, les deux bases de comparaison existent. */
function kpisWith(
  vsYesterday: number | null,
  vsD7: number | null,
): DashboardKpis {
  const d = (value: number) => ({ value, vs_yesterday: vsYesterday, vs_d7: vsD7 });
  return {
    net_revenue: d(8_420_000),
    orders:      d(46),
    customers:   d(31),
    items_sold:  d(118),
    avg_basket:  d(183_000),
    gross_margin: {
      value: 61.4,
      vs_yesterday_pt: vsYesterday,
      vs_d7_pt: vsD7,
      basis: 'current_cost_price',
      cost_coverage_pct: 92.5,
    },
    cash_on_hand: { value: 2_100_000, drawer: 900_000, safe: 1_200_000, wallets: [] },
  };
}

describe('DashboardKpiStrip — comparisons with no baseline', () => {
  it('renders both comparisons when both baselines exist', () => {
    wrap(<DashboardKpiStrip kpis={kpisWith(4.2, -1.8)} isLoading={false} />);
    expect(screen.getAllByText('yest')).toHaveLength(6);
    expect(screen.getAllByText('D-7')).toHaveLength(6);
    expect(screen.queryByTestId('no-baseline')).not.toBeInTheDocument();
  });

  it('collapses the "yest" column into ONE note when yesterday was empty', () => {
    wrap(<DashboardKpiStrip kpis={kpisWith(null, -1.8)} isLoading={false} />);
    expect(screen.queryByText('yest')).not.toBeInTheDocument();
    expect(screen.getAllByText('D-7')).toHaveLength(6);
    expect(screen.getByTestId('no-baseline')).toHaveTextContent(/No sales yesterday/i);
  });

  it('collapses BOTH columns into a single sentence when no baseline exists', () => {
    wrap(<DashboardKpiStrip kpis={kpisWith(null, null)} isLoading={false} />);
    expect(screen.queryByText('yest')).not.toBeInTheDocument();
    expect(screen.queryByText('D-7')).not.toBeInTheDocument();
    const note = screen.getByTestId('no-baseline');
    expect(note).toHaveTextContent(/yesterday or on the same weekday last week/i);
    // Une mention, pas deux : c'est tout l'objet du repli.
    expect(screen.getAllByTestId('no-baseline')).toHaveLength(1);
  });

  it('keeps the dash of a SINGLE measure without a baseline', () => {
    // La marge n'a pas de base (net négatif la veille) mais les cinq autres en
    // ont une : la colonne reste, seule la marge affiche son tiret.
    const kpis = kpisWith(4.2, -1.8);
    kpis.gross_margin.vs_yesterday_pt = null;
    wrap(<DashboardKpiStrip kpis={kpis} isLoading={false} />);
    expect(screen.getAllByText('yest')).toHaveLength(6);
    expect(screen.queryByTestId('no-baseline')).not.toBeInTheDocument();
  });

  it('shows no comparison and no baseline note before the day has started', () => {
    const kpis = kpisWith(null, null);
    kpis.orders.value = 0;
    wrap(<DashboardKpiStrip kpis={kpis} isLoading={false} />);
    expect(screen.getByTestId('no-sales-yet')).toBeInTheDocument();
    // La mention d'ouverture couvre déjà le cas : la doubler serait le mur en gris.
    expect(screen.queryByTestId('no-baseline')).not.toBeInTheDocument();
  });
});
