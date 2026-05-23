// apps/backoffice/src/features/accounting/__tests__/general-ledger.smoke.test.tsx
//
// Session 26b / Wave 3 — smoke for GeneralLedgerPage.
//   T1 — Account selector populated ; selecting an account triggers RPC.
//   T2 — Paginate : 2nd page Load more invokes RPC with p_cursor from page 1.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import GeneralLedgerPage from '@/features/accounting/pages/GeneralLedgerPage.js';

const mockRpc = vi.fn();

const ACCOUNTS = [
  {
    id: 'a-cash', code: '1110', name: 'Cash on Hand',
    account_class: 1, account_type: 'asset', balance_type: 'debit',
    is_postable: true, is_system: true, is_active: true, cash_flow_section: 'operating',
  },
];

const PAGE_1 = {
  account: {
    id: 'a-cash', code: '1110', name: 'Cash on Hand',
    account_class: 1, balance_type: 'debit', is_active: true,
  },
  period: { start: '2026-05-01', end: '2026-05-31' },
  opening_balance: 1000000,
  total_debit:  500000,
  total_credit: 200000,
  lines: [
    {
      je_id: 'je1', entry_number: 'JE-2026-0001', entry_date: '2026-05-02',
      description: 'Sale', reference_type: 'sale', reference_id: 'o1',
      debit: 300000, credit: 0, line_description: null,
    },
  ],
  next_cursor: { last_date: '2026-05-02', last_id: 'je1' },
};
const PAGE_2 = {
  ...PAGE_1,
  lines: [
    {
      je_id: 'je2', entry_number: 'JE-2026-0002', entry_date: '2026-05-03',
      description: 'Withdrawal', reference_type: 'cash_movement', reference_id: 'cm1',
      debit: 0, credit: 200000, line_description: null,
    },
  ],
  next_cursor: null,
};

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function tableData(table: string): RpcResult {
    if (table === 'accounts') return { data: ACCOUNTS, error: null };
    return { data: [], error: null };
  }
  function buildChain(table: string) {
    const result = tableData(table);
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      is:     () => chain,
      eq:     () => chain,
      order:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? { data: PAGE_1, error: null });
      },
    },
  };
});

vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: () => true }),
}));

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <MemoryRouter>
        <GeneralLedgerPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('GeneralLedgerPage (S26b Wave 3)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — selecting an account triggers get_general_ledger_v1 RPC', async () => {
    mockRpc.mockReturnValueOnce({ data: PAGE_1, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /1110/i })).not.toBeNull();
    });

    fireEvent.change(screen.getByTestId('gl-account-select'),
      { target: { value: 'a-cash' } });

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_general_ledger_v1',
        expect.objectContaining({ p_account_id: 'a-cash' }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('gl-row-JE-2026-0001')).not.toBeNull();
    });
  });

  it('T2 — Load more passes p_cursor from page 1', async () => {
    mockRpc.mockReturnValueOnce({ data: PAGE_1, error: null });
    renderPage();
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /1110/i })).not.toBeNull();
    });
    fireEvent.change(screen.getByTestId('gl-account-select'),
      { target: { value: 'a-cash' } });
    await waitFor(() => {
      expect(screen.queryByTestId('gl-row-JE-2026-0001')).not.toBeNull();
    });

    mockRpc.mockReturnValueOnce({ data: PAGE_2, error: null });
    fireEvent.click(screen.getByTestId('gl-load-more'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('get_general_ledger_v1',
        expect.objectContaining({
          p_account_id: 'a-cash',
          p_cursor: { last_date: '2026-05-02', last_id: 'je1' },
        }));
    });
    await waitFor(() => {
      expect(screen.queryByTestId('gl-row-JE-2026-0002')).not.toBeNull();
    });
  });
});
