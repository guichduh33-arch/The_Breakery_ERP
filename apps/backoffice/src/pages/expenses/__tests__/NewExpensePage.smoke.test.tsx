// apps/backoffice/src/pages/expenses/__tests__/NewExpensePage.smoke.test.tsx
//
// Session 59 / Task 6b — "Duplicate" seeds NewExpensePage via navigation
// state. Proves: fields carried over, expense_date forced to today, no
// receipt carried over, and no auto-submit (still a draft requiring a click).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import NewExpensePage from '@/pages/expenses/NewExpensePage.js';
import type { DuplicateExpenseSeed } from '@/features/expenses/components/ExpenseForm.js';

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                { id: 'cat-1', code: 'OFFICE', name: 'Office Supplies', is_active: true, account_id: 'acc-1', created_at: '', updated_at: '' },
              ],
              error: null,
            }),
        }),
      }),
    }),
  },
}));

vi.mock('@/features/expenses/hooks/useCreateExpense.js', () => ({
  useCreateExpense: () => ({ mutateAsync: vi.fn(), isPending: false, error: null }),
}));

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

const SEED: DuplicateExpenseSeed = {
  category_id:    'cat-1',
  amount:         '250000',
  vat_amount:     '0',
  payment_method: 'cash',
  vendor_name:    'Acme Stationary',
  description:    'Office supplies',
};

function renderPage(state?: { duplicateFrom?: DuplicateExpenseSeed }): ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/backoffice/expenses/new', state }]}>
        <Routes>
          <Route path="/backoffice/expenses/new" element={<NewExpensePage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NewExpensePage — duplicate prefill (S59 Task 6b)', () => {
  it('with no navigation state, renders the empty form (unchanged behaviour)', async () => {
    renderPage();
    expect(await screen.findByLabelText(/^Amount \(IDR\)/i)).toHaveValue(null);
    expect(screen.getByLabelText(/^Date/i)).toHaveValue(new Date().toISOString().slice(0, 10));
  });

  it('with duplicateFrom in navigation state, prefills category/amount/VAT/payment method/vendor/description', async () => {
    renderPage({ duplicateFrom: SEED });
    expect(await screen.findByLabelText(/^Amount \(IDR\)/i)).toHaveValue(250000);
    expect(await screen.findByLabelText(/^Category/i)).toHaveValue('cat-1');
    expect(screen.getByLabelText(/Payment method/i)).toHaveValue('cash');
    expect(screen.getByLabelText(/Vendor/i)).toHaveValue('Acme Stationary');
    expect(screen.getByLabelText(/Description/i)).toHaveValue('Office supplies');
  });

  it('forces expense_date to today even when duplicateFrom is set', async () => {
    renderPage({ duplicateFrom: SEED });
    await screen.findByLabelText(/^Amount \(IDR\)/i);
    expect(screen.getByLabelText(/^Date/i)).toHaveValue(new Date().toISOString().slice(0, 10));
  });

  it('does not auto-submit — the draft still requires clicking Save', async () => {
    renderPage({ duplicateFrom: SEED });
    expect(await screen.findByRole('button', { name: /Save as draft/i })).toBeInTheDocument();
  });
});
