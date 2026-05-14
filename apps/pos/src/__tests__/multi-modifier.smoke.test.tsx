// apps/pos/src/__tests__/multi-modifier.smoke.test.tsx
/// <reference types="@testing-library/jest-dom" />
//
// Smoke tests for multi_select modifier groups.
// Spec §5 (session 6): product with multi_select group → ModifierModal → select
// multiple options → confirm → cart line shows both modifiers + summed
// price_adjustment.
//
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ModifierGroup, SelectedModifiers } from '@breakery/domain';
import { ModifierModal } from '@breakery/ui';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const product = { id: 'p-burger', name: 'Burger', retail_price: 60000 };

/** A multi_select toppings group with extra cheese (5000) + bacon (8000). */
const multiGroups: ModifierGroup[] = [
  {
    group_name: 'Extras',
    group_sort_order: 1,
    group_required: true,
    group_type: 'multi_select',
    options: [
      { option_label: 'Extra cheese', option_sort_order: 1, price_adjustment: 5000, is_default: false },
      { option_label: 'Bacon', option_sort_order: 2, price_adjustment: 8000, is_default: false },
      { option_label: 'Jalapeño', option_sort_order: 3, price_adjustment: 2000, is_default: false },
    ],
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Multi-modifier smoke — multi_select group behaviour', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('selects 2 options (extra cheese 5000 + bacon 8000), onConfirm receives both with summed price_adjustment 13000', () => {
    const onConfirm = vi.fn();

    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );

    // Both start unselected (required group, no defaults)
    expect(screen.getByRole('button', { name: /Extra cheese/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Bacon/i })).toHaveAttribute('aria-pressed', 'false');

    // Select extra cheese and bacon
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bacon/i }));

    // Both now selected
    expect(screen.getByRole('button', { name: /Extra cheese/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Bacon/i })).toHaveAttribute('aria-pressed', 'true');

    // Live total: 60000 + 5000 + 8000 = 73000.
    // Use getAllByText: ModifierModal redesign (Phase 2.C, 3599d8f) added a
    // Radix sr-only DialogDescription that mirrors the visible price.
    expect(screen.getAllByText(/Rp\s*73[.,]000/).length).toBeGreaterThan(0);

    // Confirm
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const selections = onConfirm.mock.calls[0]![0] as SelectedModifiers;

    // Both modifiers present in result
    expect(selections).toEqual(
      expect.arrayContaining([
        { group_name: 'Extras', option_label: 'Extra cheese', price_adjustment: 5000 },
        { group_name: 'Extras', option_label: 'Bacon', price_adjustment: 8000 },
      ]),
    );

    // Summed price_adjustment = 13000
    const totalAdj = selections.reduce((s, m) => s + m.price_adjustment, 0);
    expect(totalAdj).toBe(13000);
  });

  it('multi_select required group with 0 selected → Add to cart disabled', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    // Nothing selected in the required group — "Add to cart" must be disabled
    const addBtn = screen.getByRole('button', { name: /Add to cart/i });
    expect(addBtn).toBeDisabled();
    // aria-disabled also set
    expect(addBtn).toHaveAttribute('aria-disabled', 'true');
  });
});
