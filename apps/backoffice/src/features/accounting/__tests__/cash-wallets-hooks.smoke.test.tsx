import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { useCashWallets } from '../hooks/useCashWallets.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('useCashWallets', () => {
  beforeEach(() => rpc.mockReset());

  it('maps the balances RPC payload', async () => {
    rpc.mockResolvedValueOnce({ data: [
      { account_code: '1110', account_name: 'Cash on Hand', balance: 6453000 },
      { account_code: '1111', account_name: 'Petty Cash',  balance: 47200 },
      { account_code: '1117', account_name: 'Small Money', balance: 4000000 },
    ], error: null });

    const { result } = renderHook(() => useCashWallets(), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toHaveLength(3);
    expect(rpc).toHaveBeenCalledWith('get_cash_wallet_balances_v1', {});
  });
});
