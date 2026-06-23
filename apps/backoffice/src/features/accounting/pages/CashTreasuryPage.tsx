// apps/backoffice/src/features/accounting/pages/CashTreasuryPage.tsx
// Cash Wallets module — main treasury page.
// Shows wallet cards, ledger table, reconciliation panel, analysis panel, and CSV export.
import { useMemo, useState } from 'react';
import { Button, Card } from '@breakery/ui';
import { useCashWallets } from '../hooks/useCashWallets.js';
import { useCashWalletLedger } from '../hooks/useCashWalletLedger.js';
import { WalletCard } from '../components/WalletCard.js';
import { WalletLedgerTable } from '../components/WalletLedgerTable.js';
import { RecordCashMovementModal } from '../components/RecordCashMovementModal.js';
import { CashReconciliationPanel } from '../components/CashReconciliationPanel.js';
import { CashAnalysisPanel } from '../components/CashAnalysisPanel.js';
import { exportCashWalletCsv } from '../components/exportCashWalletCsv.js';

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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Cash Treasury</h1>
        <Button onClick={() => setModalOpen(true)}>New movement</Button>
      </div>

      <div className="flex flex-wrap gap-3">
        {isLoading && (
          <span className="text-sm text-muted-foreground">Loading wallets…</span>
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
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1"
          />
          <span>→</span>
          <input
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
            className="rounded-md border border-input bg-background px-2 py-1"
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
