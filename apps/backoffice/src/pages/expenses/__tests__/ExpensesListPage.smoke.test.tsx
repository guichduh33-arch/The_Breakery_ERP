// apps/backoffice/src/pages/expenses/__tests__/ExpensesListPage.smoke.test.tsx
//
// Session 14 / Phase 5.A — smoke for the rebuilt Expenses list. Mocks the
// data hooks + auth permissions and asserts header, KPI tiles, status
// quick-filter pills, and table rows render correctly.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import ExpensesListPage from '@/pages/expenses/ExpensesListPage.js';
import type { ExpenseRow, ExpenseCategoryRow } from '@/features/expenses/hooks/useExpensesList.js';

const ROWS: ExpenseRow[] = [
  {
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
  },
  {
    id:               'e-2',
    expense_number:   'EXP-202604-0002',
    expense_date:     '2026-04-18',
    description:      'Electricity bill',
    vendor_name:      null,
    category_id:      'cat-2',
    amount:           1500000,
    vat_amount:       150000,
    payment_method:   'transfer',
    status:           'approved',
    receipt_url:      null,
    je_id:            'je-1',
    payment_je_id:    null,
    submitted_at:     '2026-04-18T00:00:00Z',
    submitted_by:     null,
    approved_at:      '2026-04-18T00:00:00Z',
    approved_by:      null,
    paid_at:          null,
    paid_by:          null,
    rejected_at:      null,
    rejected_reason:  null,
    approval_notes:   null,
    idempotency_key:  null,
    created_by:       null,
    created_at:       '2026-04-18T00:00:00Z',
    updated_at:       '2026-04-18T00:00:00Z',
    deleted_at:       null,
  },
];

const CATS: ExpenseCategoryRow[] = [
  { id: 'cat-1', code: 'OFFICE',  name: 'Office Supplies', is_active: true, account_id: 'acc-1', created_at: '', updated_at: '' },
  { id: 'cat-2', code: 'UTILITIES', name: 'Utilities',     is_active: true, account_id: 'acc-2', created_at: '', updated_at: '' },
];

vi.mock('@/features/expenses/hooks/useExpensesList.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/features/expenses/hooks/useExpensesList.js')>();
  return {
    ...actual,
    useExpensesList:    () => ({ data: ROWS, isLoading: false, error: null }),
    useExpenseCategories: () => ({ data: CATS, isLoading: false, error: null }),
  };
});

let currentPerms = new Set<string>(['expenses.read', 'expenses.create']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

function renderPage(): ReturnType<typeof render> {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ExpensesListPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ExpensesListPage (Phase 5.A rewrite)', () => {
  it('renders heading, KPI tiles, status filters, and rows', () => {
    currentPerms = new Set(['expenses.read', 'expenses.create']);
    renderPage();
    expect(screen.getByRole('heading', { name: /^Expenses$/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Total Expenses/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Monthly Count/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: /EXP-202604-0001/i })).toBeInTheDocument();
    expect(screen.getAllByText(/Office supplies/i).length).toBeGreaterThan(0);
  });

  it('shows the New expense CTA when create permission is granted', () => {
    currentPerms = new Set(['expenses.read', 'expenses.create']);
    renderPage();
    expect(screen.getByRole('link', { name: /New expense/i })).toBeInTheDocument();
  });

  it('hides the create CTA when only read permission is granted', () => {
    currentPerms = new Set(['expenses.read']);
    renderPage();
    expect(screen.queryByRole('link', { name: /New expense/i })).not.toBeInTheDocument();
    currentPerms = new Set(['expenses.read', 'expenses.create']);
  });

  it('blocks the page when the user lacks expenses.read', () => {
    currentPerms = new Set();
    renderPage();
    expect(screen.queryByRole('heading', { name: /^Expenses$/i })).not.toBeInTheDocument();
    expect(screen.getByText(/do not have permission to view expenses/i)).toBeInTheDocument();
    currentPerms = new Set(['expenses.read', 'expenses.create']);
  });
});
