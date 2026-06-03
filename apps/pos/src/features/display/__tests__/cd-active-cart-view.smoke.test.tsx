/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CDActiveCartView } from '../CDActiveCartView';
import type { CartBroadcastMessage } from '../hooks/useCartBroadcast';

const payload: CartBroadcastMessage = {
  type: 'cart_update',
  cart: { items: [{ id: 'l1', product_id: 'p1', name: 'Latte', unit_price: 30000, quantity: 2, modifiers: [] }], order_type: 'dine_in' },
  totals: { subtotal: 60000, total: 66000, item_count: 2 },
  customer: { name: 'Dewi' },
};

describe('CDActiveCartView', () => {
  it('renders line items, total, and the attached customer', () => {
    render(<CDActiveCartView message={payload} />);
    expect(screen.getByText('Latte')).toBeInTheDocument();
    expect(screen.getByText(/Dewi/)).toBeInTheDocument();
    expect(screen.getByText(/66.?000/)).toBeInTheDocument();
  });

  it('renders an empty state when there is no message', () => {
    render(<CDActiveCartView message={null} />);
    expect(screen.getByText(/welcome/i)).toBeInTheDocument();
  });
});
