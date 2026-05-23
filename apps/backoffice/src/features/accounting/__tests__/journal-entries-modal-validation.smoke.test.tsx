// apps/backoffice/src/features/accounting/__tests__/journal-entries-modal-validation.smoke.test.tsx
//
// Session 26b / Wave 2.D — modal validation smoke for CreateManualJEModal.
//   T1 — Unbalanced entry surfaces inline error and does NOT call RPC.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CreateManualJEModal } from '@/features/accounting/components/CreateManualJEModal.js';

const mockRpc = vi.fn();

const ACCOUNTS = [
  { id: 'a1', code: '1110', name: 'Cash', account_class: 1 },
  { id: 'a2', code: '5810', name: 'Rent Expense', account_class: 6 },
];

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
      rpc:  (fn: string, args: unknown) => Promise.resolve(mockRpc(fn, args) ?? {
        data: null, error: null,
      }),
    },
  };
});

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

describe('CreateManualJEModal validation (S26b Wave 2.D)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — unbalanced entry surfaces inline error, no RPC call', async () => {
    render(
      <QueryClientProvider client={newClient()}>
        <CreateManualJEModal onClose={() => undefined} />
      </QueryClientProvider>,
    );

    fireEvent.change(screen.getByTestId('je-modal-description'),
      { target: { value: 'Unbalanced test' } });
    fireEvent.click(screen.getByTestId('je-modal-next'));

    await waitFor(() => {
      expect(screen.queryByTestId('je-modal-lines-table')).not.toBeNull();
    });
    // Wait for accounts options to be hydrated (async useQuery — accounts.data
    // populates after one tick once the modal mounts).
    await waitFor(
      () => {
        const opts = screen.queryAllByRole('option');
        expect(opts.length).toBeGreaterThanOrEqual(2 /* selects */ * 3 /* select + 2 acc */);
      },
      { timeout: 4000 },
    );

    const accountSelects = screen.getAllByTestId(/^je-modal-line-account-/);
    fireEvent.change(accountSelects[0]!, { target: { value: 'a2' } });
    fireEvent.change(accountSelects[1]!, { target: { value: 'a1' } });

    const debits  = screen.getAllByRole('spinbutton').filter((_, i) => i % 2 === 0);
    const credits = screen.getAllByRole('spinbutton').filter((_, i) => i % 2 === 1);
    // Debit 100 / Credit 50 -> unbalanced by 50
    fireEvent.change(debits[0]!,  { target: { value: '100' } });
    fireEvent.change(credits[1]!, { target: { value: '50' } });

    fireEvent.change(screen.getByTestId('je-modal-pin'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('je-modal-submit'));

    await waitFor(() => {
      const errEl = screen.queryByTestId('je-modal-error');
      expect(errEl).not.toBeNull();
      expect(errEl?.textContent ?? '').toMatch(/Unbalanced/i);
    });
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
