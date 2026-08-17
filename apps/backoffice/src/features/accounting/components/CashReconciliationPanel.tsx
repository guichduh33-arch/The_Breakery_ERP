// apps/backoffice/src/features/accounting/components/CashReconciliationPanel.tsx
// Cash Wallets module — "counted vs GL" reconciliation panel.
// One-click adjustment: posts an adjustment_gain (counted > GL) or adjustment_loss (counted < GL)
// via useRecordCashMovement, which creates a balanced JE.
import { useState } from 'react';
import { Card, Button } from '@breakery/ui';
import type { WalletBalance } from '../hooks/useCashWallets.js';
import { useRecordCashMovement } from '../hooks/useRecordCashMovement.js';
import { useAuthStore } from '@/stores/authStore.js';

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

const todayISO = (): string => new Date().toISOString().slice(0, 10);

export function CashReconciliationPanel({ wallet }: { wallet: WalletBalance }) {
  const canAdjust = useAuthStore((s) => s.hasPermission('accounting.cash.adjust'));
  const [counted, setCounted] = useState('');
  const mut = useRecordCashMovement();
  const diff = counted === '' ? 0 : Number(counted) - wallet.balance;

  const book = () => {
    if (diff === 0) return;
    mut.mutate(
      {
        movementType: diff > 0 ? 'adjustment_gain' : 'adjustment_loss',
        amount: Math.abs(diff),
        movementDate: todayISO(),
        remark: `Reconciliation ${wallet.account_code}: counted ${counted} vs GL ${wallet.balance}`,
        walletCode: wallet.account_code as '1110' | '1111' | '1117',
      },
      { onSuccess: () => setCounted('') },
    );
  };

  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-medium">Reconcile {wallet.account_name}</h3>
      <div className="text-sm text-text-muted">GL balance: {idr.format(wallet.balance)}</div>
      {/* Le `placeholder` portait déjà le bon texte — mais il s'efface à la
          première frappe, et ce champ décide d'un écart de caisse imputé au
          grand livre. Promu en `<label>` persistant (WCAG 1.3.1 / 4.1.2). */}
      <label
        htmlFor={`cash-counted-${wallet.account_code}`}
        className="block text-xs uppercase tracking-widest text-text-secondary"
      >
        Counted (physical)
      </label>
      <input
        id={`cash-counted-${wallet.account_code}`}
        type="number"
        value={counted}
        onChange={(e) => setCounted(e.target.value)}
        className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm"
      />
      {counted !== '' && (
        <div className={`text-sm ${diff === 0 ? 'text-success' : 'text-warning'}`}>
          Difference: {idr.format(diff)}
        </div>
      )}
      {mut.isError && (
        <p className="text-sm text-danger" role="alert">{(mut.error).message}</p>
      )}
      {/* `secondary`, pas `ink` : ce panneau vit sur CashTreasuryPage, dont le
        * bandeau porte déjà « New movement » en encre. Le bouton était encre et
        * DÉSACTIVÉ tant que l'écart valait zéro — donc neutralisé, invisible
        * comme aplat — mais il redevenait un second #201d19 dès qu'un écart
        * apparaissait, c'est-à-dire exactement quand la page compte. The One
        * Ink Fill Rule ne se mesure pas sur l'état au repos. */}
      <Button
        variant="secondary"
        size="sm"
        disabled={diff === 0 || mut.isPending || !canAdjust}
        onClick={book}
      >
        {diff === 0 ? 'Balanced' : `Book ${diff > 0 ? 'overage' : 'shortage'}`}
      </Button>
      {!canAdjust && (
        <p className="text-xs text-text-muted">Requires cash-adjust permission</p>
      )}
    </Card>
  );
}
