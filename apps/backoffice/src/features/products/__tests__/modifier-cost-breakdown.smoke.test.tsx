// apps/backoffice/src/features/products/__tests__/modifier-cost-breakdown.smoke.test.tsx
//
// Asserts the Costing-tab "Cost with modifiers" block:
//   T1: total cost per option = base cost + option material cost.
//   T2: price-only groups (no ingredients_to_deduct) are filtered out.
//   T3: renders nothing when no group has cost-bearing ingredients.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { EditableModifierGroup } from '@breakery/domain';
import { ModifierCostBreakdown } from '../components/ModifierCostBreakdown.js';

const { mockState } = vi.hoisted(() => ({
  mockState: {
    groups: [] as EditableModifierGroup[],
  },
}));

vi.mock('@/features/products/hooks/useProductModifiersAdmin.js', () => ({
  useProductModifiersAdmin: (_productId: string) => ({
    data: mockState.groups,
    isLoading: false,
  }),
}));

vi.mock('@/features/products/hooks/useDeductibleIngredientProducts.js', () => ({
  useDeductibleIngredientProducts: () => ({
    data: [
      { id: 'milk-fresh', name: 'Fresh Milk', unit: 'ml', cost_price: 20, unitOptions: [{ code: 'ml', factor: 1 }], is_semi_finished: false },
      { id: 'milk-oat', name: 'Oat Milk', unit: 'ml', cost_price: 50, unitOptions: [{ code: 'ml', factor: 1 }], is_semi_finished: false },
    ],
    isLoading: false,
  }),
}));

const MILK_GROUP: EditableModifierGroup = {
  group_name: 'Milk',
  group_type: 'single_select',
  group_required: true,
  group_sort_order: 0,
  options: [
    {
      option_label: 'Fresh',
      price_adjustment: 0,
      is_default: true,
      option_sort_order: 0,
      ingredients_to_deduct: [{ product_id: 'milk-fresh', qty: 100, unit: 'ml' }],
    },
    {
      option_label: 'Oat',
      price_adjustment: 10_000,
      is_default: false,
      option_sort_order: 1,
      ingredients_to_deduct: [{ product_id: 'milk-oat', qty: 100, unit: 'ml' }],
    },
  ],
};

const SIZE_GROUP_PRICE_ONLY: EditableModifierGroup = {
  group_name: 'Size',
  group_type: 'single_select',
  group_required: false,
  group_sort_order: 1,
  options: [
    { option_label: 'Regular', price_adjustment: 0, is_default: true, option_sort_order: 0, ingredients_to_deduct: [] },
    { option_label: 'Large', price_adjustment: 5_000, is_default: false, option_sort_order: 1, ingredients_to_deduct: [] },
  ],
};

describe('ModifierCostBreakdown', () => {
  it('T1: shows total cost = base + option material cost', () => {
    mockState.groups = [MILK_GROUP];
    render(<ModifierCostBreakdown productId="prod-1" baseCost={10_000} />);

    // Fresh: 10000 + 100×20 = 12000
    const fresh = screen.getByTestId('modifier-cost-row-Milk-Fresh');
    expect(fresh).toHaveTextContent('12.000');
    expect(fresh).toHaveTextContent('default');

    // Oat: 10000 + 100×50 = 15000
    const oat = screen.getByTestId('modifier-cost-row-Milk-Oat');
    expect(oat).toHaveTextContent('15.000');
  });

  it('T2: price-only groups are filtered out', () => {
    mockState.groups = [MILK_GROUP, SIZE_GROUP_PRICE_ONLY];
    render(<ModifierCostBreakdown productId="prod-1" baseCost={10_000} />);

    expect(screen.getByTestId('modifier-cost-group-Milk')).toBeInTheDocument();
    expect(screen.queryByTestId('modifier-cost-group-Size')).not.toBeInTheDocument();
  });

  it('T3: renders nothing when no group has cost-bearing ingredients', () => {
    mockState.groups = [SIZE_GROUP_PRICE_ONLY];
    const { container } = render(
      <ModifierCostBreakdown productId="prod-1" baseCost={10_000} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
