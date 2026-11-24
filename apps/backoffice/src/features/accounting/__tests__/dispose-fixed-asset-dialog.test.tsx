// apps/backoffice/src/features/accounting/__tests__/dispose-fixed-asset-dialog.test.tsx
//
// ADR-047 décision 8 — sortie d'un équipement. Le PIN faux REVIENT en
// { ok:false } (pas d'exception) et se ressaisit ; prix et compte n'existent
// que pour une vente, et seuls les comptes de trésorerie sont proposés ; hors
// vente, la RPC reçoit NULL pour les deux. L'aperçu gain/perte est indicatif.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { todayIsoDate } from '@breakery/utils';
import { DisposeFixedAssetDialog } from '@/features/accounting/components/DisposeFixedAssetDialog.js';

interface RpcResult { data: unknown; error: { message: string } | null }
const state = vi.hoisted(() => ({
  rpc: vi.fn((_fn: string, _args?: unknown): Promise<RpcResult> => Promise.resolve({ data: null, error: null })),
}));

const ACCOUNTS = [
  { id: 'acc-cash', code: '1110', name: 'Cash', account_class: 1, account_type: 'asset', balance_type: 'debit',
    is_postable: true, is_system: true, is_active: true, cash_flow_section: 'none' },
  { id: 'acc-bank-off', code: '1120', name: 'Closed bank', account_class: 1, account_type: 'asset', balance_type: 'debit',
    is_postable: true, is_system: false, is_active: false, cash_flow_section: 'none' },
  { id: 'acc-equip', code: '1600', name: 'Equipment', account_class: 1, account_type: 'asset', balance_type: 'debit',
    is_postable: true, is_system: true, is_active: true, cash_flow_section: 'investing' },
  { id: 'acc-dep', code: '6950', name: 'Depreciation', account_class: 6, account_type: 'expense', balance_type: 'debit',
    is_postable: true, is_system: true, is_active: true, cash_flow_section: 'operating' },
];

vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => state.rpc(fn, args),
    from: () => ({ select: () => ({ is: () => ({ order: () => Promise.resolve({ data: ACCOUNTS, error: null }) }) }) }),
  },
}));

const ASSET = {
  id: 'a-2', asset_number: 'FA-0002', name: 'Laptop', net_book_value: 2_937_500, in_service_date: '2026-10-01',
};
const OK = {
  ok: true, asset_id: 'a-2', journal_entry_id: 'je-1', entry_number: 'JE-20261125-0001',
  accumulated_depreciation: 62_500, net_book_value: 2_937_500, sale_price: 0, result: -2_937_500,
};

function renderDialog(onClose = vi.fn()): { onClose: ReturnType<typeof vi.fn> } {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <DisposeFixedAssetDialog open onClose={onClose} asset={ASSET} />
    </QueryClientProvider>,
  );
  return { onClose };
}

function disposeCalls(): unknown[][] {
  return state.rpc.mock.calls.filter(([fn]) => fn === 'dispose_fixed_asset_v1');
}

beforeEach(() => {
  state.rpc.mockReset();
  state.rpc.mockImplementation(() => Promise.resolve({ data: OK, error: null }));
});
afterEach(cleanup);

