// apps/pos/src/features/order-history/components/OrderHistoryStats.tsx
//
// Session 14 — Phase 2.D — KPI strip rendered above the order history list.
//
// Visual ref: 80-transaction-history-collapsed.jpg — the "Total / Cash /
// Card / Other" 4-column strip with method-coded color dots.
//
// Pure presentational; derives sums from a slice of OrderHistoryRow.

import type { JSX } from 'react';
import { Currency, SectionLabel, cn } from '@breakery/ui';

export interface OrderHistoryStatsInput {
  total: number;
  cash: number;
  card: number;
  other: number;
  count: number;
}

export interface OrderHistoryStatsProps {
  stats: OrderHistoryStatsInput;
}

export function OrderHistoryStats({ stats }: OrderHistoryStatsProps): JSX.Element {
  return (
    <div
      className="grid grid-cols-2 md:grid-cols-4 gap-3"
      data-testid="order-history-stats"
    >
      <StatTile label="Total" amount={stats.total} tone="primary" emphasis="gold" />
      <StatTile label="Cash" amount={stats.cash} tone="success" />
      <StatTile label="Card" amount={stats.card} tone="info" />
      <StatTile label="Other" amount={stats.other} tone="muted" />
    </div>
  );
}

function StatTile({
  label,
  amount,
  tone,
  emphasis,
}: {
  label: string;
  amount: number;
  tone: 'primary' | 'success' | 'info' | 'muted';
  emphasis?: 'gold';
}): JSX.Element {
  const dot =
    tone === 'success'
      ? 'bg-green'
      : tone === 'info'
        ? 'bg-blue-info'
        : tone === 'muted'
          ? 'bg-text-muted'
          : 'bg-gold';
  return (
    <div className="rounded-md border border-border-subtle bg-bg-elevated px-3 py-2.5 flex flex-col gap-1">
      <SectionLabel size="xs" as="div" className="inline-flex items-center gap-1.5">
        <span aria-hidden className={cn('h-2 w-2 rounded-full', dot)} />
        {label}
      </SectionLabel>
      {emphasis === 'gold' ? (
        <Currency amount={amount} emphasis="gold" className="text-base font-semibold" />
      ) : (
        <Currency amount={amount} className="text-base font-semibold" />
      )}
    </div>
  );
}
