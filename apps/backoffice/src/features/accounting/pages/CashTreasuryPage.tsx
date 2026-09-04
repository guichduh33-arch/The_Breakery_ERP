// apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx
// Cash Wallets module — main treasury page.
// Shows wallet cards, ledger table, reconciliation panel, analysis panel, and CSV export.
import { useMemo, useState } from 'react';
import { Plus, ChevronRight } from 'lucide-react';
import { Button, Card } from '@breakery/ui';
import { monthStartIsoDate, todayIsoDate } from '@breakery/utils';
import { TOOLBAR_BTN_PRIMARY, TOOLBAR_ICON } from '@/components/toolbarButton.js';
import { useCashWallets } from '../hooks/useCashWallets.js';
import { useCashWalletLedger } from '../hooks/useCashWalletLedger.js';
import { WalletCard } from '../components/WalletCard.js';
import { WalletLedgerTable } from '../components/WalletLedgerTable.js';
import { RecordCashMovementModal } from '../components/RecordCashMovementModal.js';
import { CashReconciliationPanel } from '../components/CashReconciliationPanel.js';
import { CashAnalysisPanel } from '../components/CashAnalysisPanel.js';
import { exportCashWalletCsv } from '../components/exportCashWalletCsv.js';
import { PageHeader } from '@/components/PageHeader.js';
import { QueryErrorBanner } from '@/components/QueryErrorBanner.js';
import { errorDetailText } from '@/components/errorDetailText.js';
// Les deux champs de période rendaient ~29 px (`px-2 py-1`) sans aucun anneau de
// focus. Ils ont d'abord été portés à 44 px ; c'était le mauvais cran. DESIGN.md
// § Champs n'en déclare que DEUX et les assigne par RÔLE : 44 px au champ de
// formulaire, 36 px (`h-9`) au champ EN LIGNE — barre de filtres, sélecteur de
// période, ce qu'est exactement cette paire. Le reste de la spécification vient
// du primitif `Input` (rayon 4 px, feuille blanche, anneau or).
import { FOCUS_RING } from '@/components/focusRing.js';

const SMALL_MONEY_FLOAT = 4_000_000;

