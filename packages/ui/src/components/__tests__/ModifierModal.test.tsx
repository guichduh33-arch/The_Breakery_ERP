import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ModifierGroup, SelectedModifiers } from '@breakery/domain';
import { ModifierModal } from '../ModifierModal.js';

const product = { id: 'p1', name: 'Americano', retail_price: 35000 };

const groups: ModifierGroup[] = [
  {
    group_name: 'Temperature',
    group_sort_order: 1,
    group_required: true,
    group_type: 'single_select',
    options: [
      { option_label: 'Hot', option_icon: '☕', option_sort_order: 1, price_adjustment: 0, is_default: true },
      { option_label: 'Ice', option_icon: '🧊', option_sort_order: 2, price_adjustment: 0, is_default: false },
    ],
  },
  {
    group_name: 'Milk',
    group_sort_order: 2,
    group_required: false,
    group_type: 'single_select',
    options: [
      { option_label: 'Whole milk', option_sort_order: 1, price_adjustment: 0, is_default: true },
      { option_label: 'Oat milk', option_sort_order: 2, price_adjustment: 5000, is_default: false },
    ],
  },
];

describe('ModifierModal', () => {
  it('renders product name and all groups when open', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.getByText('Americano')).toBeInTheDocument();
    expect(screen.getByText('Temperature')).toBeInTheDocument();
    expect(screen.getByText('Milk')).toBeInTheDocument();
    // Session 14 redesign : required indicator = red asterisk (no "Required" badge).
    expect(screen.getAllByLabelText('required').length).toBeGreaterThan(0);
  });

  it('renders nothing when closed', () => {
    render(
      <ModifierModal
        open={false}
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    expect(screen.queryByText('Americano')).not.toBeInTheDocument();
  });

  it('selects the default option in each group at open and shows base total', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const hotBtn = screen.getByRole('button', { name: /Hot/ });
    expect(hotBtn).toHaveAttribute('aria-pressed', 'true');
    // Total = 35000 (no oat selected, both defaults are 0 adj). Appears twice :
    // once in the Total row, once in the gold CTA button.
    expect(screen.getAllByText(/Rp\s*35[.,]000/).length).toBeGreaterThan(0);
  });

  it('updates total when an option with price adjustment is selected', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Oat milk/ }));
    // 35000 + 5000 = 40000. Total appears in the row + CTA button.
    expect(screen.getAllByText(/Rp\s*40[.,]000/).length).toBeGreaterThan(0);
  });

  it('replaces selection in single_select group (radio behavior)', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const hotBtn = screen.getByRole('button', { name: /Hot/ });
    const iceBtn = screen.getByRole('button', { name: /Ice/ });
    expect(hotBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(iceBtn);
    expect(iceBtn).toHaveAttribute('aria-pressed', 'true');
    expect(hotBtn).toHaveAttribute('aria-pressed', 'false');
  });

  it('disables Add to cart when a required group has no selection', () => {
    const noDefaultRequired: ModifierGroup[] = [
      {
        ...groups[0]!,
        options: groups[0]!.options.map((o) => ({ ...o, is_default: false })),
      },
    ];
    render(
      <ModifierModal
        open
        product={product}
        groups={noDefaultRequired}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const addBtn = screen.getByRole('button', { name: /Add to cart/i });
    expect(addBtn).toBeDisabled();
  });

  it('calls onConfirm with selected options when valid', () => {
    const onConfirm = vi.fn();
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Oat milk/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]?.[0] as SelectedModifiers;
    expect(arg).toEqual(
      expect.arrayContaining([
        { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
        { group_name: 'Milk', option_label: 'Oat milk', price_adjustment: 5000 },
      ]),
    );
  });

  it('calls onClose when the X close icon is pressed', () => {
    const onClose = vi.fn();
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={onClose}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('toggles off optional group selection when re-tapped', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Whole milk is default (optional group)
    const whole = screen.getByRole('button', { name: /Whole milk/ });
    expect(whole).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(whole);
    expect(whole).toHaveAttribute('aria-pressed', 'false');
  });

  it('does not toggle off required group when re-tapped', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={groups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const hot = screen.getByRole('button', { name: /Hot/ });
    expect(hot).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(hot);
    // Still pressed because Temperature is required
    expect(hot).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows a danger-coloured required asterisk when a required group has no selection', () => {
    const noDefaultRequired: ModifierGroup[] = [
      {
        ...groups[0]!,
        options: groups[0]!.options.map((o) => ({ ...o, is_default: false })),
      },
    ];
    render(
      <ModifierModal
        open
        product={product}
        groups={noDefaultRequired}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Session 14 redesign : the "Required" badge is replaced by a red asterisk
    // next to the group label ; the error variant gets the full danger color.
    const asterisk = screen.getByLabelText('required');
    expect(asterisk.className).toMatch(/text-danger/);
  });
});

// ---------------------------------------------------------------------------
// multi_select extension — session 6
// ---------------------------------------------------------------------------

const multiGroups: ModifierGroup[] = [
  {
    group_name: 'Toppings',
    group_sort_order: 1,
    group_required: true,
    group_type: 'multi_select',
    options: [
      { option_label: 'Extra cheese', option_sort_order: 1, price_adjustment: 5000, is_default: false },
      { option_label: 'Bacon', option_sort_order: 2, price_adjustment: 8000, is_default: false },
      { option_label: 'Mushroom', option_sort_order: 3, price_adjustment: 3000, is_default: false },
    ],
  },
  {
    group_name: 'Temperature',
    group_sort_order: 2,
    group_required: true,
    group_type: 'single_select',
    options: [
      { option_label: 'Hot', option_icon: '☕', option_sort_order: 1, price_adjustment: 0, is_default: true },
      { option_label: 'Ice', option_icon: '🧊', option_sort_order: 2, price_adjustment: 0, is_default: false },
    ],
  },
];

describe('ModifierModal — multi_select', () => {
  it('tap on multi_select option selects it', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    const cheeseBtn = screen.getByRole('button', { name: /Extra cheese/i });
    expect(cheeseBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(cheeseBtn);
    expect(cheeseBtn).toHaveAttribute('aria-pressed', 'true');
  });

  it('tap selected multi_select option deselects it (when not last required)', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Select two options first
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bacon/i }));
    // Deselect cheese (still has Bacon selected)
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    expect(screen.getByRole('button', { name: /Extra cheese/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Bacon/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('multi_select allows multiple options selected simultaneously', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bacon/i }));
    expect(screen.getByRole('button', { name: /Extra cheese/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Bacon/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Mushroom/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('live total sums all selected multi_select adjustments', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Select cheese (5000) + bacon (8000) — base 35000 + 13000 = 48000.
    // Total appears in the Total row + CTA button → use getAllByText.
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bacon/i }));
    expect(screen.getAllByText(/Rp\s*48[.,]000/).length).toBeGreaterThan(0);
  });

  it('multi_select group_required + 0 selected → Add to cart disabled', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    // Toppings required, nothing selected
    const addBtn = screen.getByRole('button', { name: /Add to cart/i });
    expect(addBtn).toBeDisabled();
  });

  it('multi_select group_required + 1+ selected → Add to cart enabled', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    const addBtn = screen.getByRole('button', { name: /Add to cart/i });
    expect(addBtn).not.toBeDisabled();
  });

  it('multi_select required prevents deselecting the last option', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    // Try to deselect the only selected option
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    // Should still be selected (can't deselect last in required group)
    expect(screen.getByRole('button', { name: /Extra cheese/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('onConfirm receives all selected multi_select options', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i }));
    fireEvent.click(screen.getByRole('button', { name: /Bacon/i }));
    fireEvent.click(screen.getByRole('button', { name: /Add to cart/i }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]?.[0] as SelectedModifiers;
    expect(arg).toEqual(
      expect.arrayContaining([
        { group_name: 'Toppings', option_label: 'Extra cheese', price_adjustment: 5000 },
        { group_name: 'Toppings', option_label: 'Bacon', price_adjustment: 8000 },
        { group_name: 'Temperature', option_label: 'Hot', price_adjustment: 0 },
      ]),
    );
  });

  // --- regression: single_select groups still work as before ---
  it('single_select group still replaces prior selection (regression)', () => {
    render(
      <ModifierModal
        open
        product={product}
        groups={multiGroups}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Extra cheese/i })); // satisfy required Toppings
    const hotBtn = screen.getByRole('button', { name: /Hot/ });
    const iceBtn = screen.getByRole('button', { name: /Ice/ });
    expect(hotBtn).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(iceBtn);
    expect(iceBtn).toHaveAttribute('aria-pressed', 'true');
    expect(hotBtn).toHaveAttribute('aria-pressed', 'false');
  });
});
