// apps/backoffice/src/features/accounting/pages/JournalEntriesPage.tsx
// Session 26b / Wave 2.B — Journal entries cockpit page.
// Gate route : accounting.gl.read ; "+ New manual JE" gated par accounting.je.create_manual.

import { useMemo, useRef, useState, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { formatCurrency } from '@breakery/utils';
import { Plus } from 'lucide-react';
import {
  useJournalEntries,
  type JournalEntryRow,
} from '@/features/accounting/hooks/useJournalEntries.js';
import { JournalEntryDetailDrawer } from '@/features/accounting/components/JournalEntryDetailDrawer.js';
import { CreateManualJEModal } from '@/features/accounting/components/CreateManualJEModal.js';
import { useAuthStore } from '@/stores/authStore.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';

const fmt = formatCurrency;

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

  // Le tiroir est un `Sheet` Radix monté hors `SheetTrigger` : à la fermeture,
  // `entry` repasse à `null` et le contenu se DÉMONTE avant que Radix ne rende
  // le focus. Vérifié au navigateur : Échap laissait le focus sur `<body>`, donc
  // au début du document — un comptable au clavier perdait sa place dans une
  // table de 200 lignes (WCAG 2.4.3). On mémorise le déclencheur et on le
  // refocalise. `requestAnimationFrame` : le focus doit être posé APRÈS le
  // démontage, sinon Radix le reprend en partant.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  function closeDrawer(): void {
    setSelected(null);
    const el = triggerRef.current;
    triggerRef.current = null;
    if (el !== null) requestAnimationFrame(() => { el.focus(); });
  }

  const entries = useJournalEntries({ startDate, endDate });
  const canCreate = useAuthStore((s) => s.hasPermission('accounting.je.create_manual'));

  const rows = useMemo<JournalEntryRow[]>(() => entries.data ?? [], [entries.data]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal Entries"
        // Même raison qu'au plan de comptes : le nombre d'écritures change au
        // chargement et à chaque changement de période (WCAG 4.1.3).
        subtitle={
          <span className="italic" role="status">
            {rows.length} entries — open an entry number for line detail
          </span>
        }
        actions={canCreate ? (
          <Button
            variant="ink"
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-2"
            data-testid="je-new-btn"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New manual JE
          </Button>
        ) : undefined}
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date" lang="id-ID"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="mt-1"
            data-testid="je-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date" lang="id-ID"
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
        <div className="rounded-lg border border-border-subtle bg-bg-elevated overflow-x-auto">
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
                  onClick={() => { triggerRef.current = null; setSelected(row); }}
                >
                  <td className="px-3 py-2">{row.entry_date}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {/* Le tiroir de détail ne s'ouvrait QUE par le `onClick` du
                        `<tr>` : les cellules étaient du texte pur et rien
                        d'autre sur la page n'ouvrait ce tiroir. Un comptable au
                        clavier ou au lecteur d'écran ne pouvait donc PAS
                        consulter le détail d'une écriture — WCAG 2.1.1, niveau
                        A. Le numéro d'écriture devient le vrai déclencheur
                        focalisable (patron StockLedgerTable / AuditPage) ; le
                        `onClick` de ligne reste une commodité souris, et
                        `stopPropagation` évite la double ouverture.

                        `aria-haspopup="dialog"` plutôt qu'`aria-expanded` : le
                        panneau n'est pas un dépliant en ligne mais un `Sheet`
                        Radix, donc un `role="dialog" aria-modal` avec piège de
                        focus et sortie par Échap. C'est bien un popup de type
                        dialogue que la commande annonce. */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); triggerRef.current = e.currentTarget; setSelected(row); }}
                      aria-haspopup="dialog"
                      aria-label={`Open detail for entry ${row.entry_number}`}
                      data-testid={`je-open-${row.entry_number}`}
                      className={`rounded-sm underline-offset-2 hover:underline ${FOCUS_RING}`}
                    >
                      {row.entry_number}
                    </button>
                  </td>
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

      <JournalEntryDetailDrawer entry={selected} onClose={closeDrawer} />
      {showCreate && (
        <CreateManualJEModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
