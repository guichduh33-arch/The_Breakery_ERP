import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { GlLine } from '../contracts.js';
import { bankDetailFixture } from './fixtures.js';

// Les lignes d'attente arrivent par pages triées par identifiant : une journée
// de ventes est répartie sur plusieurs pages.
const line = (n: number, date: string, code: string, amount: string): GlLine => ({
  id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`, entry_date: date, entry_number: `JE-${n}`,
  amount, description: `Sale ${n}`, reference_type: 'sale', match_id: null, account_code: code,
});
const page1 = [line(1, '2026-10-01', '1115', '100000.00'), line(2, '2026-10-01', '1116', '200000.00'), line(3, '2026-10-02', '1115', '50000.00')];
const page2 = [line(4, '2026-10-01', '1115', '25000.00'), line(5, '2026-10-02', '1116', '75000.00')];
const state = vi.hoisted(() => ({ fetchNextPage: vi.fn() }));
vi.mock('../useBankQueries.js', () => ({
  useBankClearing: () => ({ data: { pages: [{ items: page1, next: 'x' }] }, isLoading: false, error: null, hasNextPage: true,
    isFetchingNextPage: false, fetchNextPage: state.fetchNextPage, refetch: vi.fn() }),
}));
import { BankPostDialog } from '../BankPostDialog.js';

describe('bank post dialog — settlement by sales day', () => {
  it('loads every clearing page, then selects only the lines of the chosen day and account', async () => {
    state.fetchNextPage.mockResolvedValue({ error: null, hasNextPage: false, data: { pages: [{ items: page1 }, { items: page2 }] } });
    render(<BankPostDialog reconciliation={bankDetailFixture.reconciliation} bankLines={bankDetailFixture.bank_lines} glLines={[]}
      accounts={[]} onClose={vi.fn()} onReady={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Sales date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Clearing account'), { target: { value: '1115' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the whole day' }));
    await waitFor(() => expect(screen.getByText(/^2 lines selected/)).toBeInTheDocument());
    expect(state.fetchNextPage).toHaveBeenCalledTimes(1);
    // Le tableau ne montre que la journée choisie ; la ligne de la page 2 n'y est pas encore chargée.
    expect(screen.getByRole('checkbox', { name: /JE-1 / })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /JE-2 / })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /JE-3 / })).not.toBeInTheDocument();
  });

  it('adds a second clearing account of the same day instead of replacing the first', async () => {
    state.fetchNextPage.mockResolvedValue({ error: null, hasNextPage: false, data: { pages: [{ items: page1 }, { items: page2 }] } });
    render(<BankPostDialog reconciliation={bankDetailFixture.reconciliation} bankLines={bankDetailFixture.bank_lines} glLines={[]}
      accounts={[]} onClose={vi.fn()} onReady={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Sales date'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Clearing account'), { target: { value: '1115' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the whole day' }));
    await waitFor(() => expect(screen.getByText(/^2 lines selected/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText('Clearing account'), { target: { value: '1116' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the whole day' }));
    await waitFor(() => expect(screen.getByText(/^3 lines selected/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.getByText(/^0 lines selected/)).toBeInTheDocument();
  });

  it('says so when the day has no unsettled line for that account', async () => {
    state.fetchNextPage.mockResolvedValue({ error: null, hasNextPage: false, data: { pages: [{ items: page1 }, { items: page2 }] } });
    render(<BankPostDialog reconciliation={bankDetailFixture.reconciliation} bankLines={bankDetailFixture.bank_lines} glLines={[]}
      accounts={[]} onClose={vi.fn()} onReady={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Sales date'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Clearing account'), { target: { value: '1116' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add the whole day' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No unsettled clearing lines for this date and account.');
    expect(screen.getByText(/^0 lines selected/)).toBeInTheDocument();
  });
});
