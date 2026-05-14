// apps/pos/src/features/cart/__tests__/CartTotals.test.tsx
//
// Session 14 / Phase 2.B — verify the totals block renders the right lines
// in the right order for the common breakdowns from refs 30 & 32.

/// <reference types="@testing-library/jest-dom" />
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CartTotals } from '../CartTotals';

describe('CartTotals', () => {
  it('shows subtotal + tax + total when no extras', () => {
    render(
      <CartTotals
        breakdown={{
          subtotal: 80000,
          redemption_amount: 0,
          loyaltyPointsToRedeem: 0,
          tax_amount: 7273,
          total: 80000,
          appliedPromotions: [],
        }}
      />,
    );
    expect(screen.getByText(/Subtotal/i)).toBeInTheDocument();
    expect(screen.getByText(/Tax Included/i)).toBeInTheDocument();
    expect(screen.getByText(/Total Amount/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Rp\s*80,000/).length).toBeGreaterThan(0);
  });

  it('renders Loyalty Discount line when redemption applied', () => {
    render(
      <CartTotals
        breakdown={{
          subtotal: 35000,
          redemption_amount: 5000,
          loyaltyPointsToRedeem: 500,
          tax_amount: 2727,
          total: 30000,
          appliedPromotions: [],
        }}
      />,
    );
    expect(screen.getByText(/loyalty discount/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Rp\s*30,000/).length).toBeGreaterThan(0);
  });

  it('renders cart Discount line when set', () => {
    render(
      <CartTotals
        breakdown={{
          subtotal: 100000,
          redemption_amount: 0,
          loyaltyPointsToRedeem: 0,
          tax_amount: 9091,
          total: 90000,
          appliedPromotions: [],
          cartDiscount: { type: 'percentage', value: 10, amount: 10000 },
        }}
      />,
    );
    expect(screen.getByText(/Discount \(10%\)/i)).toBeInTheDocument();
  });
});
