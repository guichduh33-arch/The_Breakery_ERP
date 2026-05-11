// packages/ui/src/components/TenderListBuilder.tsx
// Session 10 — display the list of accumulated tenders + remaining badge.
// PaymentTerminal owns the state (tenders[]) and add/remove logic;
// this component is a controlled, stateless render.

import type { JSX } from 'react';
import { Currency } from './Currency.js';
import { TenderRow, type TenderRowMethod } from './TenderRow.js';
import { cn } from '../lib/cn.js';

export interface TenderEntry {
  method: TenderRowMethod;
  amount: number;
  cash_received?: number;
  change_given?: number;
}

export interface TenderListBuilderProps {
  tenders: TenderEntry[];
  remaining: number;
  /** When provided, each row gets a remove X. */
  onRemoveTender?: (idx: number) => void;
  emptyHint?: string;
  className?: string;
}

export function TenderListBuilder({
  tenders,
  remaining,
  onRemoveTender,
  emptyHint = 'No tenders yet',
  className,
}: TenderListBuilderProps): JSX.Element {
  return (
    <div data-testid="tender-list-builder" className={cn('space-y-2', className)}>
      <div className="flex items-center justify-between">
        <span className="text-xs uppercase tracking-widest text-text-secondary">Tenders</span>
        <span className="text-xs uppercase tracking-widest text-text-secondary">
          Remaining: <Currency amount={remaining} className="text-text-primary" />
        </span>
      </div>
      {tenders.length === 0 ? (
        <div className="rounded-md border border-dashed border-border-subtle px-3 py-4 text-center text-xs text-text-secondary">
          {emptyHint}
        </div>
      ) : (
        <div className="space-y-2">
          {tenders.map((t, i) => (
            <TenderRow
              key={`${t.method}-${i}`}
              method={t.method}
              amount={t.amount}
              {...(t.cash_received !== undefined ? { cashReceived: t.cash_received } : {})}
              {...(t.change_given !== undefined ? { changeGiven: t.change_given } : {})}
              {...(onRemoveTender ? { onRemove: () => onRemoveTender(i) } : {})}
            />
          ))}
        </div>
      )}
    </div>
  );
}
