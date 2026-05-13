// apps/backoffice/src/features/purchasing/components/POStatusBadge.tsx
//
// Session 13 — Phase 3.A — coloured status pill for the PO list & detail.

import type { JSX } from 'react';
import type { POStatus } from '../hooks/usePurchaseOrdersList.js';

const STYLES: Record<POStatus, string> = {
  draft:     'bg-bg-overlay text-text-secondary border-border-subtle',
  pending:   'bg-warning-soft text-warning border-warning/30',
  partial:   'bg-info-soft text-info border-info/30',
  received:  'bg-success-soft text-success border-success/30',
  cancelled: 'bg-danger-soft text-danger border-danger/30',
};

const LABELS: Record<POStatus, string> = {
  draft:     'Draft',
  pending:   'Pending',
  partial:   'Partial',
  received:  'Received',
  cancelled: 'Cancelled',
};

export function POStatusBadge({ status }: { status: POStatus }): JSX.Element {
  return (
    <span
      data-status={status}
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
