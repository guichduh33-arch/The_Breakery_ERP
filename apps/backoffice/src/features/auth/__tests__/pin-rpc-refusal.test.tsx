import type { PropsWithChildren } from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSignZReport } from '../../cash-register/hooks/useSignZReport.js';
import { useVoidZReport } from '../../cash-register/hooks/useVoidZReport.js';
import { useCloseFiscalPeriod } from '../../accounting/hooks/useCloseFiscalPeriod.js';
import { useCreateManualJournalEntry } from '../../accounting/hooks/useCreateManualJournalEntry.js';
import { useCloseFiscalYear } from '../../accounting/hooks/useCloseFiscalYear.js';
import { useApproveExpense } from '../../expenses/hooks/useExpenseActions.js';
import { useAdjustB2bBalance } from '../../btob/hooks/useAdjustB2bBalance.js';

const { rpc } = vi.hoisted(() => ({
  rpc: vi.fn<(name: string, args: Record<string, unknown>) => Promise<unknown>>(),
}));
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc } }));

const attempts: [string, () => () => Promise<unknown>][] = [
  ['sign', function useSignAttempt() {
    const mutation = useSignZReport();
    return () => mutation.mutateAsync({ zreportId: 'report', managerPin: '999999' });
  }],
  ['void', function useVoidAttempt() {
    const mutation = useVoidZReport();
    return () => mutation.mutateAsync({ zreportId: 'report', reason: 'Fixture reason', managerPin: '999999' });
  }],
  ['period', function usePeriodAttempt() {
    const mutation = useCloseFiscalPeriod();
    return () => mutation.mutateAsync({ periodId: 'period', managerPin: '999999', lock: true });
  }],
  ['journal', function useJournalAttempt() {
    const mutation = useCreateManualJournalEntry();
    return () => mutation.mutateAsync({ description: 'Fixture', entry_date: '2026-10-25', lines: [], manager_pin: '999999' });
  }],
  ['year', function useYearAttempt() {
    const mutation = useCloseFiscalYear();
    return () => mutation.mutateAsync({ fiscalYear: 2025, managerPin: '999999' });
  }],
  ['expense', function useExpenseAttempt() {
    const mutation = useApproveExpense();
    return () => mutation.mutateAsync({ id: 'expense', manager_pin: '999999' });
  }],
  ['balance', function useBalanceAttempt() {
    const mutation = useAdjustB2bBalance('customer');
    return () => mutation.mutateAsync({ delta: 100, reason: 'Fixture', managerPin: '999999' });
  }],
];

describe('refus PIN retourné par les RPC métier', () => {
  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue({ data: { ok: false, error: 'invalid_pin' }, error: null });
  });

  it.each(attempts)('%s rejette le refus sans invalider les données comme un succès', async (_name, useAttempt) => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(() => useAttempt(), { wrapper: Wrapper });
    await act(async () => { await expect(result.current()).rejects.toThrow('invalid_pin'); });
    expect(invalidate).not.toHaveBeenCalled();
    client.clear();
  });

  it('ne renouvelle pas la clé B2B après un PIN refusé', async () => {
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    function Wrapper({ children }: PropsWithChildren) {
      return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    }
    const { result } = renderHook(() => useAdjustB2bBalance('customer'), { wrapper: Wrapper });
    const input = { delta: 100, reason: 'Fixture', managerPin: '999999' };
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('invalid_pin'); });
    await act(async () => { await expect(result.current.mutateAsync(input)).rejects.toThrow('invalid_pin'); });
    expect(rpc.mock.calls[0]?.[1]?.p_idempotency_key).toBe(rpc.mock.calls[1]?.[1]?.p_idempotency_key);
    client.clear();
  });
});
