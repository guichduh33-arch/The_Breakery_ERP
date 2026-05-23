// apps/backoffice/src/features/accounting/components/JournalEntryDetailDrawer.tsx
// Session 26b / Wave 2.B — Drilldown drawer for a single journal_entry.

import type { JSX } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@breakery/ui';
import { useJournalEntryLines } from '../hooks/useJournalEntryLines.js';
import type { JournalEntryRow } from '../hooks/useJournalEntries.js';

export interface JournalEntryDetailDrawerProps {
  entry: JournalEntryRow | null;
  onClose: () => void;
}

function fmt(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

export function JournalEntryDetailDrawer({
  entry,
  onClose,
}: JournalEntryDetailDrawerProps): JSX.Element | null {
  const lines = useJournalEntryLines(entry?.id ?? null);

  if (entry === null) return null;

  return (
    <Sheet open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{entry.entry_number}</SheetTitle>
          <SheetDescription>
            {entry.entry_date} — {entry.description ?? '(no description)'}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 text-xs text-text-secondary">
          Source : <span className="font-mono">{entry.reference_type ?? '—'}</span>
          {' · '}Status : <span className="font-mono">{entry.status}</span>
        </div>

        <div className="mt-6">
          {lines.isLoading && <p className="text-sm text-text-secondary">Loading lines…</p>}
          {lines.data && lines.data.length > 0 && (
            <table className="w-full text-sm" data-testid="je-lines-table">
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-text-secondary border-b border-border-subtle">
                  <th className="px-2 py-2">Account</th>
                  <th className="px-2 py-2 text-right">Debit</th>
                  <th className="px-2 py-2 text-right">Credit</th>
                  <th className="px-2 py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {lines.data.map((line) => (
                  <tr key={line.id} className="border-t border-border-subtle">
                    <td className="px-2 py-2">
                      <span className="font-mono text-xs text-text-secondary">{line.account_code}</span>
                      {' '}
                      <span>{line.account_name}</span>
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {line.debit > 0 ? fmt(line.debit) : ''}
                    </td>
                    <td className="px-2 py-2 text-right font-mono">
                      {line.credit > 0 ? fmt(line.credit) : ''}
                    </td>
                    <td className="px-2 py-2 text-xs text-text-secondary">
                      {line.description ?? ''}
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border-strong font-semibold">
                  <td className="px-2 py-2 text-right">Totals</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(entry.total_debit)}</td>
                  <td className="px-2 py-2 text-right font-mono">{fmt(entry.total_credit)}</td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
