import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const rpc = vi.fn();
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));
vi.mock('@/components/PermissionGate.js', () => ({ default: ({ children }: any) => <>{children}</>, PermissionGate: ({ children }: any) => <>{children}</> }));

import CashTreasuryPage from '../pages/CashTreasuryPage.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('CashTreasuryPage', () => {
  beforeEach(() => rpc.mockReset());

  it('renders the three wallet cards from balances', async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === 'get_cash_wallet_balances_v1') return Promise.resolve({ data: [
        { account_code: '1110', account_name: 'Cash on Hand', balance: 6453000 },
        { account_code: '1111', account_name: 'Petty Cash',  balance: 47200 },
        { account_code: '1117', account_name: 'Small Money', balance: 4000000 },
      ], error: null });
      return Promise.resolve({ data: [], error: null });
    });

    render(<CashTreasuryPage />, { wrapper });
    await waitFor(() => expect(screen.getByText(/Undeposited/i)).toBeInTheDocument());
    expect(screen.getByText(/Petty Cash/i)).toBeInTheDocument();
    expect(screen.getByText(/Small Money/i)).toBeInTheDocument();
  });
});
