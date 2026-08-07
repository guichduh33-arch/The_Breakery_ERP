// apps/backoffice/src/features/dashboard/utils/dashboardCsv.ts
//
// Écran 1c — export CSV de ce que la page montre.
//
// Format LONG (section, metric, value, unit) et non une large table : le
// dashboard agrège six familles de mesures qui n'ont ni les mêmes colonnes ni
// la même granularité. Les aplatir sur une ligne large produirait un fichier
// creux ; en long, chaque ligne est un fait complet et le tableur pivote.
//
// L'export ne sort QUE des valeurs déjà reçues — aucun appel supplémentaire, et
// donc aucune donnée que le rôle n'avait pas déjà le droit de lire.
//
// Arbitré le 2026-08-07 : ce format est la cible retenue (ni CSV large, ni PDF).

import { buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import type { DashboardOverview } from '../hooks/useDashboardOverview.js';
import { orderTypeLabel, paymentMethodLabel } from './format.js';

export interface DashboardCsvRow {
  section: string;
  metric:  string;
  value:   number | null;
  unit:    string;
}

const COLUMNS: CsvColumn<DashboardCsvRow>[] = [
  { header: 'Section', accessor: (r) => r.section },
  { header: 'Metric',  accessor: (r) => r.metric },
  { header: 'Value',   accessor: (r) => r.value, format: 'number' },
  { header: 'Unit',    accessor: (r) => r.unit },
];

export function buildDashboardCsvRows(o: DashboardOverview): DashboardCsvRow[] {
  const rows: DashboardCsvRow[] = [];
  const k = o.kpis;

  const kpi = (metric: string, value: number | null, unit: string): void => {
    rows.push({ section: 'KPI', metric, value, unit });
  };
  kpi('Net revenue', k.net_revenue.value, 'IDR');
  kpi('Net revenue vs yesterday', k.net_revenue.vs_yesterday, '%');
  kpi('Net revenue vs D-7', k.net_revenue.vs_d7, '%');
  kpi('Orders', k.orders.value, 'count');
  kpi('Orders vs yesterday', k.orders.vs_yesterday, '%');
  kpi('Orders vs D-7', k.orders.vs_d7, '%');
  kpi('Items sold', k.items_sold.value, 'count');
  kpi('Avg basket', k.avg_basket.value, 'IDR');
  // La base de la marge voyage AVEC la marge : un chiffre exporté sans sa
  // réserve devient un chiffre officiel dans un tableur.
  kpi(`Gross margin (${k.gross_margin.basis})`, k.gross_margin.value, '%');
  kpi('Gross margin cost coverage', k.gross_margin.cost_coverage_pct, '%');
  if (k.cash_on_hand.restricted !== true) {
    kpi('Cash on hand', k.cash_on_hand.value ?? null, 'IDR');
    for (const w of k.cash_on_hand.wallets) {
      rows.push({ section: 'Cash', metric: `${w.code} ${w.name}`, value: w.balance, unit: 'IDR' });
    }
  }

  for (const s of o.revenue_share) {
    rows.push({ section: 'Revenue share', metric: orderTypeLabel(s.order_type), value: s.gross, unit: 'IDR' });
  }
  for (const p of o.payments.lines) {
    rows.push({ section: 'Payments', metric: paymentMethodLabel(p.method), value: p.amount, unit: 'IDR' });
  }
  rows.push({ section: 'Payments', metric: 'Total collected', value: o.payments.total, unit: 'IDR' });
  rows.push({ section: 'Payments', metric: 'Cash expected in drawer', value: o.payments.cash_expected_drawer, unit: 'IDR' });

  for (const l of o.cost_mtd.lines) {
    rows.push({ section: `Cost MTD (${l.family})`, metric: `${l.account_code} ${l.account_name}`, value: l.amount, unit: 'IDR' });
  }
  rows.push({ section: 'Cost MTD', metric: 'Total', value: o.cost_mtd.total, unit: 'IDR' });
  rows.push({ section: 'Cost MTD', metric: 'Cost per basket', value: o.cost_mtd.cost_per_basket, unit: 'IDR' });

  for (const d of o.revenue_30d) {
    rows.push({ section: 'Revenue 30 d', metric: d.date, value: d.net, unit: 'IDR' });
  }
  for (const h of o.hourly_sales) {
    rows.push({ section: 'Hourly sales', metric: `${String(h.hour).padStart(2, '0')}:00`, value: h.today, unit: 'IDR' });
  }

  return rows;
}

export function exportDashboardCsv(o: DashboardOverview): void {
  const day = o.generated_at.slice(0, 10);
  downloadCsv(buildCsv(buildDashboardCsvRows(o), COLUMNS), `dashboard-today-${day}.csv`);
}
