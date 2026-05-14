// apps/backoffice/src/features/inventory-opname/components/OpnameStatusBadge.tsx
// Session 13 / Phase 2.D — small status pill.

import { cn } from '@breakery/ui';
import type { OpnameStatus } from '../hooks/useOpnameList.js';

const STYLES: Record<OpnameStatus, string> = {
  draft:      'bg-bg-overlay text-text-secondary border-border-subtle',
  counting:   'bg-blue-100 text-blue-700 border-blue-300',
  review:     'bg-amber-100 text-amber-700 border-amber-300',
  finalized:  'bg-emerald-100 text-emerald-700 border-emerald-300',
  cancelled:  'bg-rose-100 text-rose-700 border-rose-300',
};

const LABELS: Record<OpnameStatus, string> = {
  draft:     'Draft',
  counting:  'Counting',
  review:    'Review',
  finalized: 'Finalized',
  cancelled: 'Cancelled',
};

export function OpnameStatusBadge({ status }: { status: OpnameStatus }) {
  return (
    <span
      className={cn(
        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border',
        STYLES[status],
      )}
    >
      {LABELS[status]}
    </span>
  );
}
