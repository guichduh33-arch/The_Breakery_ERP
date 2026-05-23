// apps/backoffice/src/features/accounting/components/exportTrialBalanceCsv.ts
// Session 26b / Wave 4 — CSV export for the Trial Balance.
//
// UTF-8 BOM (Excel-friendly) + header line + Indonesian locale formatting
// (Intl.NumberFormat('id-ID')) for debit/credit/balance numeric columns.
// Filename : trial-balance_YYYY-MM-DD_to_YYYY-MM-DD.csv

import type { TrialBalancePayload } from '../hooks/useTrialBalance.js';

const CLASS_LABELS: Record<number, string> = {
  1: 'Asset', 2: 'Liability', 3: 'Equity', 4: 'Revenue', 5: 'COGS', 6: 'Expense',
};

function fmtNumber(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function csvQuote(v: string): string {
  // Quote when contains comma, double-quote, or newline.
  if (/[",\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

export function buildTrialBalanceCsv(payload: TrialBalancePayload): string {
  const BOM = '﻿';
  const header = ['code', 'name', 'class', 'debit', 'credit', 'balance'];
  const rows = payload.lines.map((l) => [
    l.code,
    l.name,
    CLASS_LABELS[l.account_class] ?? String(l.account_class),
    fmtNumber(l.total_debit),
    fmtNumber(l.total_credit),
    fmtNumber(l.balance),
  ]);
  const footer = ['', 'TOTAL', '', fmtNumber(payload.total_debit), fmtNumber(payload.total_credit), ''];
  return (
    BOM +
    [header, ...rows, footer]
      .map((r) => r.map((c) => csvQuote(String(c))).join(','))
      .join('\n')
  );
}

export function downloadTrialBalanceCsv(payload: TrialBalancePayload): void {
  const csv = buildTrialBalanceCsv(payload);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `trial-balance_${payload.period.start}_to_${payload.period.end}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
