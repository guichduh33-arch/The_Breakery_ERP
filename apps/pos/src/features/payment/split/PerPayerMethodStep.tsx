// apps/pos/src/features/payment/split/PerPayerMethodStep.tsx
//
// Session 14 / Phase 2.C — Split flow step 3 (ref 94).
//
// LEFT  : "PAYERS" list — sticky cards showing each payer's total + items
//         count + colored chip. The current focused payer is outlined.
//         Already-confirmed payers get a "✓" affordance.
// RIGHT : Header chip (current payer label colored) + their total +
//         "PAYMENT FOR CLIENT N" grid of method tiles. CASH selects it
//         and routes the parent to the per-payer-cash step. Non-cash
//         methods can be confirmed in place (no extra screen).
// FOOT  : Paid / Remaining counters + gold "CONFIRM CLIENT N PAYMENT" CTA.

import type { JSX } from 'react';
import {
  ArrowRightLeft,
  Banknote,
  CreditCard,
  QrCode,
  Smartphone,
  Wallet,
} from 'lucide-react';
import { Button, Currency, cn } from '@breakery/ui';
import type { CartItem, PaymentMethod } from '@breakery/domain';
import type { LucideProps } from 'lucide-react';
import type { ForwardRefExoticComponent, RefAttributes } from 'react';
import { COLOR_CLASSES, type SplitMode, type SplitPayer } from './types';
import { payerSubtotal } from './ItemAssignStep';
import { useEnabledPaymentMethods } from '@/features/settings/hooks/useEnabledPaymentMethods';

/**
 * Effective subtotal for a payer: uses assignedAmount for equal/custom modes,
 * item-based calculation for items mode.
 */
function effectiveSubtotal(payer: SplitPayer, cartItems: readonly CartItem[]): number {
  if (payer.assignedAmount !== undefined) return payer.assignedAmount;
  return payerSubtotal(payer, cartItems);
}

type IconComponent = ForwardRefExoticComponent<Omit<LucideProps, 'ref'> & RefAttributes<SVGSVGElement>>;

interface SplitMethodMeta { value: PaymentMethod; label: string; icon: IconComponent }

const METHODS: SplitMethodMeta[] = [
  { value: 'cash',         label: 'Cash',     icon: Banknote },
  { value: 'card',         label: 'Card',     icon: CreditCard },
  { value: 'qris',         label: 'QRIS',     icon: QrCode },
  { value: 'edc',          label: 'EDC',      icon: Smartphone },
  { value: 'transfer',     label: 'Transfer', icon: ArrowRightLeft },
  { value: 'store_credit', label: 'Store',    icon: Wallet },
];

const METHODS_BY_VALUE = new Map(METHODS.map((m) => [m.value, m]));

export interface PerPayerMethodStepProps {
  payers: SplitPayer[];
  cartItems: readonly CartItem[];
  grandTotal: number;
  activePayerId: string;
  /** Split mode — used to display the correct subtotal (assigned vs. item-based). */
  mode: SplitMode;
  onSetActivePayer: (id: string) => void;
  /** Selecting a method updates the payer's draft method. */
  onPickMethod: (payerId: string, method: PaymentMethod) => void;
  /** Confirm the current payer's payment — parent dispatches checkout step. */
  onConfirmPayer: (payerId: string) => void;
}

