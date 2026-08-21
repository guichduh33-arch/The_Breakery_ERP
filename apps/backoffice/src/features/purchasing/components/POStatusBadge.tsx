// apps/backoffice/src/features/purchasing/components/POStatusBadge.tsx
//
// Session 13 — Phase 3.A — coloured status pill for the PO list & detail.

import type { JSX } from 'react';
import type { POStatus } from '../hooks/usePurchaseOrdersList.js';

const STYLES: Record<POStatus, string> = {
  draft:     'bg-bg-overlay text-text-secondary border-border-subtle',
  pending:   'bg-warning-soft text-warning border-warning',
  partial:   'bg-info-soft text-info border-info',
  received:  'bg-success-soft text-success border-success',
  cancelled: 'bg-danger-soft text-danger border-danger',
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
      className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-xs uppercase tracking-widest ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  );
}
