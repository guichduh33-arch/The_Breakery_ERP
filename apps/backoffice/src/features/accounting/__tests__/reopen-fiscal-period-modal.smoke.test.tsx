// S1-03 — smoke de la réouverture de période.
//   T1 — un PIN incomplet n'appelle pas le serveur.
//   T2 — la confirmation appelle la famille `reopen_fiscal_period` avec le motif.
//   T3 — un refus serveur se lit en clair, la fenêtre reste ouverte.
//   T4 — le motif vide n'est pas transmis.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReopenFiscalPeriodModal } from '@/features/accounting/components/ReopenFiscalPeriodModal.js';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

const PERIOD = {
  id: 'p2', period_start: '2026-03-01', period_end: '2026-03-31',
  status: 'closed', closed_at: '2026-04-05T10:00:00Z', locked_at: null,
};

function renderModal(onClose: () => void = () => undefined): void {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ReopenFiscalPeriodModal period={PERIOD} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('ReopenFiscalPeriodModal (S1-03)', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { period_id: 'p2', new_status: 'open' }, error: null });
  });

  it('T1 — an incomplete PIN shows an error and calls no RPC', () => {
    renderModal();
    fireEvent.change(screen.getByTestId('fp-reopen-pin'), { target: { value: '12' } });
    fireEvent.click(screen.getByTestId('fp-reopen-submit'));
    expect(screen.getByTestId('fp-reopen-error').textContent).toMatch(/6 digits/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('T2 — confirm calls reopen_fiscal_period_v1 with the trimmed reason, then closes', async () => {
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.change(screen.getByTestId('fp-reopen-reason'), { target: { value: '  Late invoice ' } });
    fireEvent.change(screen.getByTestId('fp-reopen-pin'), { target: { value: '285741' } });
    fireEvent.click(screen.getByTestId('fp-reopen-submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(rpc).toHaveBeenCalledWith('reopen_fiscal_period_v1', {
      p_period_id: 'p2', p_manager_pin: '285741', p_reason: 'Late invoice',
    });
  });

  it('T3 — a server refusal is shown in plain words and keeps the dialog open', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'fiscal_year_already_closed' } });
    const onClose = vi.fn();
    renderModal(onClose);
    fireEvent.change(screen.getByTestId('fp-reopen-pin'), { target: { value: '285741' } });
    fireEvent.click(screen.getByTestId('fp-reopen-submit'));
    await waitFor(() => {
      expect(screen.queryByTestId('fp-reopen-error')?.textContent).toMatch(/already closed/);
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('T4 — an empty reason is not sent', async () => {
    renderModal();
    fireEvent.change(screen.getByTestId('fp-reopen-pin'), { target: { value: '285741' } });
    fireEvent.click(screen.getByTestId('fp-reopen-submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0]?.[1]).toEqual({ p_period_id: 'p2', p_manager_pin: '285741' });
  });
});
