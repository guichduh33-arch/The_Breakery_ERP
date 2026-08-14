import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OrderTypeTabs } from '../OrderTypeTabs.js';

describe('OrderTypeTabs', () => {
  it('renders all order type tabs', () => {
    render(<OrderTypeTabs value="dine_in" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Dine In' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Take-Out' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delivery' })).toBeInTheDocument();
  });

  it('marks selected tab as aria-pressed', () => {
    render(<OrderTypeTabs value="take_out" onChange={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Take-Out' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Dine In' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('calls onChange when tab clicked', () => {
    const onChange = vi.fn();
    render(<OrderTypeTabs value="dine_in" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Delivery' }));
    expect(onChange).toHaveBeenCalledWith('delivery');
  });
});
