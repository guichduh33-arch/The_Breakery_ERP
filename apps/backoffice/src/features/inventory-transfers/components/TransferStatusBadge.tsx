// apps/backoffice/src/features/inventory-transfers/components/TransferStatusBadge.tsx
//
// Session 12 — Phase 3 — colored status pill used in the list table header
// and on the detail page. Pure presentational; no domain logic.

import type { JSX } from 'react';
import type { TransferStatus } from '@breakery/domain';

export interface TransferStatusBadgeProps {
  status: TransferStatus;
}

// Tailwind utility classes — colour mapping per spec C-21 / Phase 3 design notes.
const STYLES: Record<TransferStatus, string> = {
  draft:      'bg-gray-500/15 text-gray-300 border-gray-500/30',
  pending:    'bg-amber-500/15 text-amber-400 border-amber-500/30',
  in_transit: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  received:   'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  cancelled:  'bg-red-500/15 text-red-400 border-red-500/30',
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
