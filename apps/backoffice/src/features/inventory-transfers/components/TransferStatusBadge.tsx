// apps/backoffice/src/features/inventory-transfers/components/TransferStatusBadge.tsx
//
// Session 12 — Phase 3 — colored status pill used in the list table header
// and on the detail page. Pure presentational; no domain logic.

import type { JSX } from 'react';
import type { TransferStatus } from '@breakery/domain';

export interface TransferStatusBadgeProps {
  status: TransferStatus;
}

// Token-driven colour mapping per spec C-21 / Phase 3 design notes.
// Session 13 (ui-steward batch 1): migrated from raw Tailwind palette literals
// (gray/amber/blue/emerald/red 500) to semantic + accent design tokens.
const STYLES: Record<TransferStatus, string> = {
  draft:      'bg-bg-overlay text-text-secondary border-border-subtle',
  pending:    'bg-warning-soft text-warning border-warning/30',
  in_transit: 'bg-info-soft text-info border-info/30',
  received:   'bg-success-soft text-success border-success/30',
  cancelled:  'bg-danger-soft text-danger border-danger/30',
};

const LABELS: Record<TransferStatus, string> = {
  draft:      'Draft',
  pending:    'Pending',
  in_transit: 'In transit',
  received:   'Received',
  cancelled:  'Cancelled',
};

export function TransferStatusBadge({ status }: TransferStatusBadgeProps): JSX.Element {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
