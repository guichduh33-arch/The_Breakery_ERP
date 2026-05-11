import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { AppliedPromotion } from '@breakery/domain';
import { PromotionLineRow } from '../PromotionLineRow.js';
import { PromotionTypeBadge } from '../PromotionTypeBadge.js';

const basePercentage: AppliedPromotion = {
  promotion_id: 'promo-1',
  slug: 'happy-hour',
  name: 'Happy Hour Beverage',
  type: 'percentage',
  amount: 3500,
  description: 'Happy Hour Beverage −10%',
};

describe('PromotionLineRow', () => {
  it('renders the promo name and a negative IDR amount for non-gift promos', () => {
    render(<PromotionLineRow applied={basePercentage} />);
    expect(screen.getByText('Happy Hour Beverage')).toBeInTheDocument();
    expect(screen.getByText(/-/)).toBeInTheDocument();
    expect(screen.queryByText(/free gift/i)).toBeNull();
  });

  it('renders "free gift" instead of an amount for free_product promos', () => {
    const gift: AppliedPromotion = {
      ...basePercentage,
      type: 'free_product',
      amount: 0,
      name: 'VIP Free Croissant',
    };
    render(<PromotionLineRow applied={gift} />);
    expect(screen.getByText('VIP Free Croissant')).toBeInTheDocument();
    expect(screen.getByText(/free gift/i)).toBeInTheDocument();
  });

  it('exposes promotion id and type via data attributes for cart-panel queries', () => {
    const { container } = render(<PromotionLineRow applied={basePercentage} />);
    const row = container.querySelector('[data-promotion-id]');
    expect(row).not.toBeNull();
    expect(row?.getAttribute('data-promotion-id')).toBe('promo-1');
    expect(row?.getAttribute('data-promotion-type')).toBe('percentage');
  });

  it('forwards a custom className', () => {
    const { container } = render(<PromotionLineRow applied={basePercentage} className="custom-x" />);
    expect(container.querySelector('.custom-x')).not.toBeNull();
  });
});

describe('PromotionTypeBadge', () => {
  it('renders distinct labels for each promotion type', () => {
    const { rerender } = render(<PromotionTypeBadge type="percentage" />);
    expect(screen.getByText('% off')).toBeInTheDocument();

    rerender(<PromotionTypeBadge type="fixed_amount" />);
    expect(screen.getByText('IDR off')).toBeInTheDocument();

    rerender(<PromotionTypeBadge type="bogo" />);
    expect(screen.getByText('BOGO')).toBeInTheDocument();

    rerender(<PromotionTypeBadge type="free_product" />);
    expect(screen.getByText('Free gift')).toBeInTheDocument();
  });

  it('exposes type via data attribute for selectors', () => {
    const { container } = render(<PromotionTypeBadge type="bogo" />);
    expect(container.querySelector('[data-promotion-type="bogo"]')).not.toBeNull();
  });

  it('merges custom classes', () => {
    const { container } = render(<PromotionTypeBadge type="percentage" className="x-mark" />);
    expect(container.querySelector('.x-mark')).not.toBeNull();
  });
});
