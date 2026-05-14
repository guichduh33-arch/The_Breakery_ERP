// apps/pos/src/features/payment/split/PerPayerCashStep.tsx
//
// Session 14 / Phase 2.C — Split flow step 4 (ref 95).
//
// Same shell as PerPayerMethodStep (payer list on left) but the RIGHT
// column shows the cash entry sub-panel : ENTER AMOUNT display, AMOUNT
// RECEIVED preset grid, CASH RECEIVED numpad, and gold "CONFIRM" CTA.
//
// Routes back to PerPayerMethodStep via `onBack` so the cashier can change
// method or jump to another payer without losing typed digits.

import type { JSX } from 'react';
import { ArrowLeft } from 'lucide-react';
import { Button, Currency, Numpad, cn } from '@breakery/ui';
import type { CartItem } from '@breakery/domain';
import { COLOR_CLASSES, type SplitPayer } from './types';
import { payerSubtotal } from './ItemAssignStep';

const QUICK_AMOUNTS = [50_000, 100_000, 150_000, 200_000, 500_000];

export interface PerPayerCashStepProps {
  payers: SplitPayer[];
  cartItems: readonly CartItem[];
  grandTotal: number;
  activePayerId: string;
  onSetActivePayer: (id: string) => void;
  onCashChange: (payerId: string, value: string) => void;
  onConfirmPayer: (payerId: string) => void;
  onBackToMethod: () => void;
}

export function PerPayerCashStep({
  payers,
  cartItems,
  grandTotal,
  activePayerId,
  onSetActivePayer,
  onCashChange,
  onConfirmPayer,
  onBackToMethod,
}: PerPayerCashStepProps): JSX.Element {
  const activePayer = payers.find((p) => p.id === activePayerId) ?? payers[0]!;
  const activeColors = COLOR_CLASSES[activePayer.color];
  const total = payerSubtotal(activePayer, cartItems);
  const received = Number(activePayer.cashReceivedStr || '0');
  const change = Math.max(0, received - total);
  const canConfirm = received >= total && !activePayer.confirmed;

  const paid = payers.filter((p) => p.confirmed).reduce((s, p) => s + payerSubtotal(p, cartItems), 0);
  const remaining = Math.max(0, grandTotal - paid);

  return (
    <div className="flex-1 grid grid-cols-[280px_1fr] gap-px bg-border-subtle overflow-hidden" data-testid="split-per-payer-cash">
      {/* LEFT — payer list */}
      <aside className="bg-bg-base p-5 overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-xs uppercase tracking-widest text-gold">Payers</h3>
          <Button variant="ghost" size="sm" onClick={onBackToMethod}>
            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" aria-hidden />
            Method
          </Button>
        </div>
        <ul className="space-y-2">
          {payers.map((p) => {
            const colors = COLOR_CLASSES[p.color];
            const isActive = p.id === activePayer.id;
            const sub = payerSubtotal(p, cartItems);
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => onSetActivePayer(p.id)}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors',
                    isActive ? cn(colors.bg, colors.border, 'border-2') : 'bg-bg-elevated border-border-subtle hover:border-gold/60',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={cn('h-2 w-2 rounded-full', colors.dot)} aria-hidden />
                      <span className={cn('text-sm font-semibold', colors.text)}>{p.label}</span>
                      {p.confirmed && (
                        <span className="text-[10px] uppercase tracking-widest text-green-400">paid</span>
                      )}
                    </div>
                    <Currency amount={sub} className={cn('font-mono text-sm', colors.text)} />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="mt-4 pt-4 border-t border-border-subtle space-y-1.5 text-xs">
          <div className="flex justify-between text-text-secondary">
            <span>Paid</span>
            <Currency amount={paid} className="text-green-400" />
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

      {/* RIGHT — cash entry */}
      <section className="bg-bg-base p-6 overflow-y-auto flex flex-col gap-5">
        {/* Header chip */}
        <div className="text-center">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-1 text-xs font-bold uppercase tracking-widest',
              activeColors.bg,
              activeColors.border,
              activeColors.text,
            )}
          >
            <span className={cn('h-2 w-2 rounded-full', activeColors.dot)} aria-hidden />
            {activePayer.label}
          </span>
          <Currency amount={total} className={cn('text-2xl block mt-1', activeColors.text)} />
          <div className="text-[11px] uppercase tracking-widest text-text-muted">
            {activePayer.items.reduce((s, a) => s + a.quantity, 0)} items
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6">
          {/* Enter amount display */}
          <div>
            <div className="text-xs uppercase tracking-widest text-gold mb-2">Enter Amount</div>
            <div className="bg-bg-input border-2 border-gold rounded-md py-6 text-center">
              <span className="font-mono tabular-nums text-3xl text-text-primary">
                Rp {activePayer.cashReceivedStr || '0'}
              </span>
            </div>
            {change > 0 && (
              <div className="mt-2 text-xs text-right text-text-secondary">
                Change: <Currency amount={change} className="text-gold" />
              </div>
            )}
            {/* Preset grid */}
            <div className="mt-4 space-y-2">
              <div className="text-xs uppercase tracking-widest text-gold">Amount Received</div>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => onCashChange(activePayer.id, String(total))}
                  className={cn(
                    'rounded-md py-3 text-xs font-bold uppercase tracking-widest border',
                    received === total
                      ? 'bg-gold text-bg-base border-gold'
                      : 'bg-bg-input border-border-subtle hover:bg-bg-overlay text-text-primary',
                  )}
                >
                  Exact (<Currency amount={total} />)
                </button>
                {QUICK_AMOUNTS.filter((q) => q >= total).slice(0, 5).map((q) => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => onCashChange(activePayer.id, String(q))}
                    className="rounded-md py-3 text-xs font-mono tabular-nums bg-bg-input border border-border-subtle hover:bg-bg-overlay text-text-primary"
                  >
                    <Currency amount={q} />
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Numpad */}
          <div>
            <div className="text-xs uppercase tracking-widest text-gold mb-2">Cash Received</div>
            <div className="bg-bg-input border border-border-subtle rounded-md px-4 py-3 mb-3 text-right">
              <span className="font-mono tabular-nums text-2xl text-text-primary">
                {activePayer.cashReceivedStr || '0'}
              </span>
            </div>
            <Numpad
              value={activePayer.cashReceivedStr}
              onChange={(v) => onCashChange(activePayer.id, v)}
            />
          </div>
        </div>

        <Button
          variant="gold"
          size="lg"
          className="w-full uppercase tracking-widest mt-auto"
          disabled={!canConfirm}
          onClick={() => onConfirmPayer(activePayer.id)}
          data-testid={`split-confirm-cash-${activePayer.id}`}
        >
          {activePayer.confirmed ? 'Already confirmed' : `Confirm ${activePayer.label} payment`}
        </Button>
      </section>
    </div>
  );
}
