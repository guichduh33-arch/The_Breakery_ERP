// apps/pos/src/features/payment/split/CustomAmountsStep.tsx
// S38 POS-15 — Split flow step for "custom amounts" mode.
//
// LEFT  : list of payers with their currently-entered amount + live header
//         showing Assigned / Total / Remaining.
// RIGHT : numeric input per active payer via Numpad.
//         "Last payer takes remainder" button shortcut.
//         Continue CTA disabled until validateCustomSplit passes.

import { type JSX, useState } from 'react';
import { Numpad, Button, Currency, cn } from '@breakery/ui';
import { validateCustomSplit } from '@breakery/domain';
import { COLOR_CLASSES, type SplitPayer } from './types';

export interface CustomAmountsStepProps {
  payers: SplitPayer[];
  grandTotal: number;
  /** Called when all amounts are valid and the cashier taps Continue. */
  onContinue: (amounts: number[]) => void;
  /** Back to payer count step. */
  onBack: () => void;
}

export function CustomAmountsStep({
  payers,
  grandTotal,
  onContinue,
  onBack,
}: CustomAmountsStepProps): JSX.Element {
  // Raw string amounts per payer index (numpad-style input).
  const [amountStrs, setAmountStrs] = useState<string[]>(() =>
    payers.map(() => ''),
  );
  const [activeIdx, setActiveIdx] = useState<number>(0);

  const amounts = amountStrs.map((s) => Number(s) || 0);
  const assigned = amounts.reduce((a, b) => a + b, 0);
  const remaining = grandTotal - assigned;

  const validation = validateCustomSplit(grandTotal, amounts);

  function handleNumpad(value: string) {
    setAmountStrs((prev) => {
      const next = [...prev];
      next[activeIdx] = value;
      return next;
    });
  }

  function handleLastRemainder() {
    setAmountStrs((prev) => {
      const next = [...prev];
      const lastIdx = payers.length - 1;
      const othersSum = next.slice(0, lastIdx).reduce((s, v) => s + (Number(v) || 0), 0);
      const rem = grandTotal - othersSum;
      next[lastIdx] = rem > 0 ? String(rem) : '0';
      return next;
    });
    setActiveIdx(payers.length - 1);
  }

  return (
    <div
      data-testid="split-custom-amounts"
      className="flex-1 grid grid-cols-[280px_1fr] gap-px bg-border-subtle overflow-hidden"
    >
      {/* LEFT — payer list + live totals */}
      <aside className="bg-bg-base p-5 overflow-y-auto flex flex-col">
        {/* Live header */}
        <div className="mb-4 space-y-1 text-xs">
          <div className="flex justify-between text-text-secondary">
            <span>Assigned</span>
            <Currency amount={assigned} className="font-mono" />
          </div>
          <div className="flex justify-between text-text-secondary">
            <span>Total</span>
            <Currency amount={grandTotal} emphasis="gold" />
          </div>
          <div className="flex justify-between font-semibold">
            <span className="text-text-primary">Remaining</span>
            <Currency
              amount={Math.abs(remaining)}
              className={remaining < 0 ? 'text-red-fg' : remaining > 0 ? 'text-text-primary' : 'text-success'}
            />
          </div>
        </div>

        <h3 className="text-xs uppercase tracking-widest text-gold mb-3">Payers</h3>
        <ul className="space-y-2 flex-1">
          {payers.map((p, i) => {
            const colors = COLOR_CLASSES[p.color];
            const isActive = i === activeIdx;
            const amt = amounts[i] ?? 0;
            return (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setActiveIdx(i)}
                  className={cn(
                    'w-full rounded-md border p-3 text-left transition-colors',
                    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                    isActive
                      ? cn(colors.bg, colors.border, 'border-2')
                      : 'bg-bg-elevated border-border-subtle hover:border-gold/60',
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={cn('h-2 w-2 rounded-full shrink-0', colors.dot)} aria-hidden />
                      <span className={cn('text-sm font-semibold truncate', colors.text)}>
                        {p.label}
                      </span>
                    </div>
                    <Currency
                      amount={amt}
                      className={cn('font-mono text-sm shrink-0', amt > 0 ? colors.text : 'text-text-muted')}
                    />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {/* Last payer remainder shortcut */}
        <Button
          variant="ghost"
          size="sm"
          className="mt-4 w-full text-xs"
          onClick={handleLastRemainder}
          data-testid="split-custom-remainder"
        >
          Last payer takes remainder
        </Button>
      </aside>

      {/* RIGHT — numpad for active payer */}
      <section className="bg-bg-base p-6 overflow-y-auto flex flex-col gap-5">
        {/* Active payer header */}
        <div className="text-center">
          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-bold uppercase tracking-widest',
              COLOR_CLASSES[payers[activeIdx]!.color].bg,
              COLOR_CLASSES[payers[activeIdx]!.color].border,
              COLOR_CLASSES[payers[activeIdx]!.color].text,
            )}
          >
            <span
              className={cn('h-2 w-2 rounded-full', COLOR_CLASSES[payers[activeIdx]!.color].dot)}
              aria-hidden
            />
            {payers[activeIdx]!.label}
          </span>
        </div>

        {/* Amount display */}
        <div className="bg-bg-input border-2 border-gold rounded-md py-6 text-center">
          <span className="font-mono tabular-nums text-3xl text-text-primary">
            Rp {(amountStrs[activeIdx] ?? '') || '0'}
          </span>
        </div>

        {/* Numpad */}
        <Numpad
          value={amountStrs[activeIdx] ?? ''}
          onChange={handleNumpad}
        />

        {/* Back + Continue footer */}
        <div className="mt-auto flex gap-3">
          <Button variant="ghost" onClick={onBack} className="flex-1">
            Back
          </Button>
          <Button
            variant="gold"
            size="lg"
            className="flex-2 uppercase tracking-widest"
            disabled={!validation.ok}
            onClick={() => {
              if (validation.ok) onContinue(amounts);
            }}
            data-testid="split-custom-continue"
          >
            Continue
          </Button>
        </div>
      </section>
    </div>
  );
}
