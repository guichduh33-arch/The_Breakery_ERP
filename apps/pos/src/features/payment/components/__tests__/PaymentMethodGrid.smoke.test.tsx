import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaymentMethodGrid } from '../PaymentMethodGrid';

describe('PaymentMethodGrid', () => {
  it('renders all 6 method tiles with their testids', () => {
    render(<PaymentMethodGrid selectedMethod={null} onSelect={vi.fn()} />);
    for (const value of ['cash', 'card', 'qris', 'edc', 'transfer', 'store_credit']) {
      expect(screen.getByTestId(`pay-method-${value}`)).toBeInTheDocument();
    }
  });

  it('calls onSelect with the tapped method', () => {
    const onSelect = vi.fn();
    render(<PaymentMethodGrid selectedMethod={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByTestId('pay-method-qris'));
    expect(onSelect).toHaveBeenCalledWith('qris');
  });
});
