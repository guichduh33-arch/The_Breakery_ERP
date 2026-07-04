// apps/backoffice/src/pages/expenses/__tests__/ExpenseDetailPage.smoke.test.tsx
//
// Session 14 / Phase 5.A — smoke for the rebuilt expense detail page.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { JSX } from 'react';
import ExpenseDetailPage from '@/pages/expenses/ExpenseDetailPage.js';
import type { ExpenseRow } from '@/features/expenses/hooks/useExpensesList.js';
import type * as UseExpensesListModule from '@/features/expenses/hooks/useExpensesList.js';

const EXPENSE: ExpenseRow = {
  id:               'e-1',
  expense_number:   'EXP-202604-0001',
  expense_date:     '2026-04-17',
  description:      'Office supplies',
  vendor_name:      'Acme Stationary',
  category_id:      'cat-1',
  amount:           250000,
  vat_amount:       0,
  payment_method:   'cash',
  status:           'submitted',
  receipt_url:      null,
  je_id:            null,
  payment_je_id:    null,
  submitted_at:     '2026-04-17T00:00:00Z',
  submitted_by:     null,
  approved_at:      null,
  approved_by:      null,
  paid_at:          null,
  paid_by:          null,
  rejected_at:      null,
  rejected_reason:  null,
  approval_notes:   null,
  idempotency_key:  null,
  created_by:       null,
  created_at:       '2026-04-17T00:00:00Z',
  updated_at:       '2026-04-17T00:00:00Z',
  deleted_at:       null,
  is_historical_import:             false,
  auto_approved:                    false,
  current_approval_step:            0,
  required_approval_steps_snapshot: null,
};

vi.mock('@/features/expenses/hooks/useExpenseDetail.js', () => ({
  useExpenseDetail: () => ({ data: EXPENSE, isLoading: false, error: null }),
}));

vi.mock('@/features/expenses/hooks/useExpensesList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof UseExpensesListModule>();
  return {
    ...actual,
    useExpenseCategories: () => ({
      data: [{
        id: 'cat-1', code: 'OFFICE', name: 'Office Supplies', is_active: true,
        account_id: 'acc-1', created_at: '', updated_at: '',
      }],
      isLoading: false,
      error: null,
    }),
  };
});

vi.mock('@/features/expenses/hooks/useExpenseActions.js', () => ({
  useSubmitExpense: () => ({ mutateAsync: () => Promise.resolve(undefined), isPending: false, error: null }),
}));

vi.mock('@/features/expenses/components/ApproveDialog.js', () => ({ ApproveDialog: () => null }));
vi.mock('@/features/expenses/components/RejectDialog.js',  () => ({ RejectDialog:  () => null }));
vi.mock('@/features/expenses/components/PayDialog.js',     () => ({ PayDialog:     () => null }));

let currentPerms = new Set<string>(['expenses.read', 'expenses.approve', 'expenses.pay']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

// Session 59 / Task 6b — stand-in for NewExpensePage that just echoes the
// navigation state, so the "Duplicate" test can assert on the seed without
// pulling in NewExpensePage's own mocking (covered separately in
// NewExpensePage.smoke.test.tsx).
function DuplicateTargetProbe(): JSX.Element {
  const location = useLocation() as { state: { duplicateFrom?: unknown } | null };
  return <pre data-testid="duplicate-seed">{JSON.stringify(location.state?.duplicateFrom ?? null)}</pre>;
}

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/backoffice/expenses/e-1']}>
        <Routes>
          <Route path="/backoffice/expenses/:id" element={<ExpenseDetailPage />} />
          <Route path="/backoffice/expenses/new" element={<DuplicateTargetProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExpenseDetailPage (Phase 5.A rewrite)', () => {
  it('renders header, financial summary, and details cards', () => {
    currentPerms = new Set(['expenses.read', 'expenses.approve', 'expenses.pay']);
    renderPage();
    expect(screen.getByRole('heading', { name: /EXP-202604-0001/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Office supplies/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^Financial$/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Office Supplies/i).length).toBeGreaterThan(0);
  });

  it('shows Approve + Reject buttons on a submitted expense for an approver', () => {
    currentPerms = new Set(['expenses.read', 'expenses.approve']);
    renderPage();
    expect(screen.getByRole('button', { name: /Approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument();
  });

  it('hides workflow actions when the user only has read permission', () => {
    currentPerms = new Set(['expenses.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /Approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject/i })).not.toBeInTheDocument();
    currentPerms = new Set(['expenses.read', 'expenses.approve', 'expenses.pay']);
  });

  // Session 59 / Task 6b — "Duplicate" button.
  it('shows Duplicate for a user with expenses.create and navigates with a prefilled seed', () => {
    currentPerms = new Set(['expenses.read', 'expenses.create']);
    renderPage();
    const duplicateBtn = screen.getByRole('button', { name: /Duplicate/i });
    fireEvent.click(duplicateBtn);
    const seed: unknown = JSON.parse(screen.getByTestId('duplicate-seed').textContent ?? 'null');
    expect(seed).toEqual({
      category_id:    'cat-1',
      amount:         '250000',
      vat_amount:     '0',
      payment_method: 'cash',
      vendor_name:    'Acme Stationary',
      description:    'Office supplies',
    });
    currentPerms = new Set(['expenses.read', 'expenses.approve', 'expenses.pay']);
  });

  it('hides Duplicate for a user without expenses.create', () => {
    currentPerms = new Set(['expenses.read']);
    renderPage();
    expect(screen.queryByRole('button', { name: /Duplicate/i })).not.toBeInTheDocument();
    currentPerms = new Set(['expenses.read', 'expenses.approve', 'expenses.pay']);
  });
});