export function PerPayerMethodStep({
  payers,
  cartItems,
  grandTotal,
  activePayerId,
  mode: _mode,
  onSetActivePayer,
  onPickMethod,
  onConfirmPayer,
}: PerPayerMethodStepProps): JSX.Element {
  // S64 — only methods enabled in BO Settings render (fail-open = all 6).
  const enabledMethods = useEnabledPaymentMethods();
  const activePayer = payers.find((p) => p.id === activePayerId) ?? payers[0]!;
  const activeColors = COLOR_CLASSES[activePayer.color];
  const activeTotal = effectiveSubtotal(activePayer, cartItems);

  const paid = payers.filter((p) => p.confirmed).reduce((s, p) => s + effectiveSubtotal(p, cartItems), 0);
  const remaining = Math.max(0, grandTotal - paid);

  return (
    <div className="flex-1 grid grid-cols-[280px_1fr] gap-px bg-border-subtle overflow-hidden" data-testid="split-per-payer-method">
      {/* LEFT — payer list */}
      <aside className="bg-bg-base p-5 overflow-y-auto">
        <h3 className="text-xs uppercase tracking-widest text-gold mb-4">Payers</h3>
        <ul className="space-y-2">
          {payers.map((p) => {
            const colors = COLOR_CLASSES[p.color];
            const isActive = p.id === activePayer.id;
            const sub = effectiveSubtotal(p, cartItems);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSetActivePayer(p.id)}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                    isActive
                      ? cn(colors.bg, colors.border, 'border-2')
                      : 'bg-bg-elevated border-border-subtle hover:border-gold/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('h-2 w-2 rounded-full', colors.dot)} aria-hidden />
                      <span className={cn('text-sm font-semibold truncate', colors.text)}>
                        {p.label}
                      </span>
                      {p.confirmed && (
                        <span className="text-[10px] uppercase tracking-widest text-success">paid</span>
                      )}
                    </div>
                    <Currency amount={sub} className={cn('font-mono text-sm', colors.text)} />
                  </div>
                  <div className="mt-1 text-xs text-text-secondary">
                    {p.items.reduce((s, a) => s + a.quantity, 0)} items
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Totals */}
        <div className="mt-4 pt-4 border-t border-border-subtle space-y-1.5 text-xs">
          <div className="flex justify-between text-text-secondary">
            <span>Paid</span>
            <Currency amount={paid} className="text-success" />
          </div>
          <div className="flex justify-between text-text-secondary">
            <span>Remaining</span>
            <Currency amount={remaining} className="text-text-primary" />
          </div>
          <div className="flex justify-between pt-2 border-t border-border-subtle">
            <span className="uppercase tracking-widest font-semibold text-text-primary">Total</span>
            <Currency amount={grandTotal} emphasis="gold" />
          </div>
        </div>
      </aside>

      {/* RIGHT — method picker for active payer */}
      <section className="bg-bg-base p-8 overflow-y-auto flex flex-col">
        <div className="text-center mb-6 space-y-2">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-widest',
              activeColors.bg,
              activeColors.border,
              activeColors.text,
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', activeColors.dot)} aria-hidden />
            {activePayer.label}
          </span>
          <Currency amount={activeTotal} className={cn('text-3xl block', activeColors.text)} />
          {activePayer.assignedAmount === undefined && (
            <div className="text-[11px] uppercase tracking-widest text-text-muted">
              {activePayer.items.reduce((s, a) => s + a.quantity, 0)} items
            </div>
          )}
        </div>

        <h3 className="text-xs uppercase tracking-widest text-gold mb-3">
          Payment for {activePayer.label}
        </h3>

        <div className="grid grid-cols-2 gap-3 mb-6">
          {/* ADR-006 déc. 9 lot A — BO-configured order (Set insertion order). */}
          {[...enabledMethods]
            .map((v) => METHODS_BY_VALUE.get(v))
            .filter((m): m is SplitMethodMeta => m !== undefined)
            .map((m) => {
            const Icon = m.icon;
            const selected = activePayer.method === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => onPickMethod(activePayer.id, m.value)}
                aria-pressed={selected}
                className={cn(
                  'h-16 rounded-md border flex items-center justify-center gap-2 transition-colors',
                  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold',
                  selected
                    ? 'border-gold bg-gold-soft text-gold'
                    : 'border-border-subtle bg-bg-elevated text-text-secondary hover:text-text-primary hover:border-gold/60',
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                <span className="text-xs font-bold uppercase tracking-widest">{m.label}</span>
              </button>
            );
          })}
        </div>

        {/* Confirm CTA */}
        <div className="mt-auto pt-4">
          <Button
            variant="gold"
            size="lg"
            className="w-full uppercase tracking-widest"
            disabled={!activePayer.method || activePayer.confirmed}
            onClick={() => onConfirmPayer(activePayer.id)}
            data-testid={`split-confirm-payer-${activePayer.id}`}
          >
            {activePayer.confirmed ? 'Already confirmed' : `Confirm ${activePayer.label} payment`}
          </Button>
        </div>
      </section>
    </div>
  );
}
