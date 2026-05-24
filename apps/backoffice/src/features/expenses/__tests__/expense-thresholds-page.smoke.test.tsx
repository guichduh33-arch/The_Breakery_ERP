// apps/backoffice/src/features/expenses/__tests__/expense-thresholds-page.smoke.test.tsx
// S28 — wave 6.A — smoke tests for ExpenseThresholdsPage (3 asserts).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExpenseThresholdsPage from '@/features/settings/expense-thresholds/ExpenseThresholdsPage.js';

// ── Mock data ────────────────────────────────────────────────────────────────
const mockData = [
  {
    id: 't1',
    category_id: null,
    category_name: null,
    amount_min: 0,
    amount_max: 100000,
    steps: [],
    created_at: '',
    updated_at: '',
  },
  {
    id: 't2',
    category_id: null,
    category_name: null,
    amount_min: 100000,
    amount_max: 1000000,
    steps: [{ role_codes: ['MANAGER'], label: 'Manager' }],
    created_at: '',
    updated_at: '',
  },
];

const mockSetMutateAsync  = vi.fn().mockResolvedValue(undefined);
const mockDeleteMutateAsync = vi.fn().mockResolvedValue(true);

// ── Hooks mocks ──────────────────────────────────────────────────────────────
vi.mock('@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js', () => ({
  useExpenseThresholds: () => ({ data: mockData, isLoading: false, isError: false }),
}));

vi.mock('@/features/settings/expense-thresholds/hooks/useSetExpenseThreshold.js', () => ({
  useSetExpenseThreshold: () => ({
    mutateAsync: mockSetMutateAsync,
    isPending: false,
    error: null,
    isError: false,
  }),
}));

vi.mock('@/features/settings/expense-thresholds/hooks/useDeleteExpenseThreshold.js', () => ({
  useDeleteExpenseThreshold: () => ({
    mutateAsync: mockDeleteMutateAsync,
    isPending: false,
    error: null,
    isError: false,
  }),
}));

vi.mock('@/features/expenses/hooks/useExpensesList.js', () => ({
  useExpenseCategories: () => ({ data: [{ id: 'c1', name: 'Rent', code: 'RENT', is_active: true }] }),
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    selector({ hasPermission: () => true }),
}));

// ── Helpers ──────────────────────────────────────────────────────────────────
function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ExpenseThresholdsPage />
    </QueryClientProvider>,
  );
}

// ── Tests ────────────────────────────────────────────────────────────────────
describe('ExpenseThresholdsPage smoke', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.confirm = vi.fn().mockReturnValue(true);
  });

  it('T1 renders default rows', () => {
    renderPage();
    expect(screen.getByTestId('threshold-row-t1')).toBeInTheDocument();
    expect(screen.getByTestId('threshold-row-t2')).toBeInTheDocument();
  });

  it('T2 opens form dialog from "New threshold" button', () => {
    renderPage();
    fireEvent.click(screen.getByTestId('new-threshold-btn'));
    expect(screen.getByTestId('threshold-form-title')).toHaveTextContent('New threshold');
  });

  it('T3 delete row calls useDeleteExpenseThreshold.mutateAsync with the right id', async () => {
    renderPage();
    fireEvent.click(screen.getByTestId('delete-threshold-t1'));
    await waitFor(() => expect(mockDeleteMutateAsync).toHaveBeenCalledWith('t1'));
  });
});
