// apps/pos/src/features/payment/components/QuickPayRow.tsx
// Iso-behaviour extraction of PaymentTerminal's quick-pay row.
// data-testids `pay-cash-exact` / `pay-split-entry` preserved.

import { Users } from 'lucide-react';
import type { PaymentMethod } from '@breakery/domain';
import { formatLabel } from '../format';

export interface QuickPayRowProps {
  fastPathReady: boolean;
  isCashDraft: boolean;
  selectedMethod: PaymentMethod | null;
  total: number;
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
  checkoutPending,
  cartEmpty,
  onProcess,
  onSplitOpen,
}: QuickPayRowProps) {
  return (
    <div className="flex items-stretch gap-3 mb-5">
      {fastPathReady ? (
        <button
          type="button"
          onClick={onProcess}
          disabled={checkoutPending}
          data-testid="pay-cash-exact"
          className="flex-1 h-14 rounded-md bg-green hover:bg-green-hover active:bg-green-pressed text-white font-bold uppercase tracking-widest text-sm transition-[background-color,transform] duration-fast ease-motion-out active:scale-[0.98] motion-reduce:active:scale-100 disabled:opacity-60"
        >
          {checkoutPending
            ? 'Processing…'
            : `${isCashDraft ? 'Cash' : selectedMethod?.toUpperCase()} Exact — ${formatLabel(total)}`}
        </button>
      ) : (
        <div className="flex-1 h-14 rounded-md border border-dashed border-border-subtle grid place-items-center text-text-muted text-xs uppercase tracking-widest">
          Select a method to proceed
        </div>
      )}
      <button
        type="button"
        onClick={onSplitOpen}
        disabled={cartEmpty || checkoutPending}
        data-testid="pay-split-entry"
        className="h-14 px-4 rounded-md border border-info/50 bg-info-soft text-info font-bold uppercase tracking-widest text-xs hover:bg-info/15 transition-[background-color,transform] duration-fast ease-motion-out active:scale-[0.97] motion-reduce:active:scale-100 disabled:opacity-40 inline-flex items-center gap-2"
      >
        <Users className="h-3.5 w-3.5" aria-hidden />
        Split by Item
      </button>
    </div>
  );
}
