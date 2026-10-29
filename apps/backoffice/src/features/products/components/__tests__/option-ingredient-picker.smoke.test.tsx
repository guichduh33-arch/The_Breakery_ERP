import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { ModifierIngredient } from '@breakery/domain';

vi.mock('../../hooks/useDeductibleIngredientProducts.js', () => ({
  useDeductibleIngredientProducts: () => ({
    data: [
      { id: 'oat', name: 'Oat Milk', unit: 'ml', cost_price: 50, unitOptions: [{ code: 'ml', factor: 1 }, { code: 'L', factor: 1000 }], is_semi_finished: false },
      { id: 'sugar', name: 'Sugar', unit: 'g', cost_price: 10, unitOptions: [{ code: 'g', factor: 1 }], is_semi_finished: false },
      { id: 'mozza', name: 'Mozzarella Prep', unit: 'g', cost_price: 120, unitOptions: [{ code: 'g', factor: 1 }], is_semi_finished: true },
      { id: 'mayo', name: 'Mayonnaise', unit: 'kg', cost_price: 100000, unitOptions: [{ code: 'kg', factor: 1 }, { code: 'gr', factor: 0.001 }], is_semi_finished: true },
      { id: 'bread', name: 'Bread', unit: 'pcs', cost_price: 5000, unitOptions: [{ code: 'pcs', factor: 1 }], is_semi_finished: false, is_finished: true },
    ],
    isLoading: false,
  }),
}));

import { OptionIngredientPicker } from '../OptionIngredientPicker.js';

afterEach(cleanup);

describe('OptionIngredientPicker', () => {
  it('renders existing ingredient rows', () => {
    const value: ModifierIngredient[] = [{ product_id: 'oat', qty: 30, unit: 'ml' }];
    render(<OptionIngredientPicker value={value} onChange={vi.fn()} />);
    expect(screen.getByDisplayValue('30')).toBeInTheDocument();
  });

  it('adds a blank ingredient row on Add', () => {
    const onChange = vi.fn();
    render(<OptionIngredientPicker value={[]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /add ingredient/i }));
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0]![0] as ModifierIngredient[];
    expect(next).toHaveLength(1);
  });

  it('removes an ingredient row', () => {
    const onChange = vi.fn();
    const value: ModifierIngredient[] = [{ product_id: 'oat', qty: 30, unit: 'ml' }];
    render(<OptionIngredientPicker value={value} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /remove ingredient/i }));
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('shows the per-option material cost (Σ qty × factor × cost_price)', () => {
    // 30 ml oat × 50 + 4 g sugar × 10 = 1500 + 40 = 1540 → "Rp 1.540" (id-ID)
    const value: ModifierIngredient[] = [
      { product_id: 'oat', qty: 30, unit: 'ml' },
      { product_id: 'sugar', qty: 4, unit: 'g' },
    ];
    render(<OptionIngredientPicker value={value} onChange={vi.fn()} />);
    expect(screen.getByTestId('option-material-cost').textContent).toContain('1.540');
  });

  it('groups the select into Raw materials / Semi-finished and offers SFG products', () => {
    const value: ModifierIngredient[] = [{ product_id: 'oat', qty: 30, unit: 'ml' }];
    render(<OptionIngredientPicker value={value} onChange={vi.fn()} />);
    const select = screen.getByRole('combobox', { name: 'Ingredient' });
    const groups = select.querySelectorAll('optgroup');
    expect([...groups].map((g) => g.label)).toEqual(['Raw materials', 'Semi-finished', 'Finished products (stock tracked)']);
    expect(screen.getByRole('option', { name: 'Mozzarella Prep' })).toBeInTheDocument();
  });

  it('loads existing SFG mayonnaise with its unit and cost without changing the draft', () => {
    const onChange = vi.fn();
    render(<OptionIngredientPicker value={[{ product_id: 'mayo', qty: 0.035, unit: 'kg' }]} onChange={onChange} />);
    expect(screen.getByRole('combobox', { name: 'Ingredient' })).toHaveValue('mayo');
    expect(screen.getByRole('combobox', { name: 'Unit' })).toHaveValue('kg');
    expect(screen.getByTestId('option-material-cost')).toHaveTextContent('3.500');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('shows a stocked finished product separately from semi-finished ingredients', () => {
    render(<OptionIngredientPicker value={[{ product_id: 'bread', qty: 1, unit: 'pcs' }]} onChange={vi.fn()} />);
    const option = screen.getByRole('option', { name: 'Bread' });
    expect(option.parentElement).toHaveAttribute('label', 'Finished products (stock tracked)');
    expect(screen.getByRole('option', { name: 'Mayonnaise' }).parentElement).toHaveAttribute('label', 'Semi-finished');
    expect(screen.getByRole('combobox', { name: 'Ingredient' })).toHaveValue('bread');
  });

  it('selecting a semi-finished product updates the row and its material cost (WAC)', () => {
    const onChange = vi.fn();
    const value: ModifierIngredient[] = [{ product_id: 'oat', qty: 30, unit: 'ml' }];
    render(<OptionIngredientPicker value={value} onChange={onChange} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Ingredient' }), {
      target: { value: 'mozza' },
    });
    expect(onChange).toHaveBeenCalledWith([{ product_id: 'mozza', qty: 30, unit: 'g' }]);
  });
});
