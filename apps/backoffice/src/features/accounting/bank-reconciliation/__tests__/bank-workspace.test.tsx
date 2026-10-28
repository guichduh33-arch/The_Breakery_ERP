import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { bankCatalogFixture, bankDetailFixture, fixtureMatch, fixtureRec } from './fixtures.js';
import { financialTestAuth, installFinancialBrowser, resetFinancialSession } from '@/lib/__tests__/financialAttemptTestUtils.js';
const state = vi.hoisted<{ hasNextPage: boolean; isFetching: boolean; detail: unknown }>(() => ({ hasNextPage: false,isFetching: false,detail: null }));
vi.mock('@/stores/authStore.js',async () => ({ useAuthStore: (await import('@/lib/__tests__/financialAttemptTestUtils.js')).financialTestAuth }));
vi.mock('../useBankQueries.js',() => ({
  useBankDetail: () => ({ data: { pages: [state.detail] },isFetching: state.isFetching,isError: false,error: null,hasNextPage: state.hasNextPage,refetch: vi.fn() }),
  useBankSuggestions: () => ({ data: { pages: [{ items: [] }] },isLoading: false,error: null,hasNextPage: false }),
  useBankClearing: () => ({ data: { pages: [] },isLoading: false,error: null,hasNextPage: false }),
}));
vi.mock('@/lib/supabase.js',() => ({ supabase: { rpc: () => { throw new Error('Unexpected mutation'); } } }));
import { BankWorkspace } from '../BankWorkspace.js';
const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>;
describe('bank workspace',() => {
  beforeEach(() => { installFinancialBrowser(); resetFinancialSession(); state.detail = structuredClone(bankDetailFixture); state.hasNextPage = false; state.isFetching = false; });
  it('offers a grouped exact match and keeps fractional amounts visible',() => {
    render(<BankWorkspace reconciliationId={fixtureRec} catalog={bankCatalogFixture} />,{ wrapper });
    const button = screen.getByRole('button',{ name: 'Review match' }); expect(button).toBeDisabled();
    const checks = screen.getAllByRole('checkbox').filter((node) => node.getAttribute('aria-label')?.startsWith('Select'));
    expect(checks).toHaveLength(2); checks.forEach((node) => fireEvent.click(node));
    expect(button).toBeEnabled(); fireEvent.click(button);
    expect(screen.getByText(/Match 1 bank movements with 1 ledger lines/)).toBeInTheDocument();
    expect(screen.getAllByText('Rp 1,379,998.62').length).toBeGreaterThan(0);
  });
  it('refuses a one-cent mismatch',() => {
    const value = structuredClone(bankDetailFixture); value.gl_lines[0]!.amount = '1379998.61'; state.detail = value;
    render(<BankWorkspace reconciliationId={fixtureRec} catalog={bankCatalogFixture} />,{ wrapper });
    screen.getAllByRole('checkbox').filter((node) => node.getAttribute('aria-label')?.startsWith('Select')).forEach((node) => fireEvent.click(node));
    expect(screen.getByRole('button',{ name: 'Review match' })).toBeDisabled(); expect(screen.getByText('Rp 0.01')).toBeInTheDocument();
  });
  it('keeps finalization blocked until all pages and all bank lines are resolved',() => {
    state.hasNextPage = true;
    render(<BankWorkspace reconciliationId={fixtureRec} catalog={bankCatalogFixture} />,{ wrapper });
    expect(screen.getByRole('button',{ name: 'Finalize' })).toBeDisabled();
  });
  it('locks finalized snapshots and shows source drift without replacing the frozen balances',() => {
    const value = structuredClone(bankDetailFixture); value.reconciliation.status = 'finalized';
    value.bank_lines[0]!.match_id = fixtureMatch; value.gl_lines[0]!.match_id = fixtureMatch;
    value.source_integrity = { state: 'changed',recorded_gl_closing: '1379998.62',current_gl_closing: '1379998.63' }; state.detail = value;
    render(<BankWorkspace reconciliationId={fixtureRec} catalog={bankCatalogFixture} />,{ wrapper });
    expect(screen.getByRole('alert')).toHaveTextContent('ledger changed');
    expect(screen.getByRole('button',{ name: 'Finalize' })).toBeDisabled();
    expect(screen.queryByRole('button',{ name: 'Settlement / fees' })).not.toBeInTheDocument();
    screen.getAllByRole('checkbox').filter((node) => node.getAttribute('aria-label')?.startsWith('Select')).forEach((node) => expect(node).toBeDisabled());
  });
  it('hides monetary actions for read-only users',() => {
    financialTestAuth.setState({ hasPermission: (permission) => permission === 'accounting.bank.read' });
    render(<BankWorkspace reconciliationId={fixtureRec} catalog={bankCatalogFixture} />,{ wrapper });
    for (const name of ['Finalize','Statement balances','Add statement file','Settlement / fees','Review match']) expect(screen.queryByRole('button',{ name })).not.toBeInTheDocument();
  });
});
