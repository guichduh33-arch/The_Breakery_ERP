// Décision 2026-11-21 : ACTIVER une promotion se confirme ; la désactiver
// reste direct. La liste montre valeur et fenêtre ; « Live now » suit les
// dates et ne dépend pas du filtre de table.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { emptyPromotionValues } from '@breakery/ui';
import type { PromotionListRow, PromotionsListFilters } from '../hooks/usePromotionsList.js';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  rows: [] as PromotionListRow[],
  calls: [] as (PromotionsListFilters | undefined)[],
}));
vi.mock('../hooks/usePromotionsList.js', () => ({
  usePromotionsList: (filters?: PromotionsListFilters) => {
    mocks.calls.push(filters);
    // Le filtre de table ne garde que les inactives : les compteurs ne doivent pas le suivre.
    const data = filters?.active === 'inactive' ? mocks.rows.filter((r) => !r.is_active) : mocks.rows;
    return { data, isLoading: false, error: null };
  },
}));
vi.mock('../hooks/useUpdatePromotion.js', () => ({
  useUpdatePromotion: () => ({ mutate: mocks.mutate, isPending: false, variables: undefined }),
}));
vi.mock('../components/PromotionFormModal.js', () => ({ PromotionFormModal: () => null }));
vi.mock('../components/PromotionDeleteConfirm.js', () => ({ PromotionDeleteConfirm: () => null }));
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (selector: (s: { hasPermission: (c: string) => boolean }) => unknown) => selector({ hasPermission: () => true }),
}));
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

import PromotionsPage from '@/pages/Promotions.js';

const row = (over: Partial<PromotionListRow>): PromotionListRow => ({
  ...emptyPromotionValues(), id: 'p', created_at: '2026-11-01T00:00:00Z', name: 'Promo', ...over,
});

beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.calls = [];
  mocks.rows = [
    row({ id: 'a', name: 'Happy Hour', type: 'percentage', discount_value: 15, is_active: false, end_at: '2099-12-31T14:00:00Z' }),
    row({ id: 'b', name: 'Morning BOGO', type: 'bogo', bogo_buy_quantity: 2, bogo_get_quantity: 1, is_active: true }),
    row({ id: 'c', name: 'Old Sale', type: 'fixed_amount', discount_value: 10_000, is_active: true, end_at: '2020-01-01T00:00:00Z' }),
  ];
});

describe('Promotions list', () => {
  it('confirms before activating, and activates only on confirm', () => {
    render(<PromotionsPage />);
    fireEvent.click(screen.getByLabelText('Toggle Happy Hour active'));
    expect(mocks.mutate).not.toHaveBeenCalled();
    const dialog = screen.getByTestId('promotion-activate-confirm');
    expect(within(dialog).getByText('Activate Happy Hour?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent(/Applies at the POS from now until 31 Dec 2099/);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Activate' }));
    expect(mocks.mutate).toHaveBeenCalledWith({ id: 'a', values: { is_active: true } }, expect.anything());
  });

  it('cancelling the confirmation changes nothing', () => {
    render(<PromotionsPage />);
    fireEvent.click(screen.getByLabelText('Toggle Happy Hour active'));
    fireEvent.click(within(screen.getByTestId('promotion-activate-confirm')).getByRole('button', { name: 'Cancel' }));
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('deactivates directly, without a confirmation', () => {
    render(<PromotionsPage />);
    fireEvent.click(screen.getByLabelText('Toggle Morning BOGO active'));
    expect(screen.queryByTestId('promotion-activate-confirm')).toBeNull();
    expect(mocks.mutate).toHaveBeenCalledWith({ id: 'b', values: { is_active: false } }, expect.anything());
  });

  it('shows value and window columns', () => {
    render(<PromotionsPage />);
    expect(screen.getByText('15%')).toBeInTheDocument();
    expect(screen.getByText('Buy 2 get 1')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getAllByText('Always').length).toBeGreaterThan(0);
  });

  it('counts live promotions on dates, independent of the table filter', () => {
    render(<PromotionsPage />);
    // Seule « Morning BOGO » est active ET dans sa fenêtre ; « Old Sale » a expiré.
    const tile = screen.getByText('Live now').closest('div')?.parentElement;
    expect(tile).toHaveTextContent('1');
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'inactive' } });
    expect(screen.getByText('Live now').closest('div')?.parentElement).toHaveTextContent('1');
    expect(mocks.calls).toContain(undefined);
  });

  it('offers threshold and bundle in the type filter', () => {
    render(<PromotionsPage />);
    const select = screen.getByLabelText('Type');
    expect(within(select).getByRole('option', { name: 'Spend threshold' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Bundle' })).toBeInTheDocument();
  });
});
