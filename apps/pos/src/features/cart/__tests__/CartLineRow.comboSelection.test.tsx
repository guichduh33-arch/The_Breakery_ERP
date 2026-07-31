// apps/pos/src/features/cart/__tests__/CartLineRow.comboSelection.test.tsx
//
// Bug (2026-07-31) — the combo cart line rendered the DEFINITION'S DEFAULT
// options (`o.is_default`) instead of the line's actual selection
// (`item.combo_components`). A cashier picking anything non-default saw a cart
// that contradicted the recorded order. This suite pins the contract:
//   the cart shows what THIS line carries — chosen components + the modifier
//   answers given on them (ADR-017) — never the definition's defaults.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { CartItem } from '@breakery/domain';
import { CartLineRow } from '../CartLineRow';

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  Toaster: () => null,
}));

// Definition: two groups, each with a DEFAULT option that the cashier did NOT
// keep. If the display reads defaults, Espresso/Croissant leak through.
vi.mock('@/features/combos/hooks/useComboConfig', () => ({
  useComboConfig: () => ({
    data: {
      combo_product_id: 'combo-1',
      name: 'Breakfast Combo',
      base_price: 50000,
      groups: [
        {
          id: 'g-plate',
          name: 'plate',
          group_type: 'single',
          is_required: true,
          min_select: 1,
          max_select: 1,
          sort_order: 0,
          options: [
            { id: 'o-croissant', component_product_id: 'p-croissant', label: 'Croissant', surcharge: 0, is_default: true, sort_order: 0 },
            { id: 'o-painchoc', component_product_id: 'p-painchoc', label: 'Pain au chocolat', surcharge: 3000, is_default: false, sort_order: 1 },
          ],
        },
        {
          id: 'g-drink',
          name: 'drink',
          group_type: 'single',
          is_required: true,
          min_select: 1,
          max_select: 1,
          sort_order: 1,
          options: [
            { id: 'o-espresso', component_product_id: 'p-espresso', label: 'Espresso', surcharge: 0, is_default: true, sort_order: 0 },
            { id: 'o-capuccino', component_product_id: 'p-capuccino', label: 'Capuccino', surcharge: 5000, is_default: false, sort_order: 1 },
          ],
        },
      ],
    },
  }),
}));

function makeComboItem(): CartItem {
  return {
    id: 'l-combo',
    product_id: 'combo-1',
    name: 'Breakfast Combo',
    unit_price: 68000,
    quantity: 1,
    product_type: 'combo',
    // The chosen options as the line carries them (labels for the kitchen).
    modifiers: [
      { group_name: 'plate', option_label: 'Pain au chocolat', price_adjustment: 3000 },
      { group_name: 'drink', option_label: 'Capuccino', price_adjustment: 5000 },
    ],
    // The REAL selection — non-default on both groups, with ADR-017 answers.
    combo_components: [
      { product_id: 'p-painchoc', quantity: 1 },
      {
        product_id: 'p-capuccino',
        quantity: 1,
        modifiers: [
          { group_name: 'Temperature', option_label: 'ICED', price_adjustment: 0 },
          { group_name: 'Milk', option_label: 'Oat', price_adjustment: 10000 },
        ],
      },
    ],
  };
}

describe('CartLineRow — a combo line shows its OWN selection, not the defaults', () => {
  it('renders the chosen components', () => {
    render(
      <CartLineRow item={makeComboItem()} locked={false} onChangeQty={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText(/Pain au chocolat/)).toBeInTheDocument();
    expect(screen.getByText(/Capuccino/)).toBeInTheDocument();
  });

  it('never renders the definition defaults the cashier did not keep', () => {
    render(
      <CartLineRow item={makeComboItem()} locked={false} onChangeQty={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.queryByText(/Espresso/)).toBeNull();
    expect(screen.queryByText(/Croissant/)).toBeNull();
  });

  it('shows the modifier answers given on a component (ADR-017)', () => {
    render(
      <CartLineRow item={makeComboItem()} locked={false} onChangeQty={vi.fn()} onRemove={vi.fn()} />,
    );
    expect(screen.getByText(/ICED/)).toBeInTheDocument();
    expect(screen.getByText(/Oat/)).toBeInTheDocument();
  });

  it('keeps rendering nothing below the combo when the line has no composition (legacy line)', () => {
    const item = makeComboItem();
    delete item.combo_components;
    item.modifiers = [];
    render(
      <CartLineRow item={item} locked={false} onChangeQty={vi.fn()} onRemove={vi.fn()} />,
    );
    // No composition on the line → no component sub-list, defaults must NOT
    // be invented from the definition.
    expect(screen.queryByText(/Espresso/)).toBeNull();
    expect(screen.queryByText(/Croissant/)).toBeNull();
  });
});