describe('DisposeFixedAssetDialog', () => {
  it('asks for price and account only for a sale, with treasury accounts only', async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'breakage' } });
    expect(screen.queryByTestId('fa-dispose-price')).not.toBeInTheDocument();
    expect(screen.queryByTestId('fa-dispose-account')).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'sale' } });
    expect(screen.getByTestId('fa-dispose-price')).toBeInTheDocument();
    const account = screen.getByTestId('fa-dispose-account');
    await waitFor(() => { expect(within(account).getByRole('option', { name: '1110 — Cash' })).toBeInTheDocument(); });
    // Inactif, investissement, charge : jamais proposés.
    expect(within(account).queryByRole('option', { name: /1120|1600|6950/ })).not.toBeInTheDocument();
  });

  it('shows an indicative loss from the current net book value', () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'sale' } });
    fireEvent.change(screen.getByTestId('fa-dispose-price'), { target: { value: '1000000' } });
    expect(screen.getByText('Loss (indicative)')).toBeInTheDocument();
    expect(screen.getByTestId('fa-dispose-result')).toHaveTextContent('1.937.500');
    fireEvent.change(screen.getByTestId('fa-dispose-price'), { target: { value: '3000000' } });
    expect(screen.getByText('Gain (indicative)')).toBeInTheDocument();
    expect(screen.getByTestId('fa-dispose-result')).toHaveTextContent('62.500');
  });

  it('sends NULL price and account outside a sale, then closes', async () => {
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'breakage' } });
    fireEvent.change(screen.getByTestId('fa-dispose-notes'), { target: { value: '  dropped  ' } });
    fireEvent.change(screen.getByTestId('fa-dispose-pin'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('fa-dispose-submit'));
    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    expect(disposeCalls()).toEqual([['dispose_fixed_asset_v1', {
      p_asset_id: 'a-2', p_disposal_date: todayIsoDate(), p_reason: 'breakage',
      p_sale_price: null, p_proceeds_account_id: null, p_notes: 'dropped', p_manager_pin: '123456',
    }]]);
  });

  it('sends price and receiving account for a sale', async () => {
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'sale' } });
    fireEvent.change(screen.getByTestId('fa-dispose-price'), { target: { value: '1500000' } });
    const account = screen.getByTestId('fa-dispose-account');
    await waitFor(() => { expect(within(account).getByRole('option', { name: '1110 — Cash' })).toBeInTheDocument(); });
    fireEvent.change(account, { target: { value: 'acc-cash' } });
    fireEvent.change(screen.getByTestId('fa-dispose-pin'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('fa-dispose-submit'));
    await waitFor(() => { expect(onClose).toHaveBeenCalled(); });
    expect(disposeCalls()[0]?.[1]).toMatchObject({
      p_reason: 'sale', p_sale_price: 1_500_000, p_proceeds_account_id: 'acc-cash', p_notes: null,
    });
  });

  it('refuses a sale without price before calling the server', () => {
    renderDialog();
    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'sale' } });
    fireEvent.change(screen.getByTestId('fa-dispose-pin'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('fa-dispose-submit'));
    expect(screen.getByTestId('fa-dispose-error')).toHaveTextContent('Enter a sale price above zero');
    expect(disposeCalls()).toHaveLength(0);
  });

  it('shows a wrong PIN returned by the server and clears the PIN only', async () => {
    state.rpc.mockImplementation(() => Promise.resolve({ data: { ok: false, error: 'invalid_pin' }, error: null }));
    const { onClose } = renderDialog();
    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'scrap' } });
    fireEvent.change(screen.getByTestId('fa-dispose-pin'), { target: { value: '999999' } });
    fireEvent.click(screen.getByTestId('fa-dispose-submit'));
    expect(await screen.findByTestId('fa-dispose-error')).toHaveTextContent('Wrong PIN. Try again.');
    expect(screen.getByTestId('fa-dispose-pin')).toHaveValue('');
    expect(screen.getByTestId('fa-dispose-reason')).toHaveValue('scrap');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('names a closed period refused by the server', async () => {
    state.rpc.mockImplementation(() => Promise.resolve({
      data: null, error: { message: 'period_locked: date 2026-10-31 falls in closed period' },
    }));
    renderDialog();
    fireEvent.change(screen.getByTestId('fa-dispose-reason'), { target: { value: 'scrap' } });
    fireEvent.change(screen.getByTestId('fa-dispose-pin'), { target: { value: '123456' } });
    fireEvent.click(screen.getByTestId('fa-dispose-submit'));
    expect(await screen.findByTestId('fa-dispose-error')).toHaveTextContent('period of this date is closed');
  });
});
