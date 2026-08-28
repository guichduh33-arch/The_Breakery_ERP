// apps/pos/src/features/payment/components/QuickPayRow.tsx
// Iso-behaviour extraction of PaymentTerminal's quick-pay row.
// data-testids `pay-cash-exact` / `pay-split-entry` preserved.

import { Users } from 'lucide-react';
import type { PaymentMethod } from '@breakery/domain';
import { formatIdr } from '@breakery/utils';
import { METHODS_BY_VALUE } from './paymentMethods';

export interface QuickPayRowProps {
  fastPathReady: boolean;
  isCashDraft: boolean;
  selectedMethod: PaymentMethod | null;
  total: number;
  /** Montant saisi au brouillon (cash) — 0 quand rien n'est saisi. */
  draftAmount: number;
  checkoutPending: boolean;
  cartEmpty: boolean;
  onProcess: () => void;
  onSplitOpen: () => void;
}

export function QuickPayRow({
  fastPathReady,
  isCashDraft,
  selectedMethod,
  total,
  draftAmount,
  checkoutPending,
  cartEmpty,
  onProcess,
  onSplitOpen,
}: QuickPayRowProps) {
  // Critique 2026-08-23 (P2) — le libellé était figé sur `total` : après une
  // saisie cash SUPÉRIEURE à l'exact (Rp 100.000 sur un dû de Rp 70.000), le
  // bouton le plus voyant de l'écran affichait encore « CASH EXACT — RP 70.000 »
  // alors qu'il allait encaisser 100.000 et rendre 30.000. Le bouton dit
  // désormais ce qu'il va faire : montant reçu + monnaie à rendre.
  const cashOverpay = isCashDraft && draftAmount > total;
  // Critique 2026-08-29 (P2) — the raw enum leaked onto the most visible
  // button of the screen (« STORE_CREDIT Exact — Rp… ») : resolve the human
  // label from the method catalog instead of uppercasing the value.
  const methodLabel = selectedMethod
    ? METHODS_BY_VALUE.get(selectedMethod)?.label ?? selectedMethod
    : '';
  const fastPathLabel = cashOverpay
    ? `Cash ${formatIdr(draftAmount)} — Change ${formatIdr(draftAmount - total)}`
    : `${methodLabel} Exact — ${formatIdr(total)}`;
  // Critique run 4 lot 1 (adapt) — « Cash Exact — Rp 4.850.000 » +
  // « Split by Item » ne tiennent pas côte à côte à 390 px : empilés
  // pleine largeur sous md, chacun garde ses 56 px de haut.
  return (
    <div className="flex max-md:flex-col items-stretch gap-3 mb-5">
      {fastPathReady ? (
        <button
          type="button"
          onClick={onProcess}
          disabled={checkoutPending}
          data-testid="pay-cash-exact"
          className="flex-1 h-14 rounded-md bg-green [@media(hover:hover)]:hover:bg-green-hover active:bg-green-pressed text-green-fg font-bold uppercase tracking-widest text-sm transition-[background-color,transform] duration-fast ease-motion-out active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-60 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
        >
          {checkoutPending ? 'Processing…' : fastPathLabel}
        </button>
      ) : (
        <div className="flex-1 h-14 rounded-md border border-dashed border-border-subtle grid place-items-center text-text-muted text-xs uppercase tracking-widest">
          {/* Critique 2026-08-29 (persona Alex) — cash is preselected on open,
              so « Select a method » sent the cashier hunting a problem that
              did not exist : name the actual blocker. */}
          {selectedMethod ? 'Enter the amount to proceed' : 'Select a method to proceed'}
        </div>
      )}
      <button
        type="button"
        onClick={onSplitOpen}
        disabled={cartEmpty || checkoutPending}
        data-testid="pay-split-entry"
        className="h-14 px-4 rounded-md border border-info bg-info-soft text-info font-bold uppercase tracking-widest text-xs [@media(hover:hover)]:hover:border-blue-info transition-[background-color,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-40 inline-flex items-center gap-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        Split by Item
      </button>
    </div>
  );
}
