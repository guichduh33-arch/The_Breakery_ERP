import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import type { ModifierIngredient } from '@breakery/domain';

vi.mock('@/features/purchasing/hooks/useAllProductsForPO.js', () => ({
  useAllProductsForPO: () => ({
    data: [
      { id: 'oat', name: 'Oat Milk', unit: 'ml', unitOptions: [{ code: 'ml', factor: 1 }, { code: 'L', factor: 1000 }] },
      { id: 'sugar', name: 'Sugar', unit: 'g', unitOptions: [{ code: 'g', factor: 1 }] },
    ],
    isLoading: false,
  }),
}));

import { OptionIngredientPicker } from '../OptionIngredientPicker.js';

afterEach(cleanup);

describe('OptionIngredientPicker', () => {
  it('renders existing ingredient rows', () => {
    const value: ModifierIngredient[] = [{ product_id: 'oat', qty: 30, unit: 'ml' }];
    render(<OptionIngredientPicker value={value} onChange={() => {}} />);
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
});
