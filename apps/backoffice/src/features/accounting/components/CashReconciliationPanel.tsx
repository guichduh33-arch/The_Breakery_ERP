// apps/backoffice/src/features/accounting/components/CashReconciliationPanel.tsx
// Cash Wallets module — "counted vs GL" reconciliation panel.
// One-click adjustment: posts an adjustment_gain (counted > GL) or adjustment_loss (counted < GL)
// via useRecordCashMovement, which creates a balanced JE.
import { useState } from 'react';
import { Card, Button } from '@breakery/ui';
import { todayIsoDate } from '@breakery/utils';
import type { WalletBalance } from '../hooks/useCashWallets.js';
import { useRecordCashMovement } from '../hooks/useRecordCashMovement.js';
import { useAuthStore } from '@/stores/authStore.js';
// Le champ « Counted » rendait ~37 px (`py-2`) sans anneau de focus, contre les
// 44 px et l'anneau or de DESIGN.md § Champs. C'est le champ sur lequel on saisit
// un comptage physique de caisse : `h-touch-min` (44 px) + `FOCUS_RING`.
import { FOCUS_RING } from '@/components/focusRing.js';

// `style: 'currency'`, comme `WalletCard` et `WalletLedgerTable` sur le même
// écran : sans lui, la tuile disait « Rp 14.000.000 » et ce panneau
// « 14.000.000 » pour la même unité, à l'endroit précis où l'on compare un
// comptage physique au grand livre.
const idr = new Intl.NumberFormat('id-ID', {
  style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
});

// La date du mouvement passe par le helper MUTUALISÉ du fuseau métier. Le
// calcul local qu'il remplace — `new Date().toISOString().slice(0, 10)` —
// rendait de l'UTC : entre minuit et 08 h WITA, l'écart de caisse partait au
// grand livre DATÉ DE LA VEILLE. C'est précisément la plage où l'on compte une
// caisse fermée, et une période déjà close refuse l'écriture (ou pire,
// l'accepte et fausse un rapprochement déjà signé). Même famille de bug que
// `monthStartIsoDate`, même remède.

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
        movementDate: todayIsoDate(),
        remark: `Reconciliation ${wallet.account_code}: counted ${counted} vs GL ${wallet.balance}`,
        walletCode: wallet.account_code as '1110' | '1111' | '1117',
      },
      { onSuccess: () => setCounted('') },
    );
  };

  return (
    <Card className="p-4 space-y-2">
      <h3 className="font-medium">Reconcile {wallet.account_name}</h3>
      <div className="text-sm text-text-muted">
        GL balance:{' '}
        <span className="font-data tabular-nums">{idr.format(wallet.balance)}</span>
      </div>
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
        className={`h-touch-min w-full rounded-md border border-border-strong bg-bg-input px-3 text-sm text-text-primary ${FOCUS_RING}`}
      />
      {counted !== '' && (
        <div className={`text-sm ${diff === 0 ? 'text-success' : 'text-warning'}`}>
          Difference:{' '}
          <span className="font-data tabular-nums">{idr.format(diff)}</span>
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
