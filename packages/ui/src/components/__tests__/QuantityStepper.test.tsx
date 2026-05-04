import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QuantityStepper } from '../QuantityStepper.js';

describe('QuantityStepper', () => {
  it('renders current value and controls', () => {
    render(<QuantityStepper value={3} onChange={vi.fn()} />);
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Increase' })).toBeInTheDocument();
  });

  it('calls onChange with incremented value', () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Increase' }));
    expect(onChange).toHaveBeenCalledWith(4);
  });

  it('calls onChange with decremented value', () => {
    const onChange = vi.fn();
    render(<QuantityStepper value={3} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Decrease' }));
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('disables decrease at min', () => {
    render(<QuantityStepper value={0} onChange={vi.fn()} min={0} />);
    expect(screen.getByRole('button', { name: 'Decrease' })).toBeDisabled();
  });
});