export default function CashTreasuryPage() {
  // La requête entière, plus seulement ses données : son échec n'était rendu
  // NULLE PART. Un `get_cash_wallet_balances_v2` refusé (permission, réseau)
  // laissait la rangée de tuiles vide sous un titre « Cash Treasury », ce qui se
  // lit « aucun coffre » — l'écran affirmait alors qu'il n'y a pas d'argent.
  const walletsQuery = useCashWallets();
  // `useMemo` et non un `??` nu : le tableau de repli serait une NOUVELLE
  // référence à chaque rendu, et la mémoïsation de `ordered` juste en dessous
  // ne tiendrait plus (react-hooks/exhaustive-deps).
  const wallets = useMemo(() => walletsQuery.data ?? [], [walletsQuery.data]);
  const isLoading = walletsQuery.isLoading;
  const walletsError = walletsQuery.isError ? walletsQuery.error : null;
  const [selected, setSelected]   = useState('1110');
  // Défaut MUTUALISÉ (`@breakery/utils`) — cinquième copie du même calcul local,
  // et du même défaut : `toISOString()` rend de l'UTC, donc le ledger s'ouvrait
  // sur la veille entre minuit et 08 h WITA, soit précisément l'heure où l'on
  // rapproche une caisse fermée.
  const [start, setStart]         = useState(monthStartIsoDate());
  const [end, setEnd]             = useState(todayIsoDate());
  const [modalOpen, setModalOpen] = useState(false);

  const ledger = useCashWalletLedger(selected, start, end);

  const ordered = useMemo(
    () =>
      ['1110', '1111', '1117']
        .map((c) => wallets.find((w) => w.account_code === c))
        .filter(Boolean) as typeof wallets,
    [wallets],
  );

  const selectedWallet = ordered.find((w) => w.account_code === selected);

  return (
    // Le `<main>` du shell pose DÉJÀ `px-[22px] py-5` : le `p-6` d'ici s'y
    // ajoutait, et cette page rendait donc une gouttière de ~46 px là où ses
    // quatre sœurs du module accounting en rendent 22.
    <div className="space-y-6">
      {/* Critique 2026-08-31 — comptabilité et inventaire étaient les seuls
          domaines sans fil d'Ariane. Motif recopié d'OrdersListPage, en ligne :
          en extraire un composant partagé serait une décision d'architecture. */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-1 text-xs text-text-muted">
        <span>Finance</span>
        <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
        <span className="text-text-secondary">Cash treasury</span>
      </nav>

      <PageHeader
        className="items-center"
        title="Cash Treasury"
        // Le bandeau de page prend `TOOLBAR_BTN_*` — c'est SON contrat
        // (DESIGN.md § Components : « Bouton de bandeau de page », 32 px,
        // rayon 3 px), contrairement aux boutons de panneau qui, eux, prennent
        // le primitif partagé. Le primitif rendait ici 56 px : la hauteur
        // canonique de 32 px n'apparaissait nulle part sur la page, qui
        // cumulait trois hauteurs différentes.
        actions={
          <button type="button" className={TOOLBAR_BTN_PRIMARY} onClick={() => setModalOpen(true)}>
            <Plus className={TOOLBAR_ICON} aria-hidden />
            New movement
          </button>
        }
      />

      {walletsError !== null && (
        <QueryErrorBanner
          detail={errorDetailText(walletsError)}
          onRetry={() => { void walletsQuery.refetch(); }}
          data-testid="cash-wallets-error"
        >
          Wallet balances could not be loaded — no balance below is current, and
          the ledger cannot be opened until this request succeeds.
        </QueryErrorBanner>
      )}

      <div className="flex flex-wrap gap-3">
        {isLoading && (
          <span className="text-sm text-text-muted">Loading wallets…</span>
        )}
        {ordered.map((w) => (
          <WalletCard
            key={w.account_code}
            wallet={w}
            selected={selected === w.account_code}
            onSelect={() => setSelected(w.account_code)}
            fixedFloat={w.account_code === '1117' ? SMALL_MONEY_FLOAT : undefined}
          />
        ))}
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3 mb-3 text-sm flex-wrap">
          {/* Deux dates nues séparées d'une flèche : rien ne disait laquelle
              borne le début. La flèche est décorative — elle ne porte le sens
              que pour l'œil, et disparaît de la lecture vocale. Les libellés
              sont donc VISIBLES (WCAG 1.3.1 / 4.1.2, niveau A) : ils servent
              aussi le lecteur voyant qui revient sur l'écran. */}
          <label htmlFor="treasury-range-from" className="text-xs uppercase tracking-widest text-text-secondary">
            From
          </label>
          <input
            id="treasury-range-from"
            type="date" lang="id-ID"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
          />
          <span aria-hidden="true">→</span>
          <label htmlFor="treasury-range-to" className="text-xs uppercase tracking-widest text-text-secondary">
            To
          </label>
          <input
            id="treasury-range-to"
            type="date" lang="id-ID"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className={`h-9 rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
          />
          <Button
            variant="secondary"
            size="sm"
            onClick={() =>
              exportCashWalletCsv(
                ledger.data ?? [],
                selectedWallet?.account_name ?? 'wallet',
              )
            }
          >
            Export CSV
          </Button>
        </div>
        <WalletLedgerTable
          rows={ledger.data ?? []}
          loading={ledger.isLoading}
          error={ledger.isError ? errorDetailText(ledger.error) ?? '' : null}
          onRetry={() => { void ledger.refetch(); }}
        />
      </Card>

      {selectedWallet && (
        <CashReconciliationPanel wallet={selectedWallet} />
      )}

      <CashAnalysisPanel start={start} end={end} />

      <RecordCashMovementModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
