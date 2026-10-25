// Défense d'affichage contre un payload ancien ou un cache encore chiffré.
// La garde SQL reste l'autorité ; aucun chiffre interdit ne traverse la vue.
import type { DashboardOverview, GrossMarginKpi, CostMtd } from '../hooks/useDashboardOverview.js';

export const restrictedGrossMargin = (): GrossMarginKpi => ({
  restricted: true, value: null, vs_yesterday_pt: null, vs_d7_pt: null,
  basis: null, cost_coverage_pct: null,
});
export const restrictedCostMtd = (): CostMtd => ({
  restricted: true, cogs_total: null, opex_total: null, sales_mtd: null,
  cogs_pct_of_sales: null, opex_pct_of_sales: null, total: null,
  cost_per_basket: null, lines: [],
});

export function dashboardFinancialView(
  overview: DashboardOverview,
  canReadFinancial: boolean,
): DashboardOverview {
  return {
    ...overview,
    kpis: {
      ...overview.kpis,
      gross_margin: !canReadFinancial || overview.kpis.gross_margin.restricted === true
        ? restrictedGrossMargin() : overview.kpis.gross_margin,
    },
    cost_mtd: !canReadFinancial || overview.cost_mtd.restricted === true
      ? restrictedCostMtd() : overview.cost_mtd,
  };
}
