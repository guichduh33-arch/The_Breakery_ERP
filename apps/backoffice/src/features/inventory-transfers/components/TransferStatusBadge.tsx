// apps/backoffice/src/features/inventory-transfers/components/TransferStatusBadge.tsx
//
// Session 12 — Phase 3 — colored status pill used in the list table header
// and on the detail page. Pure presentational; no domain logic.
//
// Delegates to the shared Badge primitive: the semantic tonal variants
// (success/warning/info/neutral/destructive) exist precisely so screens stop
// re-inventing pills. The former hand-rolled <span> carried an off-scale
// text-[10px] and its own uppercase, which rendered CANCELLED here and
// "Cancelled" on the opname list for the same label — see OpnameStatusBadge.

import type { JSX } from 'react';
import type { TransferStatus } from '@breakery/domain';
import { Badge, type BadgeProps } from '@breakery/ui';

export interface TransferStatusBadgeProps {
  status: TransferStatus;
}

const VARIANTS: Record<TransferStatus, BadgeProps['variant']> = {
  draft:      'neutral',
  pending:    'warning',
  in_transit: 'info',
  received:   'success',
  cancelled:  'destructive',
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
    <Badge variant={VARIANTS[status]} data-status={status}>
      {LABELS[status]}
    </Badge>
  );
}
