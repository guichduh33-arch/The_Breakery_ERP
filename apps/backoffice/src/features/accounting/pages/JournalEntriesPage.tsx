// apps/backoffice/src/features/accounting/pages/JournalEntriesPage.tsx
// Session 26b / Wave 2.B — Journal entries cockpit page.
// Gate route : accounting.gl.read ; "+ New manual JE" gated par accounting.je.create_manual.

import { Fragment, useMemo, useRef, useState, type JSX } from 'react';
import { Button, Input } from '@breakery/ui';
import { formatCurrency } from '@breakery/utils';
import { Plus } from 'lucide-react';
import {
  useJournalEntries,
  type JournalEntryRow,
} from '@/features/accounting/hooks/useJournalEntries.js';
import { useEntityNames } from '@/features/accounting/hooks/useEntityNames.js';
import {
  collectUuids,
  segmentDescription,
} from '@/features/accounting/utils/journalDescription.js';
import { JournalEntryDetailDrawer } from '@/features/accounting/components/JournalEntryDetailDrawer.js';
import { CreateManualJEModal } from '@/features/accounting/components/CreateManualJEModal.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useListParams } from '@/hooks/useListParams.js';
import { PageHeader } from '@/components/PageHeader.js';
import { FOCUS_RING } from '@/components/focusRing.js';

const fmt = formatCurrency;
const num = (n: number): string => n.toLocaleString('id-ID');

const CREATE_JE_REASON =
  'You need the accounting.je.create_manual permission to post a manual journal entry.';

function defaultPeriodStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
}
function defaultPeriodEnd(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function JournalEntriesPage(): JSX.Element {
  // La période vit dans l'URL, comme sur Products et OrdersListPage. Elle
  // vivait en `useState` : ouvrir une écriture puis revenir en arrière
  // ramenait au mois courant, et une période ne se collait pas dans une
  // conversation. Les noms `start` / `end` sont ceux que le Grand Livre lit
  // déjà, pour qu'un lien se transpose d'un écran à l'autre.
  //
  // Les DEUX bornes sont écrites dès qu'on en touche une, jamais retirées
  // quand elles égalent le défaut : ce défaut dépend de la date du jour, donc
  // une borne omise ferait qu'un lien partagé aujourd'hui ne montre pas la
  // même fenêtre demain.
  const [params, patchParams] = useListParams();
  const startDate = params.get('start') ?? defaultPeriodStart();
  const endDate   = params.get('end')   ?? defaultPeriodEnd();

  const [selected,  setSelected]  = useState<JournalEntryRow | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  // Le tiroir est un `Sheet` Radix monté hors `SheetTrigger` : à la fermeture,
  // `entry` repasse à `null` et le contenu se DÉMONTE avant que Radix ne rende
  // le focus. Vérifié au navigateur : Échap laissait le focus sur `<body>`, donc
  // au début du document — un comptable au clavier perdait sa place dans une
  // longue table (WCAG 2.4.3). On mémorise le déclencheur et on le refocalise.
  // `requestAnimationFrame` : le focus doit être posé APRÈS le démontage, sinon
  // Radix le reprend en partant.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  function closeDrawer(): void {
    setSelected(null);
    const el = triggerRef.current;
    triggerRef.current = null;
    if (el !== null) requestAnimationFrame(() => { el.focus(); });
  }

  const entries = useJournalEntries({ startDate, endDate });
  const canCreate = useAuthStore((s) => s.hasPermission('accounting.je.create_manual'));

  const rows = useMemo<JournalEntryRow[]>(
    () => (entries.data?.pages ?? []).flatMap((p) => p.rows),
    [entries.data],
  );
  // Le total vient de la PREMIÈRE page — la seule qui le demande au serveur.
  const total = entries.data?.pages[0]?.total ?? null;

  // Un seul aller-retour pour tous les identifiants de la liste, plutôt qu'une
  // requête par ligne.
  const uuids = useMemo(() => collectUuids(rows.map((r) => r.description)), [rows]);
  const names = useEntityNames(uuids);

  // « X loaded of Y », jamais un plafond présenté comme un total. Quand tout est
  // chargé la phrase redevient un simple décompte : « 12 loaded of 12 » se lit
  // comme une liste tronquée alors qu'elle est complète.
  const countLabel =
    total === null      ? `${num(rows.length)} loaded`
    : rows.length >= total ? `${num(total)} ${total === 1 ? 'entry' : 'entries'}`
    : `${num(rows.length)} loaded of ${num(total)}`;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Journal entries"
        subtitle="Open an entry number for line detail"
        // Le bouton était MASQUÉ sans la permission. Doctrine du dépôt
        // (ProductsHeader, B2BOrdersPage) : on le REND, désactivé, en disant
        // pourquoi — un bouton absent se lit « cette page ne crée pas
        // d'écriture », un bouton grisé et motivé se lit « demande ce droit ».
        // Un `<button disabled>` n'est pas focalisable, le `title` seul n'atteint
        // donc ni le clavier ni le lecteur d'écran : la raison est doublée d'un
        // texte `sr-only` référencé par `aria-describedby`.
        actions={
          <>
            <Button
              variant="ink"
              onClick={() => setShowCreate(true)}
              className="inline-flex items-center gap-2"
              disabled={!canCreate}
              {...(canCreate ? {} : { title: CREATE_JE_REASON, 'aria-describedby': 'je-create-reason' })}
              data-testid="je-new-btn"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New manual JE
            </Button>
            {!canCreate && <span id="je-create-reason" className="sr-only">{CREATE_JE_REASON}</span>}
          </>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          From
          <Input
            type="date" lang="id-ID"
            value={startDate}
            onChange={(e) => { patchParams({ start: e.target.value, end: endDate }); }}
            className="mt-1"
            data-testid="je-filter-start"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          To
          <Input
            type="date" lang="id-ID"
            value={endDate}
            onChange={(e) => { patchParams({ start: startDate, end: e.target.value }); }}
            className="mt-1"
            data-testid="je-filter-end"
          />
        </label>
      </div>

      {/* Région live UNIQUE et toujours montée : le pied de table se démonte
          quand la liste se vide, donc un `role="status"` qui n'y vivrait que
          là ne pourrait jamais annoncer la transition vers zéro — le seul
          moment où l'annonce sert (WCAG 4.1.3). */}
      <span role="status" className="sr-only">
        {entries.isLoading
          ? ''
          : rows.length === 0
            ? 'No journal entries in this period.'
            : countLabel}
      </span>

      {entries.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {!entries.isLoading && rows.length === 0 && (
        <p className="text-sm text-text-secondary">No journal entries in this period.</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="je-table">
              <caption className="sr-only">Date, entry number, description, debit, credit and source per journal entry</caption>
              <thead>
                <tr className="text-left text-xs uppercase tracking-widest text-text-secondary">
                  <th scope="col" className="px-3 py-2">Date</th>
                  <th scope="col" className="px-3 py-2">Entry #</th>
                  <th scope="col" className="px-3 py-2">Description</th>
                  <th scope="col" className="px-3 py-2 text-right">Debit</th>
                  <th scope="col" className="px-3 py-2 text-right">Credit</th>
                  <th scope="col" className="px-3 py-2">Source</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`je-row-${row.entry_number}`}
                    className="border-t border-border-subtle cursor-pointer hover:bg-surface-4"
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
                        // `text-gold` : sans couleur, le déclencheur héritait de
                        // la cellule et ne se distinguait d'un texte statique
                        // qu'au survol SOURIS — invisible au clavier, invisible au
                        // repos. DESIGN.md § Colors donne l'or aux liens, et
                        // `DrilldownLink` porte exactement ce motif depuis la même
                        // branche : 6,222:1 sur la feuille blanche.
                        className={`rounded-sm text-gold underline-offset-2 hover:underline ${FOCUS_RING}`}
                      >
                        {row.entry_number}
                      </button>
                    </td>
                    <td className="px-3 py-2" data-testid={`je-desc-${row.entry_number}`}>
                      {row.description === null || row.description === ''
                        ? '—'
                        : segmentDescription(row.description, names).map((seg) =>
                            seg.uuid === null ? (
                              <Fragment key={seg.key}>{seg.text}</Fragment>
                            ) : (
                              // Le nom REMPLACE l'identifiant, il ne l'efface
                              // pas : le pointillé signale la substitution et le
                              // `title` rend l'original — un comptable qui
                              // rapproche une ligne avec un export en a besoin.
                              <span
                                key={seg.key}
                                title={seg.uuid}
                                className="border-b border-dotted border-border-strong"
                              >
                                {seg.text}
                              </span>
                            ),
                          )}
                    </td>
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

          {/* Le décompte quitte le bandeau de titre pour le pied de table : il
              y annonçait « 200 entries », soit le plafond de la requête pris
              pour un total. L'annonce vocale vit dans la région live toujours
              montée au-dessus de la table, pas ici. */}
          <div className="flex items-center justify-between gap-3 border-t border-border-subtle px-3 py-2">
            <span
              className="font-data text-xs tabular-nums text-text-muted"
              data-testid="je-count"
            >
              {countLabel}
            </span>
            {entries.hasNextPage && (
              // `sm` (36 px) : le cran unique de « Load more » dans tout le
              // back-office.
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => { void entries.fetchNextPage(); }}
                disabled={entries.isFetchingNextPage}
                data-testid="je-load-more"
              >
                {entries.isFetchingNextPage ? 'Loading…' : 'Load more'}
              </Button>
            )}
          </div>
        </div>
      )}

      <JournalEntryDetailDrawer entry={selected} onClose={closeDrawer} />
      {showCreate && (
        <CreateManualJEModal onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
