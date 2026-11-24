// apps/backoffice/src/features/expenses/__tests__/expense-equipment-panel.test.tsx
//
// ADR-047 — panneau « Equipment » de la fiche dépense. Le seuil se juge PAR
// ARTICLE (2 000 000 IDR TTC × quantité) avant l'envoi ; la marque part vers
// set_expense_equipment_v1 ; hors brouillon, la marque se lit seulement.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ExpenseEquipmentPanel } from '@/features/expenses/components/ExpenseEquipmentPanel.js';

interface RpcResult { data: unknown; error: { message: string } | null }
const state = vi.hoisted(() => {
  const who: { perms: Set<string>; userId: string | null } = { perms: new Set(['expenses.create']), userId: 'profile-me' };
  return Object.assign(who, {
    rpc: vi.fn((_fn: string, args?: unknown): Promise<RpcResult> =>
      Promise.resolve({ data: { expense_id: (args as { p_expense_id: string }).p_expense_id }, error: null })),
  });
});

vi.mock('@/lib/supabase.js', () => ({ supabase: { rpc: (fn: string, args?: unknown) => state.rpc(fn, args) } }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean; user: { id: string } | null }) => unknown) =>
    sel({ hasPermission: (p: string) => state.perms.has(p), user: state.userId === null ? null : { id: state.userId } }),
}));

type PanelExpense = Parameters<typeof ExpenseEquipmentPanel>[0]['expense'];
const DRAFT: PanelExpense = {
  id: 'e-1', status: 'draft', amount: 5_000_000, created_by: 'profile-me',
  asset_type: null, asset_tax_group: null, asset_name: null, asset_quantity: null,
};
const MARKED = {
  asset_type: 'production_machine', asset_tax_group: 'group_2', asset_name: 'Deck oven', asset_quantity: 1,
} as const;

function renderPanel(expense: PanelExpense): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><ExpenseEquipmentPanel expense={expense} /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  state.perms = new Set(['expenses.create']);
  state.userId = 'profile-me';
  state.rpc.mockClear();
});
afterEach(cleanup);

describe('ExpenseEquipmentPanel', () => {
  it('judges the threshold per item and blocks a lot below it', () => {
    renderPanel(DRAFT);
    fireEvent.click(screen.getByTestId('expense-equipment-edit'));
    fireEvent.change(screen.getByTestId('expense-equipment-name'), { target: { value: 'Tablet' } });
    fireEvent.change(screen.getByTestId('expense-equipment-type'), { target: { value: 'equipment' } });
    fireEvent.change(screen.getByTestId('expense-equipment-group'), { target: { value: 'group_1' } });
    // 5 000 000 pour 3 articles = 1 666 666,67 par article : sous le seuil.
    fireEvent.change(screen.getByTestId('expense-equipment-quantity'), { target: { value: '3' } });
    expect(screen.getByTestId('expense-equipment-threshold')).toHaveTextContent('2,000,000 IDR per item, incl. VAT.');
    expect(screen.getByTestId('expense-equipment-threshold')).toHaveTextContent('Below the threshold');
    expect(screen.getByTestId('expense-equipment-save')).toBeDisabled();
    // 2 articles à 2 500 000 : au-dessus.
    fireEvent.change(screen.getByTestId('expense-equipment-quantity'), { target: { value: '2' } });
    expect(screen.getByTestId('expense-equipment-threshold')).not.toHaveTextContent('Below the threshold');
    expect(screen.getByTestId('expense-equipment-save')).toBeEnabled();
  });

  it('sends the mark to set_expense_equipment_v1', async () => {
    renderPanel(DRAFT);
    fireEvent.click(screen.getByTestId('expense-equipment-edit'));
    fireEvent.change(screen.getByTestId('expense-equipment-name'), { target: { value: '  Deck oven ' } });
    fireEvent.change(screen.getByTestId('expense-equipment-type'), { target: { value: 'production_machine' } });
    fireEvent.change(screen.getByTestId('expense-equipment-group'), { target: { value: 'group_2' } });
    fireEvent.change(screen.getByTestId('expense-equipment-quantity'), { target: { value: '2' } });
    fireEvent.click(screen.getByTestId('expense-equipment-save'));
    await waitFor(() => { expect(state.rpc).toHaveBeenCalledTimes(1); });
    expect(state.rpc).toHaveBeenCalledWith('set_expense_equipment_v1', {
      p_expense_id: 'e-1', p_asset_type: 'production_machine', p_tax_group: 'group_2',
      p_asset_name: 'Deck oven', p_quantity: 2,
    });
  });

  it('removes the mark with a NULL type', async () => {
    renderPanel({ ...DRAFT, ...MARKED });
    fireEvent.click(screen.getByTestId('expense-equipment-unmark'));
    await waitFor(() => { expect(state.rpc).toHaveBeenCalledTimes(1); });
    expect(state.rpc.mock.calls[0]?.[1]).toMatchObject({ p_expense_id: 'e-1', p_asset_type: null });
  });

  it('shows the server refusal in English', async () => {
    state.rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: 'expense_not_draft' } }));
    renderPanel({ ...DRAFT, ...MARKED });
    fireEvent.click(screen.getByTestId('expense-equipment-unmark'));
    expect(await screen.findByTestId('expense-equipment-error'))
      .toHaveTextContent('Only a draft expense can be marked as equipment.');
  });

  it('is read-only outside a draft, and says where the debit goes', () => {
    state.perms = new Set(['expenses.manage']);
    renderPanel({ ...DRAFT, ...MARKED, status: 'submitted' });
    expect(screen.getByTestId('expense-equipment-summary')).toHaveTextContent('Deck oven');
    expect(screen.getByTestId('expense-equipment-summary')).toHaveTextContent('Group 2 — 8 years');
    expect(screen.getByTestId('expense-equipment-consequence')).toHaveTextContent('On approval, the debit goes to the equipment account');
    expect(screen.queryByTestId('expense-equipment-edit')).not.toBeInTheDocument();
    expect(screen.queryByTestId('expense-equipment-unmark')).not.toBeInTheDocument();
  });

  it('states the equipment debit once approved', () => {
    renderPanel({ ...DRAFT, ...MARKED, status: 'approved' });
    expect(screen.getByTestId('expense-equipment-consequence')).toHaveTextContent('Approved: the debit went to the equipment account');
  });

  it('lets neither a non-creator without expenses.manage edit nor shows an unmarked panel', () => {
    renderPanel({ ...DRAFT, created_by: 'profile-other' });
    expect(screen.queryByTestId('expense-equipment-panel')).not.toBeInTheDocument();
    cleanup();
    renderPanel({ ...DRAFT, ...MARKED, created_by: 'profile-other' });
    expect(screen.getByTestId('expense-equipment-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('expense-equipment-edit')).not.toBeInTheDocument();
  });
});
