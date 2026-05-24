// apps/backoffice/src/features/expenses/__tests__/approval-timeline.smoke.test.tsx
// S28 — wave 6.B — smoke tests for ApprovalTimeline (3 asserts).

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApprovalTimeline } from '@/features/expenses/components/ApprovalTimeline.js';

// ── Hook mock ────────────────────────────────────────────────────────────────
vi.mock('@/features/expenses/hooks/useExpenseApprovals.js', () => ({
  useExpenseApprovals: vi.fn(),
}));
import { useExpenseApprovals } from '@/features/expenses/hooks/useExpenseApprovals.js';

// ── Helper ───────────────────────────────────────────────────────────────────
function wrap(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('ApprovalTimeline smoke', () => {
  it('T1 snapshot=1 step + 0 approvals → 1 pending row, no approver', () => {
    vi.mocked(useExpenseApprovals).mockReturnValue({ data: [] } as any);
    wrap(
      <ApprovalTimeline
        expenseId="e1"
        snapshot={[{ role_codes: ['MANAGER'], label: 'Manager approval' }]}
        autoApproved={false}
        currentStep={0}
      />,
    );
    expect(screen.getByTestId('timeline-step-0')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline-approver-0')).not.toBeInTheDocument();
  });

  it('T2 snapshot=2 steps + 1 approval → step 0 shows approver "Bob", step 1 has none', () => {
    vi.mocked(useExpenseApprovals).mockReturnValue({
      data: [
        {
          id: 'a1',
          expense_id: 'e1',
          approver_user_id: 'u1',
          approver_name: 'Bob',
          step: 1,
          approved_at: '2026-05-24T10:00:00Z',
        },
      ],
    } as any);
    wrap(
      <ApprovalTimeline
        expenseId="e1"
        snapshot={[
          { role_codes: ['MANAGER'], label: 'Manager' },
          { role_codes: ['ADMIN'], label: 'Owner' },
        ]}
        autoApproved={false}
        currentStep={1}
      />,
    );
    expect(screen.getByTestId('timeline-approver-0')).toHaveTextContent('Bob');
    expect(screen.queryByTestId('timeline-approver-1')).not.toBeInTheDocument();
  });

  it('T3 autoApproved=true → renders approval-timeline-auto badge', () => {
    vi.mocked(useExpenseApprovals).mockReturnValue({ data: [] } as any);
    wrap(
      <ApprovalTimeline
        expenseId="e1"
        snapshot={[]}
        autoApproved={true}
        currentStep={0}
      />,
    );
    expect(screen.getByTestId('approval-timeline-auto')).toBeInTheDocument();
  });
});
