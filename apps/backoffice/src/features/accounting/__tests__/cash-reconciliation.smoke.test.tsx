import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

const mockRpc = vi.fn().mockResolvedValue({ data: 'je-1', error: null });
vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: (...a: unknown[]) => mockRpc(...a) } }));

import { CashReconciliationPanel } from '../components/CashReconciliationPanel.js';

const wrapper = ({ children }: { children: React.ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('CashReconciliationPanel', () => {
  beforeEach(() => mockRpc.mockClear());

  it('computes the difference and enables booking when counted > GL', () => {
    render(
      <CashReconciliationPanel
        wallet={{ account_code: '1111', account_name: 'Petty Cash', balance: 47200 }}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByPlaceholderText(/Counted/i), { target: { value: '50000' } });
    expect(screen.getByText(/Difference/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Book overage/i })).toBeEnabled();
  });

  it('shows "Balanced" and disables the button when counted equals GL', () => {
    render(
      <CashReconciliationPanel
        wallet={{ account_code: '1111', account_name: 'Petty Cash', balance: 47200 }}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByPlaceholderText(/Counted/i), { target: { value: '47200' } });
    expect(screen.getByRole('button', { name: /Balanced/i })).toBeDisabled();
  });

  it('shows "shortage" label when counted < GL', () => {
    render(
      <CashReconciliationPanel
        wallet={{ account_code: '1110', account_name: 'Undeposited Funds', balance: 100000 }}
      />,
      { wrapper },
    );
    fireEvent.change(screen.getByPlaceholderText(/Counted/i), { target: { value: '90000' } });
    expect(screen.getByRole('button', { name: /Book shortage/i })).toBeEnabled();
  });
});
