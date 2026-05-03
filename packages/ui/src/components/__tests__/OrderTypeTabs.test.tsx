import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderTypeTabs } from '../OrderTypeTabs.js';

describe('OrderTypeTabs', () => {
  it('renders all order type tabs', () => {
    render(<OrderTypeTabs value="dine_in" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Dine In' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Take-Out' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Delivery' })).toBeInTheDocument();
  });

  it('marks selected tab as aria-selected', () => {
    render(<OrderTypeTabs value="take_out" onChange={vi.fn()} />);
    expect(screen.getByRole('tab', { name: 'Take-Out' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Dine In' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange when tab clicked', () => {
    const onChange = vi.fn();
    render(<OrderTypeTabs value="dine_in" onChange={onChange} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Delivery' }));
    expect(onChange).toHaveBeenCalledWith('delivery');
  });
});
