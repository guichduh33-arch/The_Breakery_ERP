import type * as DomainModule from '@breakery/domain';
import { describe, expect, it, vi } from 'vitest';
import { downloadCsv } from '@breakery/domain';
import { financialFixture } from '../../__tests__/financialFixture.js';
import { dashboardFinancialView, restrictedCostMtd, restrictedGrossMargin } from '../dashboardFinancial.js';
import { buildDashboardCsvRows, exportDashboardCsv } from '../dashboardCsv.js';

vi.mock('@breakery/domain', async (original) => ({
  ...await original<typeof DomainModule>(), downloadCsv: vi.fn(),
}));

describe('dashboard financial view and export', () => {
  it('removes all financial values without changing the source or commercial metrics', () => {
    const source = financialFixture();
    const before = structuredClone(source);
    const view = dashboardFinancialView(source, false);
    expect(view.cost_mtd).toEqual(restrictedCostMtd());
    expect(view.kpis.gross_margin).toEqual(restrictedGrossMargin());
    expect(view.kpis.net_revenue).toEqual(source.kpis.net_revenue);
    expect(source).toEqual(before);
    const rows = buildDashboardCsvRows(view);
    expect(rows.some((r) => r.section.startsWith('Cost MTD') || r.metric.startsWith('Gross margin'))).toBe(false);
    expect(rows).toContainEqual({ section: 'KPI', metric: 'Net revenue', value: 10000, unit: 'IDR' });
  });

  it('does not re-expose figures attached to a server-restricted block', () => {
    const source = financialFixture();
    source.cost_mtd.restricted = true;
    source.kpis.gross_margin.restricted = true;
    expect(buildDashboardCsvRows(source).some((r) => r.section.includes('Cost MTD') || r.metric.includes('Gross margin'))).toBe(false);
    const view = dashboardFinancialView(source, true);
    expect(view.cost_mtd.lines).toEqual([]);
    expect(view.kpis.gross_margin.vs_yesterday_pt).toBeNull();
  });

  it('preserves the financial blocks when authorized', () => {
    const source = financialFixture();
    const view = dashboardFinancialView(source, true);
    expect(view.cost_mtd).toEqual(source.cost_mtd);
    expect(view.kpis.gross_margin).toEqual(source.kpis.gross_margin);
    expect(buildDashboardCsvRows(view)).toContainEqual({
      section: 'Cost MTD (cogs)', metric: '5100 Private flour account', value: 5000, unit: 'IDR',
    });
  });

  it('uses the business day in the exported filename', () => {
    exportDashboardCsv(dashboardFinancialView(financialFixture(), false));
    expect(downloadCsv).toHaveBeenLastCalledWith(expect.any(String), 'dashboard-today-2026-07-01.csv');
  });
});
