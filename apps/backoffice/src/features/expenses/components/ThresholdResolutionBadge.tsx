// apps/backoffice/src/features/expenses/components/ThresholdResolutionBadge.tsx
// S28 Task 5.H — inline badge summarising how the threshold resolved for this expense.
import { Badge } from '@breakery/ui';
import type { ApprovalStep } from '../../settings/expense-thresholds/hooks/useExpenseThresholds.js';

interface Props {
  snapshot: ApprovalStep[] | null;
  autoApproved: boolean;
}

export function ThresholdResolutionBadge({ snapshot, autoApproved }: Props): JSX.Element | null {
  if (autoApproved) {
    return (
      <Badge
        data-testid="threshold-badge-auto"
        variant="secondary"
      >
        Auto-approved
      </Badge>
    );
  }
  if (!snapshot || snapshot.length === 0) return null;
  if (snapshot.length === 1) {
    return (
      <Badge
        data-testid="threshold-badge-1step"
        variant="outline"
      >
        Manager approval required
      </Badge>
    );
  }
  return (
    <Badge
      data-testid="threshold-badge-Nstep"
      variant="outline"
    >
      {snapshot.length}-step approval required
    </Badge>
  );
}
