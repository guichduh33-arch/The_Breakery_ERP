// apps/backoffice/src/features/accounting/pages/JournalEntriesPage.tsx
// Session 26b / Wave 2.B — Journal entries cockpit page.
// Gate route : accounting.gl.read ; "+ New manual JE" gated par accounting.je.create_manual.

import { useMemo, useState, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { Plus } from 'lucide-react';
import {
  useJournalEntries,
  type JournalEntryRow,
} from '@/features/accounting/hooks/useJournalEntries.js';
import { JournalEntryDetailDrawer } from '@/features/accounting/components/JournalEntryDetailDrawer.js';
import { CreateManualJEModal } from '@/features/accounting/components/CreateManualJEModal.js';
import { useAuthStore } from '@/stores/authStore.js';

function fmt(n: number): string {
  return new Intl.NumberFormat('id-ID').format(n);
}

function defaultPeriodStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function defaultPeriodEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function JournalEntriesPage(): JSX.Element {
  const [startDate, setStartDate] = useState(defaultPeriodStart());
  const [endDate,   setEndDate]   = useState(defaultPeriodEnd());
  const [selected,  setSelected]  = useState<JournalEntryRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const entries = useJournalEntries({ startDate, endDate });
  const canCreate = useAuthStore((s) => s.hasPermission('accounting.je.create_manual'));

  const rows = useMemo<JournalEntryRow[]>(() => entries.data ?? [], [entries.data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl text-text-primary">Journal Entries</h1>
          <p className="text-sm text-text-secondary italic">
            {rows.length} entries — click a row for line detail
          </p>
        </div>
        {canCreate && (
          <Button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2"
            data-testid="je-new-btn"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New manual JE
          </Button>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            data-testid="je-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="mt-1"
            data-testid="je-filter-end"
          />
        </label>
      </div>

      {entries.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {!entries.isLoading && rows.length === 0 && (
        <p className="text-sm text-text-secondary">No journal entries in this period.</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-hidden">
          <table className="w-full text-sm" data-testid="je-table">
            <thead>
              <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                <th className="px-3 py-2">Date</th>
                <th className="px-3 py-2">Entry #</th>
                <th className="px-3 py-2">Description</th>
                <th className="px-3 py-2 text-right">Debit</th>
                <th className="px-3 py-2 text-right">Credit</th>
                <th className="px-3 py-2">Source</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid={`je-row-${row.entry_number}`}
                  className="border-t border-border-subtle cursor-pointer hover:bg-bg-overlay"
                  onClick={() => setSelected(row)}
                >
                  <td className="px-3 py-2">{row.entry_date}</td>
                  <td className="px-3 py-2 font-mono text-xs">{row.entry_number}</td>
                  <td className="px-3 py-2">{row.description ?? '—'}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(row.total_debit)}</td>
                  <td className="px-3 py-2 text-right font-mono">{fmt(row.total_credit)}</td>
                  <td className="px-3 py-2 text-xs text-text-secondary">
                    {row.reference_type ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <JournalEntryDetailDrawer entry={selected} onClose={() => setSelected(null)} />
      {showCreate && (
        <CreateManualJEModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
