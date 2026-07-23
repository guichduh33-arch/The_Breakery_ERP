// packages/ui/src/components/RefundTenderSplitter.tsx
// Session 10 — split the refund total across the order's original payment methods.
// Renders a row per method that the order was paid with. Each row shows the
// available balance (paid - already_refunded) and a numeric input. Sum live.

import type { JSX } from 'react';
import { Currency } from './Currency.js';
import { Input } from '../primitives/Input.js';
import { TenderRow, type TenderRowMethod } from './TenderRow.js';
import { cn } from '../lib/cn.js';

export interface RefundTenderMethodEntry {
  method: TenderRowMethod;
  /** Original sum paid with this method on the order. */
  paid: number;
  /** Sum already refunded for this method (across prior refunds). */
  already_refunded: number;
}

export interface RefundTenderSplitterEntry {
  method: TenderRowMethod;
  amount: number;
}

export interface RefundTenderSplitterProps {
  refundTotal: number;
  methods: RefundTenderMethodEntry[];
  values: RefundTenderSplitterEntry[];
  onChange: (values: RefundTenderSplitterEntry[]) => void;
  className?: string;
}

export function RefundTenderSplitter({
  refundTotal,
  methods,
  values,
  onChange,
  className,
}: RefundTenderSplitterProps): JSX.Element {
  const sum = values.reduce((s, v) => s + v.amount, 0);
  const balanced = sum === refundTotal;

  function handleEdit(method: TenderRowMethod, raw: string): void {
    const n = Math.max(0, Number.parseInt(raw.replace(/\D/g, ''), 10) || 0);
    const next: RefundTenderSplitterEntry[] = [...values];
    const idx = next.findIndex((v) => v.method === method);
    if (idx >= 0) next[idx] = { method, amount: n };
    else next.push({ method, amount: n });
    onChange(next.filter((v) => v.amount > 0));
  }

  return (
    <div data-testid="refund-tender-splitter" className={cn('space-y-3', className)}>
      <div className="flex items-center justify-between text-xs uppercase tracking-widest text-text-secondary">
        <span>Refund tenders</span>
        <span className={cn(balanced ? 'text-text-primary' : 'text-danger')}>
          <Currency amount={sum} className={balanced ? 'text-text-primary' : 'text-danger'} />
          {' / '}
          <Currency amount={refundTotal} className="text-text-secondary" />
        </span>
      </div>

      <div className="space-y-2">
        {methods.map((m) => {
          const remaining = m.paid - m.already_refunded;
          const current = values.find((v) => v.method === m.method)?.amount ?? 0;
          return (
            <div
              key={m.method}
              data-testid={`refund-tender-method-${m.method}`}
              className="flex items-center justify-between gap-3 rounded-md border border-border-subtle bg-bg-input px-3 py-2"
            >
              <div className="flex flex-col gap-1 flex-1">
                <TenderRow method={m.method} amount={remaining} className="border-none bg-transparent p-0" />
                {m.already_refunded > 0 && (
                  <div className="text-[10px] uppercase tracking-wide text-text-secondary">
                    paid <Currency amount={m.paid} /> · refunded <Currency amount={m.already_refunded} />
                  </div>
                )}
              </div>
              <Input
                type="text"
                inputMode="numeric"
                aria-label={`Refund amount for ${m.method}`}
                className="w-32 text-right font-mono"
                value={current === 0 ? '' : String(current)}
                onChange={(e) => handleEdit(m.method, e.target.value)}
                placeholder="0"
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
