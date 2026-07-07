// apps/pos/src/features/shift/components/__tests__/DenominationGrid.smoke.test.tsx
// S67 (12 D2.3) — smoke test for the IDR denomination counting grid.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DenominationGrid } from '../DenominationGrid';

describe('DenominationGrid', () => {
  it('renders one row per IDR denomination with the running total', () => {
    render(<DenominationGrid value={{ '100000': 2, '500': 3 }} onChange={vi.fn()} />);
    expect(screen.getAllByTestId(/denom-row-/)).toHaveLength(10);
    expect(screen.getByTestId('denom-total')).toHaveTextContent('201.500');
  });
  it('increments a quantity via the + button', () => {
    const onChange = vi.fn();
    render(<DenominationGrid value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('denom-inc-50000'));
    expect(onChange).toHaveBeenCalledWith({ '50000': 1 });
  });
  it('never goes below zero via the - button', () => {
    const onChange = vi.fn();
    render(<DenominationGrid value={{ '1000': 0 }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('denom-dec-1000'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
