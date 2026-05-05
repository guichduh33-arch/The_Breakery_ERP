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
    // Required badge present on Temperature
    expect(screen.getAllByText('Required').length).toBeGreaterThan(0);
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
    // Total = 35000 (no oat selected, both defaults are 0 adj)
    expect(screen.getByText(/Rp\s*35[.,]000/)).toBeInTheDocument();
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
    // 35000 + 5000 = 40000
    expect(screen.getByText(/Rp\s*40[.,]000/)).toBeInTheDocument();
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

  it('calls onClose when Cancel pressed', () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Cancel/i }));
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

  it('shows destructive Required badge when required group is missing', () => {
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
    // Find the required badge — Radix Dialog renders to a portal so the badge
    // lives in document.body, not in the test container.
    const badge = screen.getByText('Required');
    expect(badge.className).toMatch(/bg-red/);
  });
});
