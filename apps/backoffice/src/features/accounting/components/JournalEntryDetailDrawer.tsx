// apps/backoffice/src/features/accounting/components/JournalEntryDetailDrawer.tsx
// Session 26b / Wave 2.B — Drilldown drawer for a single journal_entry.

import { useMemo, type JSX } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
import { formatCurrency } from '@breakery/utils';
import { useJournalEntryLines } from '../hooks/useJournalEntryLines.js';
import type { JournalEntryRow } from '../hooks/useJournalEntries.js';
import { useEntityNames } from '../hooks/useEntityNames.js';
import { resolveJeSourceEntity } from '../utils/resolveJeSourceEntity.js';
import { collectUuids } from '../utils/journalDescription.js';
import { ResolvedDescription } from './ResolvedDescription.js';
import { DrilldownLink } from '@/features/reports/components/DrilldownLink.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';

export interface JournalEntryDetailDrawerProps {
  entry: JournalEntryRow | null;
  onClose: () => void;
}

const fmt = formatCurrency;

const LINE_HEAD: readonly { label: string; right: boolean }[] = [
  { label: 'Account',     right: false },
  { label: 'Debit',       right: true  },
  { label: 'Credit',      right: true  },
  { label: 'Description', right: false },
];

export function JournalEntryDetailDrawer({
  entry,
  onClose,
}: JournalEntryDetailDrawerProps): JSX.Element | null {
  const lines = useJournalEntryLines(entry?.id ?? null);

  // La LISTE humanisait déjà ses identifiants ; ouvrir le tiroir depuis la
  // même ligne rendait de nouveau « session 4d11cb01-… » (critique design
  // 2026-08-26). Même résolution ici, en-tête ET lignes — un seul lot.
  const uuids = useMemo(
    () => collectUuids([
      entry?.description ?? null,
      ...(lines.data ?? []).map((l) => l.description),
    ]),
    [entry?.description, lines.data],
  );
  const names = useEntityNames(uuids);

  if (entry === null) return null;

  const source = resolveJeSourceEntity(entry.reference_type, entry.reference_id);

  return (
    <Sheet open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono text-base">{entry.entry_number}</SheetTitle>
          <SheetDescription>
            {entry.entry_date} —{' '}
            {entry.description === null || entry.description === ''
              ? '(no description)'
              : <ResolvedDescription text={entry.description} names={names} />}
          </SheetDescription>
        </SheetHeader>

        <div className="mt-4 text-xs text-text-secondary">
          Source:{' '}
          {source !== null ? (
            <DrilldownLink
              entity={source.entity}
              id={source.id}
              label={<span className="font-mono">{entry.reference_type}</span>}
              icon={false}
            />
          ) : (
            <span className="font-mono">{entry.reference_type ?? '—'}</span>
          )}
          {' · '}Status: <span className="font-mono">{entry.status}</span>
        </div>

        <div className="mt-6">
          {lines.isLoading && <p className="text-sm text-text-secondary">Loading lines…</p>}

          {/* Le tiroir n'avait NI branche d'échec NI branche vide : une lecture
              refusée rendait l'en-tête de l'écriture, ses totaux dans la liste
              derrière, et un panneau muet — indiscernable d'une écriture sans
              ligne, qui est un tout autre fait (et une anomalie comptable).
              Les deux se disent donc séparément, et jamais l'un pour l'autre. */}
          {lines.isError && (
            <QueryErrorBanner
              detail={errorDetailText(lines.error)}
              onRetry={() => { void lines.refetch(); }}
              data-testid="je-lines-error"
            >
              The lines of this entry could not be loaded — what it debits and
              credits is unknown here, not absent.
            </QueryErrorBanner>
          )}

          {!lines.isLoading && !lines.isError && lines.data?.length === 0 && (
            <p className="text-sm text-text-secondary" data-testid="je-lines-empty">
              This entry carries no line. Nothing was debited or credited — check
              the source that posted it.
            </p>
          )}

          {lines.data && lines.data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="je-lines-table">
                {/* Canon des tableaux (patron `WalletLedgerTable`) : papier
                    inerte et libellés en label mono capitales. */}
                <thead>
                  <tr className="border-b border-border-subtle bg-surface-inert text-left">
                    {LINE_HEAD.map((h) => (
                      <th
                        key={h.label}
                        scope="col"
                        className={`px-2 py-2.5 font-data ${h.right ? 'text-right' : ''}`}
                      >
                        <SectionLabel as="span" size="xs">{h.label}</SectionLabel>
                      </th>
                    ))}
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
                      {/* `whitespace-nowrap` : « Rp 4.850.000 » se coupait au
                          « Rp » dans un tiroir déjà étroit. */}
                      <td className="whitespace-nowrap px-2 py-2 text-right font-data tabular-nums">
                        {line.debit > 0 ? fmt(line.debit) : ''}
                      </td>
                      <td className="whitespace-nowrap px-2 py-2 text-right font-data tabular-nums">
                        {line.credit > 0 ? fmt(line.credit) : ''}
                      </td>
                      <td className="px-2 py-2 text-xs text-text-secondary">
                        {line.description === null || line.description === ''
                          ? ''
                          : <ResolvedDescription text={line.description} names={names} />}
                      </td>
                    </tr>
                  ))}
                </tbody>
                {/* Les totaux sont un PIED de tableau, pas une ligne
                    d'écriture : `<tfoot>` + `<th scope="row">` (patron
                    `DailySalesPage`). */}
                <tfoot>
                  <tr className="border-t-2 border-border-strong font-semibold">
                    <th scope="row" className="px-2 py-2 text-right font-semibold">Totals</th>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-data tabular-nums">{fmt(entry.total_debit)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-right font-data tabular-nums">{fmt(entry.total_credit)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
