// apps/backoffice/src/features/accounting/__tests__/annual-close-modal.smoke.test.tsx
//
// Session 56 — DEV-S54-01 — smoke for AnnualCloseModal + Annual close button.
//   T1 — With accounting.year.close granted, ac-open-btn renders and opens modal.
//   T2 — Without accounting.year.close, ac-open-btn is absent.
//   T3 — Step 2 submit with a year_already_closed RPC error surfaces the copy.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SettingsAccountingPage from '@/features/accounting/pages/SettingsAccountingPage.js';
import { AnnualCloseModal } from '@/features/accounting/components/AnnualCloseModal.js';

const mockRpc = vi.fn();

// 12 closed periods for FY2026 — the year selector derives from period_start.
const PERIODS = Array.from({ length: 12 }, (_, i) => {
  const mm = String(i + 1).padStart(2, '0');
  return {
    id: `p2026-${mm}`,
    period_start: `2026-${mm}-01`,
    period_end: `2026-${mm}-28`,
    status: 'closed',
    closed_at: '2026-12-31T10:00:00Z',
    locked_at: null,
  };
});

interface RpcResult { data: unknown; error: { message: string } | null }

vi.mock('@/lib/supabase.js', () => {
  function buildChain() {
    const result: RpcResult = { data: PERIODS, error: null };
    type Resolver = (v: RpcResult) => unknown;
    const chain: Record<string, unknown> = {
      select: () => chain,
      order:  () => chain,
      limit:  () => chain,
      then:   (resolve: Resolver) => resolve(result),
    };
    return chain;
  }
  return {
    supabase: {
      from: () => buildChain(),
      rpc:  (fn: string, args: unknown) => Promise.resolve(mockRpc(fn, args) ?? {
        data: { fiscal_year: 2026, je_id: null, entry_number: null, net_result: 0,
                line_count: 0, retained_earnings_account: '3200',
                periods_seeded_next_year: 12 },
        error: null,
      }),
    },
  };
});

let MOCK_CAN_YEAR = true;
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => (p === 'accounting.year.close' ? MOCK_CAN_YEAR : true) }),
}));

function newClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

function renderPage(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <SettingsAccountingPage />
    </QueryClientProvider>,
  );
}

function renderModal(): void {
  render(
    <QueryClientProvider client={newClient()}>
      <AnnualCloseModal onClose={() => undefined} />
    </QueryClientProvider>,
  );
}

describe('AnnualCloseModal (S56 DEV-S54-01)', () => {
  beforeEach(() => {
    mockRpc.mockReset();
    MOCK_CAN_YEAR = true;
  });

  it('T1 — with accounting.year.close, ac-open-btn renders and opens the modal', async () => {
    MOCK_CAN_YEAR = true;
    renderPage();

    const openBtn = await screen.findByTestId('ac-open-btn');
    expect(openBtn).not.toBeNull();

    fireEvent.click(openBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('ac-modal-year-select')).not.toBeNull();
    });
  });

  it('T2 — without accounting.year.close, ac-open-btn is absent', async () => {
    MOCK_CAN_YEAR = false;
    renderPage();

    // Let the periods query settle so the header has fully rendered.
    await waitFor(() => {
      expect(screen.queryByTestId('fp-table')).not.toBeNull();
    });
    expect(screen.queryByTestId('ac-open-btn')).toBeNull();
  });

  it('T3 — year_already_closed error surfaces the copy in ac-modal-error', async () => {
    renderModal();

    // Wait for the FY2026 option to be derived from fiscal_periods.
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /2026/i })).not.toBeNull();
    });

    fireEvent.change(screen.getByTestId('ac-modal-year-select'),
      { target: { value: '2026' } });
    fireEvent.click(screen.getByTestId('ac-modal-next'));

    await waitFor(() => {
      expect(screen.queryByTestId('ac-modal-pin')).not.toBeNull();
    });
    fireEvent.change(screen.getByTestId('ac-modal-pin'), { target: { value: '123456' } });

    // The RPC rejects with a message classifyCloseFiscalYearError maps to year_already_closed.
    mockRpc.mockReturnValue({ data: null, error: { message: 'year_already_closed: 2026' } });
    fireEvent.click(screen.getByTestId('ac-modal-submit'));

    await waitFor(() => {
      const errEl = screen.queryByTestId('ac-modal-error');
      expect(errEl).not.toBeNull();
      expect(errEl?.textContent ?? '').toContain('This fiscal year is already closed.');
    });
    expect(mockRpc).toHaveBeenCalledWith('close_fiscal_year_v1',
      expect.objectContaining({ p_fiscal_year: 2026, p_manager_pin: '123456' }));
  });
});
