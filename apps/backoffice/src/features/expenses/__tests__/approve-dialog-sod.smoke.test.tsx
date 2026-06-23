// apps/backoffice/src/features/expenses/__tests__/approve-dialog-sod.smoke.test.tsx
// S28 — wave 6.C — ApproveDialog SOD smoke (2 asserts).
// Verifies that the submit button is disabled when:
//   T1 — the current user is the expense creator (self-approve blocked)
//   T2 — the current user already appears in the approvals array (double-approve blocked)

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApproveDialog } from '@/features/expenses/components/ApproveDialog.js';

// ── Hook mock ─────────────────────────────────────────────────────────────────
// ApproveDialog imports useApproveExpense from useExpenseActions for mutation state.
vi.mock('@/features/expenses/hooks/useExpenseActions.js', () => ({
  useApproveExpense: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    error: null,
    reset: vi.fn(),
  }),
}));

// ── Helper ────────────────────────────────────────────────────────────────────
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('ApproveDialog SOD smoke', () => {
  it('T1 button disabled if user is creator', () => {
    wrap(
      <ApproveDialog
        open={true}
        expenseId="e1"
        onClose={vi.fn()}
        createdByUserId="u1"
        approvals={[]}
        currentUserId="u1"
      />,
    );
    const btn = screen.getByTestId('approve-submit-btn');
    expect(btn).toBeDisabled();
    // Actual tooltip from Task 5.H: "You cannot approve an expense you created (separation of duties)"
    expect(btn.getAttribute('title')).toMatch(/own expense|you created|separation of duties/i);
  });

  it('T2 button disabled if user already in approvals', () => {
    wrap(
      <ApproveDialog
        open={true}
        expenseId="e1"
        onClose={vi.fn()}
        createdByUserId="other"
        approvals={[
          {
            id: 'a1',
            expense_id: 'e1',
            approver_user_id: 'u1',
            approver_name: 'Self',
            step: 1,
            approved_at: '2026-05-24T10:00:00Z',
          },
        ]}
        currentUserId="u1"
      />,
    );
    const btn = screen.getByTestId('approve-submit-btn');
    expect(btn).toBeDisabled();
    // Actual tooltip from Task 5.H: "You have already approved this expense"
    expect(btn.getAttribute('title')).toMatch(/already approved/i);
  });

  it('T3 SUPER_ADMIN creator may self-approve (button not SOD-blocked)', () => {
    wrap(
      <ApproveDialog
        open={true}
        expenseId="e1"
        onClose={vi.fn()}
        createdByUserId="u1"
        approvals={[]}
        currentUserId="u1"
        currentUserRole="SUPER_ADMIN"
      />,
    );
    const btn = screen.getByTestId('approve-submit-btn');
    // Creator block relaxed for SUPER_ADMIN — no SOD tooltip; button gated only by empty PIN.
    expect(btn.getAttribute('title')).toBeNull();
    expect(btn).toHaveTextContent(/approve/i);
    expect(btn).not.toHaveTextContent(/cannot approve/i);
  });
});
