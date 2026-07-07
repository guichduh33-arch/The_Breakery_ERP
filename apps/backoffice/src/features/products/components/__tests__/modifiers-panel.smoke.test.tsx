import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import type { EditableModifierGroup } from '@breakery/domain';

const mutate = vi.fn();
const loadData: { current: EditableModifierGroup[] } = { current: [] };

vi.mock('@/features/products/hooks/useDeductibleIngredientProducts.js', () => ({
  useDeductibleIngredientProducts: () => ({ data: [], isLoading: false }),
}));
vi.mock('../../hooks/useProductModifiersAdmin.js', () => ({
  useProductModifiersAdmin: () => ({ data: loadData.current, isLoading: false }),
  productModifiersAdminKey: (id: string) => ['product-modifiers-admin', id],
}));
vi.mock('../../hooks/useUpsertProductModifiers.js', () => ({
  useUpsertProductModifiers: () => ({ mutate, isPending: false }),
}));

const hasPermMock = vi.fn();
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (c: string) => boolean }) => unknown) =>
    sel({ hasPermission: hasPermMock }),
}));

import { ModifiersPanel } from '../ModifiersPanel.js';

afterEach(cleanup);

describe('ModifiersPanel', () => {
  beforeEach(() => {
    mutate.mockReset();
    hasPermMock.mockReset();
    hasPermMock.mockReturnValue(true);
    loadData.current = [
      {
        group_name: 'Milk',
        group_type: 'single_select',
        group_required: true,
        group_sort_order: 0,
        options: [
          { option_label: 'Fresh', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
          { option_label: 'Oat', price_adjustment: 10000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [] },
        ],
      },
    ];
  });

  it('renders loaded groups', () => {
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    expect(screen.getByDisplayValue('Milk')).toBeInTheDocument();
  });

  it('adds a new variant type', () => {
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /add variant type/i }));
    // a second name input appears (blank)
    const nameInputs = screen.getAllByLabelText(/variant type name/i);
    expect(nameInputs.length).toBe(2);
  });

  it('saves the serialized draft via the upsert hook', async () => {
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const groups = mutate.mock.calls[0]![0] as EditableModifierGroup[];
    expect(groups[0]!.group_name).toBe('Milk');
  });

  it('hides Save without products.modifiers.update', () => {
    hasPermMock.mockReturnValue(false);
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    expect(screen.queryByRole('button', { name: /^save/i })).toBeNull();
  });

  it('blocks save and shows an error on a blank group name', () => {
    loadData.current = [
      {
        group_name: '',
        group_type: 'single_select',
        group_required: false,
        group_sort_order: 0,
        options: [{ option_label: 'X', price_adjustment: 0, is_default: false, option_sort_order: 0, ingredients_to_deduct: [] }],
      },
    ];
    render(<ModifiersPanel product={{ id: 'p1' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^save/i }));
    expect(mutate).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });
});
