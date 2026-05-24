// apps/backoffice/src/features/accounting/components/exportTrialBalanceCsv.ts
// Session 26b / Wave 4 — CSV export for the Trial Balance.
// S29 Wave 4.A.2 — refactored: column definitions aligned with CsvColumn pattern.
//
// UTF-8 BOM (Excel-friendly) + header line + Indonesian locale formatting
// (Intl.NumberFormat('id-ID')) for debit/credit/balance numeric columns.
// Filename : trial-balance_YYYY-MM-DD_to_YYYY-MM-DD.csv
//
// NOTE: Uses \n line endings (not \r\n) to preserve byte-identical output
// required by the T2 smoke test. Cannot delegate to buildCsv (which uses \r\n).

import { downloadCsv } from '@breakery/domain';
import type { TrialBalancePayload } from '../hooks/useTrialBalance.js';

const CLASS_LABELS: Record<number, string> = {
  1: 'Asset', 2: 'Liability', 3: 'Equity', 4: 'Revenue', 5: 'COGS', 6: 'Expense',
};

const fmt = new Intl.NumberFormat('id-ID');

type TbLine = TrialBalancePayload['lines'][number];

interface TbCsvColumn {
  header:   string;
  accessor: (row: TbLine) => string;
}

const COLUMNS: TbCsvColumn[] = [
  { header: 'code',    accessor: (l) => l.code },
  { header: 'name',    accessor: (l) => l.name },
  { header: 'class',   accessor: (l) => CLASS_LABELS[l.account_class] ?? String(l.account_class) },
  { header: 'debit',   accessor: (l) => fmt.format(l.total_debit) },
  { header: 'credit',  accessor: (l) => fmt.format(l.total_credit) },
  { header: 'balance', accessor: (l) => fmt.format(l.balance) },
];

function csvQuote(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function buildRow(cells: string[]): string {
  return cells.map(csvQuote).join(',');
}

export function buildTrialBalanceCsv(payload: TrialBalancePayload): string {
  const BOM = '﻿';
  const header = buildRow(COLUMNS.map((c) => c.header));
  const dataRows = payload.lines.map((l) => buildRow(COLUMNS.map((c) => c.accessor(l))));
  const footer = buildRow(['', 'TOTAL', '', fmt.format(payload.total_debit), fmt.format(payload.total_credit), '']);
  return BOM + [header, ...dataRows, footer].join('\n');
}

export function downloadTrialBalanceCsv(payload: TrialBalancePayload): void {
  const csv = buildTrialBalanceCsv(payload);
  downloadCsv(csv, `trial-balance_${payload.period.start}_to_${payload.period.end}.csv`);
}
