// apps/backoffice/src/features/accounting/index.ts
// Session 26b — Accounting cockpit feature barrel.

export { useChartOfAccounts, type AccountRow, CHART_OF_ACCOUNTS_KEY } from './hooks/useChartOfAccounts.js';
export { useUpdateAccountActive, type UpdateAccountActiveArgs } from './hooks/useUpdateAccountActive.js';
export { useJournalEntries, type JournalEntryRow, type JournalEntriesFilter, JOURNAL_ENTRIES_KEY } from './hooks/useJournalEntries.js';
export { useJournalEntryLines, type JournalEntryLineRow, JE_LINES_KEY } from './hooks/useJournalEntryLines.js';
export { useCreateManualJournalEntry, type CreateManualJEArgs, type ManualJELine } from './hooks/useCreateManualJournalEntry.js';
export { usePostableAccounts, type PostableAccountOption, POSTABLE_ACCOUNTS_FULL_KEY } from './hooks/usePostableAccounts.js';
export { default as ChartOfAccountsPage } from './pages/ChartOfAccountsPage.js';
export { default as JournalEntriesPage } from './pages/JournalEntriesPage.js';
export { JournalEntryDetailDrawer, type JournalEntryDetailDrawerProps } from './components/JournalEntryDetailDrawer.js';
export { CreateManualJEModal, type CreateManualJEModalProps } from './components/CreateManualJEModal.js';
export { useGeneralLedger, type GeneralLedgerPayload, type GLLineRaw, type UseGeneralLedgerArgs, GENERAL_LEDGER_KEY } from './hooks/useGeneralLedger.js';
export { default as GeneralLedgerPage } from './pages/GeneralLedgerPage.js';
export { useTrialBalance, type TrialBalancePayload, type TrialBalanceLine, TRIAL_BALANCE_KEY } from './hooks/useTrialBalance.js';
export { default as TrialBalancePage } from './pages/TrialBalancePage.js';
export { buildTrialBalanceCsv, downloadTrialBalanceCsv } from './components/exportTrialBalanceCsv.js';
export { useFiscalPeriods, type FiscalPeriodRow, FISCAL_PERIODS_KEY } from './hooks/useFiscalPeriods.js';
export { useCloseFiscalPeriod, type CloseFiscalPeriodArgs } from './hooks/useCloseFiscalPeriod.js';
export { FiscalPeriodModal, type FiscalPeriodModalProps } from './components/FiscalPeriodModal.js';
export { default as SettingsAccountingPage } from './pages/SettingsAccountingPage.js';
