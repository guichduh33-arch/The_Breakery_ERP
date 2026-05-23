// apps/backoffice/src/features/accounting/__tests__/chart-of-accounts.smoke.test.tsx
//
// Session 26b / Wave 1.E — smoke for ChartOfAccountsPage.
//   T1 — Renders accounts + class filter narrows visible rows.
//   T2 — Toggle invokes update_account_active_v1 when canWrite=true.
//   T3 — Toggle button disabled when canWrite=false.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ChartOfAccountsPage from '@/features/accounting/pages/ChartOfAccountsPage.js';

const mockRpc = vi.fn();

const ACCOUNTS = [
  {
    id: 'a1', code: '1110', name: 'Cash on Hand',
    account_class: 1, account_type: 'asset', balance_type: 'debit',
    is_postable: true, is_system: true, is_active: true, cash_flow_section: 'operating',
  },
  {
    id: 'a2', code: '4100', name: 'Sales Revenue Food',
    account_class: 4, account_type: 'revenue', balance_type: 'credit',
    is_postable: true, is_system: true, is_active: true, cash_flow_section: 'operating',
  },
  {
    id: 'a3', code: '5910', name: 'Cash Variance Loss',
    account_class: 6, account_type: 'expense', balance_type: 'debit',
    is_postable: true, is_system: false, is_active: true, cash_flow_section: 'operating',
  },
];

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function buildChain() {
    const result: RpcResult = { data: ACCOUNTS, error: null };
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      is:     () => chain,
      order:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => buildChain(),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? {
          data: { account_id: 'a3', code: '5910', is_active: false, no_op: false },
          error: null,
        });
      },
    },
  };
});

let MOCK_CAN_WRITE = true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => (p === 'accounting.coa.write' ? MOCK_CAN_WRITE : true) }),
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
        <ChartOfAccountsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ChartOfAccountsPage (S26b Wave 1)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    MOCK_CAN_WRITE = true;
  });

  it('T1 — renders accounts and class filter narrows visible rows', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('coa-row-1110')).not.toBeNull();
      expect(screen.queryByTestId('coa-row-4100')).not.toBeNull();
      expect(screen.queryByTestId('coa-row-5910')).not.toBeNull();
    });

    // Filter by class 4 (Revenue) → only 4100 remains.
    fireEvent.change(screen.getByTestId('coa-class-filter'), { target: { value: '4' } });
    await waitFor(() => {
      expect(screen.queryByTestId('coa-row-1110')).toBeNull();
      expect(screen.queryByTestId('coa-row-4100')).not.toBeNull();
      expect(screen.queryByTestId('coa-row-5910')).toBeNull();
    });
  });

  it('T2 — toggle invokes update_account_active_v1 when canWrite=true', async () => {
    renderPage();
    const btn = await screen.findByTestId('coa-toggle-5910');
    expect(btn).toBeEnabled();
    fireEvent.click(btn);
    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith(
        'update_account_active_v1',
        expect.objectContaining({ p_account_id: 'a3', p_is_active: false }),
      );
    });
  });

  it('T3 — toggle button disabled when canWrite=false', async () => {
    MOCK_CAN_WRITE = false;
    renderPage();
    const btn = await screen.findByTestId('coa-toggle-5910');
    expect(btn).toBeDisabled();
  });
});
