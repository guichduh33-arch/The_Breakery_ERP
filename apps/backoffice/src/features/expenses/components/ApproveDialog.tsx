// apps/backoffice/src/features/expenses/components/ApproveDialog.tsx
// S28 + H1 audit fix (2026-06-01): approve_expense_v3 — PIN collected in dialog,
// passed as the p_manager_pin RPC arg and verified server-side via verify_user_pin.
// S28 Task 5.H: SOD-aware button state (creator cannot approve their own expense; double-approve blocked).
import { useState } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@breakery/ui';
import { useApproveExpense } from '../hooks/useExpenseActions.js';
import type { ExpenseApprovalRow } from '../hooks/useExpenseApprovals.js';

export interface ApproveDialogProps {
  open: boolean;
  expenseId: string;
  onClose: () => void;
  onSuccess?: () => void;
  /** user_profiles.id of whoever created the expense */
  createdByUserId?: string | null;
  /** existing approval rows for this expense */
  approvals?: ExpenseApprovalRow[];
  /** user_profiles.id of the currently logged-in user */
  currentUserId?: string | null;
  /** role_code of the currently logged-in user — SUPER_ADMIN may self-approve (SOD block 1 relaxed) */
  currentUserRole?: string | null;
}

export function ApproveDialog({
  open,
  expenseId,
  onClose,
  onSuccess,
  createdByUserId,
  approvals = [],
  currentUserId,
  currentUserRole,
}: ApproveDialogProps): JSX.Element {
  const [pin, setPin] = useState('');
  const mut = useApproveExpense();

  // Separation-of-duties checks.
  // SUPER_ADMIN may self-approve (single-operator policy) — SOD block 1 is relaxed
  // for that role server-side (approve_expense_v3) and mirrored here.
  const isSuperAdmin = currentUserRole === 'SUPER_ADMIN';
  const isCreator = !isSuperAdmin
    && currentUserId !== null && currentUserId !== undefined
    && createdByUserId !== null && createdByUserId !== undefined
    && currentUserId === createdByUserId;
  const alreadyApproved = currentUserId !== null && currentUserId !== undefined
    && approvals.some((a) => a.approver_user_id === currentUserId);
  const sodBlocked = isCreator || alreadyApproved;

  const sodTooltip = isCreator
    ? 'You cannot approve an expense you created (separation of duties)'
    : alreadyApproved
      ? 'You have already approved this expense'
      : undefined;

  function handleClose(): void {
    setPin('');
    mut.reset();
    onClose();
  }

  async function handleSubmit(): Promise<void> {
    if (pin.trim().length === 0 || sodBlocked) return;
    try {
      await mut.mutateAsync({ id: expenseId, manager_pin: pin.trim() });
      setPin('');
      onSuccess?.();
      onClose();
    } catch {
      // surfaced via mut.error
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve expense</DialogTitle>
          <DialogDescription>
            Approval posts a balanced journal entry. Enter your manager PIN to confirm.
            This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-1">
          <label htmlFor="approve-pin" className="text-xs uppercase tracking-widest text-text-secondary">
            Manager PIN
          </label>
          <input
            id="approve-pin"
            type="password"
            inputMode="numeric"
            maxLength={8}
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            placeholder="••••••"
            className="w-full rounded-md border border-border-subtle bg-bg-input px-3 py-2 text-sm text-text-primary tracking-widest"
          />
        </div>
        {mut.error !== null && mut.error !== undefined && (
          <div className="text-xs text-red">{mut.error.message}</div>
        )}
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={handleClose}>Cancel</Button>
          <Button
            data-testid="approve-submit-btn"
            type="button"
            variant="primary"
            onClick={() => { void handleSubmit(); }}
            disabled={sodBlocked || mut.isPending || pin.trim().length === 0}
            title={sodTooltip}
          >
            {mut.isPending ? 'Approving…' : sodBlocked ? 'Cannot approve' : 'Approve'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
