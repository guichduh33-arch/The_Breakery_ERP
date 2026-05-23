// apps/backoffice/src/features/accounting/index.ts
// Session 26b — Accounting cockpit feature barrel.

export { useChartOfAccounts, type AccountRow, CHART_OF_ACCOUNTS_KEY } from './hooks/useChartOfAccounts.js';
export { useUpdateAccountActive, type UpdateAccountActiveArgs } from './hooks/useUpdateAccountActive.js';
export { default as ChartOfAccountsPage } from './pages/ChartOfAccountsPage.js';
