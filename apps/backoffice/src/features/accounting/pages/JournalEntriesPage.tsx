// apps/backoffice/src/features/accounting/pages/JournalEntriesPage.tsx
// Session 26b / Wave 2.B — Journal entries cockpit page.
// Gate route : accounting.gl.read ; "+ New manual JE" gated par accounting.je.create_manual.

import { useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { Button, Input, Select, SectionLabel, useDebouncedValue } from '@breakery/ui';
import { formatCurrency, monthStartIsoDate, todayIsoDate } from '@breakery/utils';
import { Plus, ChevronRight } from 'lucide-react';
import {
  useJournalEntries,
  type JournalEntryRow,
} from '@/features/accounting/hooks/useJournalEntries.js';
import { useEntityNames } from '@/features/accounting/hooks/useEntityNames.js';
import { usePostableAccounts } from '@/features/accounting/hooks/usePostableAccounts.js';
import { collectUuids } from '@/features/accounting/utils/journalDescription.js';
import { JOURNAL_SOURCE_OPTIONS } from '@/features/accounting/utils/journalSources.js';
import { ResolvedDescription } from '@/features/accounting/components/ResolvedDescription.js';
import { JournalEntryDetailDrawer } from '@/features/accounting/components/JournalEntryDetailDrawer.js';
import { CreateManualJEModal } from '@/features/accounting/components/CreateManualJEModal.js';
import { useAuthStore } from '@/stores/authStore.js';
import { useListParams } from '@/hooks/useListParams.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { TOOLBAR_BTN_PRIMARY } from '@/components/toolbarButton.js';

const fmt = formatCurrency;
const num = (n: number): string => n.toLocaleString('id-ID');

const JE_HEAD: readonly { label: string; right: boolean }[] = [
  { label: 'Date',        right: false },
  { label: 'Entry #',     right: false },
  { label: 'Description', right: false },
  { label: 'Debit',       right: true  },
  { label: 'Credit',      right: true  },
  { label: 'Source',      right: false },
];

const CREATE_JE_REASON =
  'You need the accounting.je.create_manual permission to post a manual journal entry.';

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
  //
  // Le défaut vient des helpers de `@breakery/utils`, pas d'un calcul local :
  // les quatre écrans comptables et le hub qui les précharge doivent tomber sur
  // la MÊME chaîne, faute de quoi la clé de requête du hub et celle de l'écran
  // divergent et le clic repaie l'aller-retour. Ils sortent du fuseau métier —
  // un calcul local rendait la veille entre minuit et 08 h WITA.
  const [params, patchParams] = useListParams();
  const startDate = params.get('start') ?? monthStartIsoDate();
  const endDate   = params.get('end')   ?? todayIsoDate();

  // Les trois filtres nés de la critique du 2026-08-26 : 591 écritures ne se
  // filtraient QUE par date, sur l'écran le plus fréquenté du comptable. Ils
  // vivent dans l'URL comme les bornes, et pour la même raison : un filtre qui
  // se partage et survit au retour arrière.
  const sourceFilter  = params.get('source')  ?? '';
  const accountFilter = params.get('account') ?? '';
  const urlSearch     = params.get('q')       ?? '';

  // La saisie vit en local et l'URL ne reçoit que la valeur POSÉE (250 ms,
  // le cran du Command Palette) : écrire l'URL à la frappe déclencherait une
  // requête par touche.
  const [searchInput, setSearchInput] = useState(urlSearch);
  const debouncedSearch = useDebouncedValue(searchInput, 250);
  // `patchParams` se referme sur `setSearchParams`, dont react-router refait
  // l'identité à CHAQUE navigation : sans garde, régler la source ou le compte
  // relançait cet effet et ré-émettait un `navigate` replace pour une valeur de
  // `q` inchangée. La comparaison passe par une réf plutôt que par une
  // dépendance : mettre `q` dans les deps ferait repousser la saisie locale
  // par-dessus un `q` arrivé du bouton Retour.
  const urlSearchRef = useRef(urlSearch);
  urlSearchRef.current = urlSearch;
  useEffect(() => {
    const next = debouncedSearch.trim();
    if (urlSearchRef.current === next) return;
    patchParams({ q: next === '' ? null : next });
  }, [debouncedSearch, patchParams]);

  const accounts = usePostableAccounts();
  // Une valeur d'URL hors liste (émetteur plus récent que la liste, compte
  // désactivé) reste sélectionnable telle quelle : un filtre posé ne doit
  // jamais devenir irreprésentable, il se retire, il ne disparaît pas.
  const sourceUnknown = sourceFilter !== ''
    && !JOURNAL_SOURCE_OPTIONS.some((o) => o.value === sourceFilter);
  const accountUnknown = accountFilter !== ''
    && accounts.data !== undefined
    && !accounts.data.some((a) => a.id === accountFilter);

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

  const entries = useJournalEntries({
    startDate,
    endDate,
    search:        urlSearch,
    referenceType: sourceFilter,
    accountId:     accountFilter,
  });
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

  // Quand la requête échoue, la page annonçait « No journal entries in this
  // period. » — la phrase la plus dangereuse qu'un écran comptable puisse
  // rendre : elle affirme un FAIT sur le grand livre là où le serveur n'a rien
  // répondu, et un comptable qui la croit clôture sur une période qu'il pense
  // vide. On sort donc le bandeau de la flotte (Products, OrdersListPage) et
  // l'état vide se tait tant qu'il y a une erreur.
  const listError = entries.isError ? entries.error : null;

  // « X loaded of Y », jamais un plafond présenté comme un total. Quand tout est
  // chargé la phrase redevient un simple décompte : « 12 loaded of 12 » se lit
  // comme une liste tronquée alors qu'elle est complète.
  const countLabel =
    total === null      ? `${num(rows.length)} loaded`
    : rows.length >= total ? `${num(total)} ${total === 1 ? 'entry' : 'entries'}`
    : `${num(rows.length)} loaded of ${num(total)}`;

  // Le vide d'une PÉRIODE et le vide d'un FILTRE ne disent pas la même chose :
  // le premier est un fait sur le grand livre, le second invite à élargir.
  const refined = urlSearch !== '' || sourceFilter !== '' || accountFilter !== '';
  const emptyLabel = refined
    ? 'No journal entries match these filters.'
    : 'No journal entries in this period.';

  return (
    <div className="space-y-6">
      {/* Critique 2026-08-31 — comptabilité et inventaire étaient les seuls
          domaines sans fil d'Ariane. Motif recopié d'OrdersListPage, en ligne :
          en extraire un composant partagé serait une décision d'architecture. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Finance</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Journal entries</span>
      </nav>

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
            {/* Bandeau de page = `TOOLBAR_BTN_*` (32 px), pas le primitif partagé
                (56 px) : c'est le contrat du bandeau (DESIGN.md § Components).
                L'aplat encre est l'UNIQUE de ce bandeau — c'est l'action qui crée.
                La raison du refus reste doublée (`title` + `aria-describedby`),
                un `<button disabled>` n'étant pas focalisable. */}
            <button
              type="button"
              className={TOOLBAR_BTN_PRIMARY}
              onClick={() => setShowCreate(true)}
              disabled={!canCreate}
              {...(canCreate ? {} : { title: CREATE_JE_REASON, 'aria-describedby': 'je-create-reason' })}
              data-testid="je-new-btn"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              New manual JE
            </button>
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
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Search
          <Input
            type="search"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Description or entry #"
            className="mt-1 w-56"
            data-testid="je-filter-search"
          />
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Source
          <Select
            value={sourceFilter}
            onChange={(e) => { patchParams({ source: e.target.value }); }}
            className="mt-1"
            data-testid="je-filter-source"
          >
            <option value="">All sources</option>
            {JOURNAL_SOURCE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
            {sourceUnknown && <option value={sourceFilter}>{sourceFilter}</option>}
          </Select>
        </label>
        <label className="flex flex-col text-xs uppercase tracking-widest text-text-secondary">
          Account
          <Select
            value={accountFilter}
            onChange={(e) => { patchParams({ account: e.target.value }); }}
            className="mt-1 max-w-64"
            data-testid="je-filter-account"
          >
            <option value="">All accounts</option>
            {(accounts.data ?? []).map((a) => (
              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
            ))}
            {accountUnknown && <option value={accountFilter}>{accountFilter}</option>}
          </Select>
        </label>
      </div>

      {/* Région live UNIQUE et toujours montée : le pied de table se démonte
          quand la liste se vide, donc un `role="status"` qui n'y vivrait que
          là ne pourrait jamais annoncer la transition vers zéro — le seul
          moment où l'annonce sert (WCAG 4.1.3). */}
      <span role="status" className="sr-only">
        {entries.isLoading || listError !== null
          ? ''
          : rows.length === 0
            ? emptyLabel
            : countLabel}
      </span>

      {listError !== null && (
        <QueryErrorBanner
          detail={errorDetailText(listError)}
          onRetry={() => { void entries.refetch(); }}
          data-testid="je-error"
        >
          Journal entries could not be loaded — the period may well hold entries
          this request never reached.
        </QueryErrorBanner>
      )}

      {entries.isLoading && <p className="text-sm text-text-secondary">Loading…</p>}

      {/* L'état vide n'est vrai que si le serveur a répondu. */}
      {!entries.isLoading && listError === null && rows.length === 0 && (
        <p className="text-sm text-text-secondary">{emptyLabel}</p>
      )}

      {rows.length > 0 && (
        <div className="rounded-lg border border-border-subtle bg-bg-elevated">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid="je-table">
              <caption className="sr-only">Date, entry number, description, debit, credit and source per journal entry</caption>
              {/* Canon des tableaux (DESIGN.md § Tableaux, patron
                  `WalletLedgerTable`) : en-tête sur papier inerte, libellés en
                  label mono capitales via `SectionLabel`. L'en-tête rendait en
                  Instrument Sans sur fond blanc — indiscernable du corps. */}
              <thead>
                <tr className="border-b border-border-subtle bg-surface-inert text-left">
                  {JE_HEAD.map((h) => (
                    <th
                      key={h.label}
                      scope="col"
                      className={`px-3 py-2.5 font-data ${h.right ? 'text-right' : ''}`}
                    >
                      <SectionLabel as="span" size="xs">{h.label}</SectionLabel>
                    </th>
                  ))}
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
                    <td className="whitespace-nowrap px-3 py-2 font-data tabular-nums">{row.entry_date}</td>
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
                        : <ResolvedDescription text={row.description} names={names} />}
                    </td>
                    {/* `whitespace-nowrap` : sans lui, « Rp 4.850.000 » se coupe
                        au « Rp » dès que la colonne se resserre. */}
                    <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(row.total_debit)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right font-data tabular-nums">{fmt(row.total_credit)}</td>
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
