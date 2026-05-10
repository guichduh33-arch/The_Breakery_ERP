// packages/ui/src/components/TenderRow.tsx
// Session 10 — display a single applied tender (chip-style row).
//
// Used by TenderListBuilder inside PaymentTerminal RIGHT panel. The tender object
// is the same Tender type used by the cart store; this component is purely visual.

import { Banknote, CreditCard, QrCode, Smartphone, ArrowRightLeft, Wallet, X } from 'lucide-react';
import type { JSX, ForwardRefExoticComponent, RefAttributes } from 'react';
import type { LucideProps } from 'lucide-react';
import { Currency } from './Currency.js';
import { cn } from '../lib/cn.js';

type IconComponent = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

export type TenderRowMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';

const METHOD_META: Record<TenderRowMethod, { label: string; icon: IconComponent }> = {
  cash:         { label: 'Cash',         icon: Banknote },
  card:         { label: 'Card',         icon: CreditCard },
  qris:         { label: 'QRIS',         icon: QrCode },
  edc:          { label: 'EDC',          icon: Smartphone },
  transfer:     { label: 'Transfer',     icon: ArrowRightLeft },
  store_credit: { label: 'Store Credit', icon: Wallet },
};

export interface TenderRowProps {
  method: TenderRowMethod;
  amount: number;
  /** Cash overpay marker — when set, shows the "/ change" suffix. */
  cashReceived?: number;
  changeGiven?: number;
  /** When set, renders the remove X button. */
  onRemove?: () => void;
  className?: string;
}

export function TenderRow({
  method,
  amount,
  cashReceived,
  changeGiven,
  onRemove,
  className,
}: TenderRowProps): JSX.Element {
  const meta = METHOD_META[method];
  const Icon = meta.icon;
  const hasOverpay = cashReceived !== undefined && cashReceived > amount;

  return (
    <div
      data-testid="tender-row"
      className={cn(
        'flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-input px-3 py-2',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-gold" aria-hidden />
        <span className="text-xs uppercase tracking-wide font-semibold text-text-primary">
          {meta.label}
        </span>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <Currency amount={amount} className="text-text-primary" />
          {hasOverpay && (
            <div className="text-[10px] uppercase tracking-wide text-text-secondary">
              recv <Currency amount={cashReceived!} className="text-text-secondary" />
              {changeGiven !== undefined && changeGiven > 0 && (
                <> · chg <Currency amount={changeGiven} className="text-text-secondary" /></>
              )}
            </div>
          )}
        </div>
        {onRemove && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${meta.label} tender`}
            className="text-text-secondary hover:text-text-primary"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
