// apps/backoffice/src/features/inventory-opname/components/OpnameStatusBadge.tsx
// Session 13 / Phase 2.D — small status pill.

import { Badge, type BadgeProps } from '@breakery/ui';
import type { OpnameStatus } from '../hooks/useOpnameList.js';

const VARIANTS: Record<OpnameStatus, BadgeProps['variant']> = {
  draft:      'neutral',
  counting:   'info',
  review:     'warning',
  finalized:  'success',
  cancelled:  'destructive',
};

const LABELS: Record<OpnameStatus, string> = {
  draft:     'Draft',
  counting:  'Counting',
  review:    'Review',
  finalized: 'Finalized',
  cancelled: 'Cancelled',
};

export function OpnameStatusBadge({ status }: { status: OpnameStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}
