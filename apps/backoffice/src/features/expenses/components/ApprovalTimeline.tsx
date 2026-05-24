// apps/backoffice/src/features/expenses/components/ApprovalTimeline.tsx
// S28 Task 5.G — stepper showing the approval chain state for a given expense.
import { Check, Circle, CircleDot } from 'lucide-react';
import { useExpenseApprovals } from '../hooks/useExpenseApprovals.js';
import type { ApprovalStep } from '../../settings/expense-thresholds/hooks/useExpenseThresholds.js';

interface Props {
  expenseId: string;
  snapshot: ApprovalStep[] | null;
  autoApproved: boolean;
  currentStep: number;
}

export function ApprovalTimeline({ expenseId, snapshot, autoApproved, currentStep }: Props): JSX.Element | null {
  const { data: approvals = [] } = useExpenseApprovals(expenseId);

  if (autoApproved) {
    return (
      <div className="border border-border-subtle rounded p-3" data-testid="approval-timeline-auto">
        <div className="flex items-center gap-2">
          <Check className="w-4 h-4 text-text-muted" />
          <span className="text-sm text-text-muted">Auto-approved (under threshold)</span>
        </div>
      </div>
    );
  }

  if (!snapshot || snapshot.length === 0) {
    return null;
  }

  return (
    <div className="border border-border-subtle rounded p-3" data-testid="approval-timeline">
      <div className="text-sm font-medium text-text-primary mb-2">Approval chain</div>
      <ol className="space-y-2">
        {snapshot.map((step, idx) => {
          const approval = approvals.find((a) => a.step === idx + 1);
          const isDone = !!approval;
          const isCurrent = !isDone && idx === currentStep;
          return (
            <li key={idx} className="flex items-start gap-2" data-testid={`timeline-step-${idx}`}>
              {isDone ? (
                <Check className="w-4 h-4 text-success mt-0.5" />
              ) : isCurrent ? (
                <CircleDot className="w-4 h-4 text-info mt-0.5" />
              ) : (
                <Circle className="w-4 h-4 text-text-muted mt-0.5" />
              )}
              <div className="flex-1">
                <div className="text-sm text-text-primary">
                  Step {idx + 1}: {step.label}
                </div>
                <div className="text-xs text-text-muted">{step.role_codes.join(', ')}</div>
                {approval && (
                  <div className="text-xs text-text-muted" data-testid={`timeline-approver-${idx}`}>
                    Approved by {approval.approver_name ?? 'unknown'} on{' '}
                    {new Date(approval.approved_at).toLocaleString()}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
