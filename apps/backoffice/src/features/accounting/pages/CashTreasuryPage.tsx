// apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx
// Cash Wallets module — main treasury page.
// Shows wallet cards, ledger table, reconciliation panel, analysis panel, and CSV export.
import { useMemo, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Card } from '@breakery/ui';
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
// Les deux champs de période rendaient ~29 px (`px-2 py-1`) sans aucun anneau de
// focus, là où DESIGN.md § Champs impose 44 px et l'anneau or. `h-touch-min`
// vaut 44 px dans les deux thèmes (luxe-dark.css) ; c'est la hauteur que porte
// aussi le primitif `Input`, dont ces `<input type="date">` reprennent le reste
// de la spécification (rayon 4 px, `border-border-subtle`, feuille blanche).
import { FOCUS_RING } from '@/components/focusRing.js';

const SMALL_MONEY_FLOAT = 4_000_000;

const monthStart = (): string => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10);
};
const todayISO = (): string => new Date().toISOString().slice(0, 10);

export default function CashTreasuryPage() {
  const { data: wallets = [], isLoading } = useCashWallets();
  const [selected, setSelected]   = useState('1110');
  const [start, setStart]         = useState(monthStart());
  const [end, setEnd]             = useState(todayISO());
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
    <div className="space-y-6 p-6">
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
            className={`h-touch-min rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
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
            className={`h-touch-min rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
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
        <WalletLedgerTable rows={ledger.data ?? []} loading={ledger.isLoading} />
      </Card>

      {selectedWallet && (
        <CashReconciliationPanel wallet={selectedWallet} />
      )}

      <CashAnalysisPanel start={start} end={end} />

      <RecordCashMovementModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </div>
  );
}
