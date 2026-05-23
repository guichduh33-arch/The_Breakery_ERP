// apps/backoffice/src/features/accounting/__tests__/journal-entries.smoke.test.tsx
//
// Session 26b / Wave 2.D — smoke for JournalEntriesPage.
//   T1 — Renders journal entries from useJournalEntries.
//   T2 — "+ New manual JE" opens modal ; balanced 2-line entry submits.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import JournalEntriesPage from '@/features/accounting/pages/JournalEntriesPage.js';

const mockRpc = vi.fn();

const ENTRIES = [
  {
    id: 'je1', entry_number: 'JE-2026-0001', entry_date: '2026-05-20',
    description: 'Test sale', reference_type: 'sale', reference_id: 'o1',
    status: 'posted', total_debit: 50000, total_credit: 50000,
    created_at: '2026-05-20T10:00:00Z',
  },
  {
    id: 'je2', entry_number: 'JE-2026-0002', entry_date: '2026-05-21',
    description: 'April rent', reference_type: 'manual', reference_id: null,
    status: 'posted', total_debit: 12000000, total_credit: 12000000,
    created_at: '2026-05-21T09:00:00Z',
  },
];
const ACCOUNTS = [
  { id: 'a1', code: '1110', name: 'Cash', account_class: 1 },
  { id: 'a2', code: '5810', name: 'Rent Expense', account_class: 6 },
];

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function tableData(table: string): RpcResult {
    if (table === 'journal_entries') return { data: ENTRIES, error: null };
    if (table === 'accounts')        return { data: ACCOUNTS, error: null };
    if (table === 'journal_entry_lines') return { data: [], error: null };
    return { data: [], error: null };
  }
  function buildChain(table: string) {
    const result = tableData(table);
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      is:     () => chain,
      eq:     () => chain,
      gte:    () => chain,
      lte:    () => chain,
      order:  () => chain,
      limit:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => buildChain(table),
      rpc:  (fn: string, args: unknown) => {
        const out = mockRpc(fn, args) as RpcResult | undefined;
        return Promise.resolve(out ?? {
          data: {
            je_id: 'new-je', entry_number: 'JE-2026-0003',
            entry_date: '2026-05-23', total_debit: 100, total_credit: 100, line_count: 2,
          },
          error: null,
        });
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
        <JournalEntriesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('JournalEntriesPage (S26b Wave 2)', () => {
  beforeEach(() => mockRpc.mockReset());

  it('T1 — renders journal entries from useJournalEntries', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.queryByTestId('je-row-JE-2026-0001')).not.toBeNull();
      expect(screen.queryByTestId('je-row-JE-2026-0002')).not.toBeNull();
    });
  });

  it('T2 — opens manual JE modal and submits a balanced 2-line entry', async () => {
    renderPage();
    fireEvent.click(await screen.findByTestId('je-new-btn'));

    fireEvent.change(screen.getByTestId('je-modal-description'),
      { target: { value: 'April rent payment' } });
    fireEvent.click(screen.getByTestId('je-modal-next'));

    // Step 2 — fill two lines + PIN
    await waitFor(() => {
      expect(screen.queryByTestId('je-modal-lines-table')).not.toBeNull();
    });
    await waitFor(
      () => {
        const opts = screen.queryAllByRole('option');
        expect(opts.length).toBeGreaterThanOrEqual(6);
      },
      { timeout: 4000 },
    );

    const accountSelects = screen.getAllByTestId(/^je-modal-line-account-/);
    expect(accountSelects.length).toBe(2);
    fireEvent.change(accountSelects[0]!, { target: { value: 'a2' } }); // Rent Expense
    fireEvent.change(accountSelects[1]!, { target: { value: 'a1' } }); // Cash

    // Find debit/credit inputs by position within the table rows.
    const debits  = screen.getAllByRole('spinbutton').filter((_, i) => i % 2 === 0);
    const credits = screen.getAllByRole('spinbutton').filter((_, i) => i % 2 === 1);
    fireEvent.change(debits[0]!,  { target: { value: '12000000' } });
    fireEvent.change(credits[1]!, { target: { value: '12000000' } });

    fireEvent.change(screen.getByTestId('je-modal-pin'), { target: { value: '123456' } });

    fireEvent.click(screen.getByTestId('je-modal-submit'));

    await waitFor(() => {
      expect(mockRpc).toHaveBeenCalledWith('create_manual_je_v1',
        expect.objectContaining({
          p_description: 'April rent payment',
          p_manager_pin: '123456',
          p_lines: expect.arrayContaining([
            expect.objectContaining({ account_id: 'a2', debit:  12000000 }),
            expect.objectContaining({ account_id: 'a1', credit: 12000000 }),
          ]),
        }),
      );
    });
  });
});
