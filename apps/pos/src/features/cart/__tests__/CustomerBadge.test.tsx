// apps/pos/src/features/cart/__tests__/CustomerBadge.test.tsx
//
// Session 14 / Phase 2.B — verify the badge:
//   - shows the customer name, tier label, points (when > 0),
//   - exposes a `Detach customer` aria-labelled button,
//   - renders the initial inside an avatar circle.

/// <reference types="@testing-library/jest-dom" />
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CustomerBadge } from '../CustomerBadge';
import type { CustomerWithCategory } from '@/stores/cartStore';

const baseCustomer: CustomerWithCategory = {
  id: 'cust-1',
  name: 'Bali Organic Store',
  phone: '+62812',
  email: null,
  customer_type: 'retail',
  loyalty_points: 0,
  lifetime_points: 0,
  total_spent: 0,
  total_visits: 0,
  last_visit_at: null,
};

describe('CustomerBadge', () => {
  it('renders name + tier (Bronze when no lifetime points)', () => {
    render(<CustomerBadge customer={baseCustomer} onDetach={() => {}} />);
    expect(screen.getByText('Bali Organic Store')).toBeInTheDocument();
    expect(screen.getByText('Bronze')).toBeInTheDocument();
  });

  it('renders first initial inside the avatar circle', () => {
    render(<CustomerBadge customer={baseCustomer} onDetach={() => {}} />);
    // The initial is rendered inside an aria-hidden span — find by text.
    expect(screen.getByText('B', { selector: 'span[aria-hidden]' })).toBeInTheDocument();
  });

  it('shows the Gold tier and points pill when balance > 0', () => {
    render(
      <CustomerBadge
        customer={{ ...baseCustomer, name: 'Loyal Gold Customer', loyalty_points: 2500, lifetime_points: 2500 }}
        onDetach={() => {}}
      />,
    );
    expect(screen.getByText('Gold')).toBeInTheDocument();
    expect(screen.getByText(/2,500 pts/)).toBeInTheDocument();
  });

  it('exposes a "Detach customer" button and fires the handler on click', () => {
    const onDetach = vi.fn();
    render(<CustomerBadge customer={baseCustomer} onDetach={onDetach} />);
    fireEvent.click(screen.getByRole('button', { name: /detach customer/i }));
    expect(onDetach).toHaveBeenCalledTimes(1);
  });
});
