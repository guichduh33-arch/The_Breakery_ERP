// apps/backoffice/src/features/expenses/components/ExpenseStatusBadge.tsx
import { Badge } from '@breakery/ui';
import type { ExpenseStatus } from '../hooks/useExpensesList.js';

const STATUS_VARIANT: Record<ExpenseStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  draft:     'outline',
  submitted: 'secondary',
  approved:  'default',
  rejected:  'destructive',
  paid:      'default',
};

const STATUS_LABEL: Record<ExpenseStatus, string> = {
  draft:     'Draft',
  submitted: 'Submitted',
  approved:  'Approved',
  rejected:  'Rejected',
  paid:      'Paid',
};

export interface ExpenseStatusBadgeProps {
  status: ExpenseStatus | string;
}

export function ExpenseStatusBadge({ status }: ExpenseStatusBadgeProps): JSX.Element {
  const s = (status as ExpenseStatus) in STATUS_LABEL ? (status as ExpenseStatus) : 'draft';
  return (
    <Badge variant={STATUS_VARIANT[s]} className="capitalize">
      {STATUS_LABEL[s]}
    </Badge>
  );
}
