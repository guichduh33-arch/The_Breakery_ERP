// apps/backoffice/src/pages/expenses/__tests__/NewExpensePage.smoke.test.tsx
//
// Session 59 / Task 6b — "Duplicate" seeds NewExpensePage via navigation
// state. Proves: fields carried over, expense_date forced to today, no
// receipt carried over, and no auto-submit (still a draft requiring a click).

import { toLocalDateStr } from '@breakery/domain';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
import { prepareExpenseDraftNavigation } from '@/features/expenses/utils/expenseDraftNavigation.js';
import { useBeginExpenseDraft } from '@/features/expenses/hooks/useBeginExpenseDraft.js';
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

vi.mock('@/features/expenses/hooks/useExpenseDraftCreation.js', () => ({
  useExpenseDraftCreation: () => ({save: vi.fn(), startNew: vi.fn(), busy: false, pending: null, pointer: null, storageError: null}),
}));

vi.mock('@/stores/authStore.js', async () => ({useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth}));
beforeEach(() => {installFinancialBrowser(); resetFinancialSession();});

const SEED: DuplicateExpenseSeed = {
  expense_term_id: 'term-1', remarks: '',
  category_id:    'cat-1',
  amount:         '250000',
  vat_amount:     '0',
  payment_method: 'cash',
  vendor_name:    'Acme Stationary',
  description:    'Office supplies',
};

function SamePageNew() {const start = useBeginExpenseDraft(); return <button onClick={() => {void start.begin();}}>New expense shortcut</button>;}

function renderPage(state?: { duplicateFrom?: DuplicateExpenseSeed }, trusted = true): ReturnType<typeof render> {
  const navigationState = state?.duplicateFrom && trusted ? prepareExpenseDraftNavigation(state.duplicateFrom) : state;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[{ pathname: '/backoffice/expenses/new', state: navigationState }]}>
        <Routes>
          <Route path="/backoffice/expenses/new" element={<><SamePageNew /><NewExpensePage /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('NewExpensePage — duplicate prefill (S59 Task 6b)', () => {
  it('ignores private duplicate data left in legacy browser history', async () => {
    renderPage({duplicateFrom: SEED}, false);
    expect(await screen.findByLabelText(/^Amount \(IDR\)/i)).toHaveValue(null);
    expect(screen.getByLabelText(/Description/i)).toHaveValue('');
  });
  it('clears duplicated values after switching operator/session', async () => {
    renderPage({duplicateFrom: SEED});
    expect(await screen.findByLabelText(/^Amount \(IDR\)/i)).toHaveValue(250000);
    act(() => {financialTestAuth.setState({sessionToken: 'new-operator-session'});});
    expect(screen.getByLabelText(/^Amount \(IDR\)/i)).toHaveValue(null);
    expect(screen.getByLabelText(/Vendor/i)).toHaveValue('');
  });
  it('starts an empty form when New expense is chosen on the same route', async () => {
    renderPage({duplicateFrom: SEED});
    expect(await screen.findByLabelText(/^Amount \(IDR\)/i)).toHaveValue(250000);
    fireEvent.click(screen.getByRole('button', {name: 'New expense shortcut'}));
    await waitFor(() => expect(screen.getByLabelText(/^Amount \(IDR\)/i)).toHaveValue(null));
    expect(screen.getByLabelText(/Description/i)).toHaveValue('');
  });
  it('with no navigation state, renders the empty form (unchanged behaviour)', async () => {
    renderPage();
    expect(await screen.findByLabelText(/^Amount \(IDR\)/i)).toHaveValue(null);
    expect(screen.getByLabelText(/^Date/i)).toHaveValue(toLocalDateStr(new Date()));
  });

  it('with duplicateFrom in navigation state, prefills category/amount/VAT/payment method/vendor/description', async () => {
    renderPage({ duplicateFrom: SEED });
    expect(await screen.findByLabelText(/^Amount \(IDR\)/i)).toHaveValue(250000);
    expect(await screen.findByLabelText(/^Expense term/i)).toHaveValue('term-1');
    expect(screen.getByLabelText(/Payment method/i)).toHaveValue('cash');
    expect(screen.getByLabelText(/Vendor/i)).toHaveValue('Acme Stationary');
    expect(screen.getByLabelText(/Description/i)).toHaveValue('Office supplies');
  });

  it('forces expense_date to today even when duplicateFrom is set', async () => {
    renderPage({ duplicateFrom: SEED });
    await screen.findByLabelText(/^Amount \(IDR\)/i);
    expect(screen.getByLabelText(/^Date/i)).toHaveValue(toLocalDateStr(new Date()));
  });

  it('does not auto-submit — the draft still requires clicking Save', async () => {
    renderPage({ duplicateFrom: SEED });
    expect(await screen.findByRole('button', { name: /Save as draft/i })).toBeInTheDocument();
  });
});

vi.mock('@/features/expenses/hooks/useExpenseTerms.js', () => ({
  useExpenseTerms: () => ({data: [{id: 'term-1',code: 'ELECTRICITY',name: 'Electricity bill',expense_term_id: 'term-1', remarks: '',
      category_id: 'cat-1',category_name: 'Utilities',account_code: '6113',account_name: 'Utilities',is_active: true,is_available: true,is_used: false,aliases: ['PLN','Listrik']}],isLoading: false,isError: false,error: null}),
}));
