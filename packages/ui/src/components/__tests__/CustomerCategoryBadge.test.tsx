import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  CustomerCategoryBadge,
  type CustomerCategory,
} from '../CustomerCategoryBadge.js';

const vipCategory: CustomerCategory = {
  id: 'cat-vip',
  name: 'VIP',
  slug: 'vip',
  color: '#F59E0B',
  icon: '⭐',
  price_modifier_type: 'discount_percentage',
  discount_percentage: 5,
  loyalty_enabled: true,
  points_multiplier: 1.2,
  is_default: false,
};

const noColorCategory: CustomerCategory = {
  id: 'cat-custom',
  name: 'Custom',
  slug: 'custom',
  color: null,
  icon: null,
  price_modifier_type: 'custom',
  discount_percentage: 0,
  loyalty_enabled: true,
  points_multiplier: 1.0,
  is_default: false,
};

describe('CustomerCategoryBadge', () => {
  it('renders category name and icon when provided', () => {
    render(<CustomerCategoryBadge category={vipCategory} />);
    expect(screen.getByText('VIP')).toBeInTheDocument();
    expect(screen.getByText('⭐')).toBeInTheDocument();
  });

  it('renders null category as Retail fallback', () => {
    render(<CustomerCategoryBadge category={null} />);
    expect(screen.getByText('Retail')).toBeInTheDocument();
  });

  it('applies category color via inline style when color is present', () => {
    const { container } = render(<CustomerCategoryBadge category={vipCategory} />);
    const badge = container.firstChild as HTMLElement;
    // jsdom normalizes hex to rgb/rgba; verify both color and background-color are set
    expect(badge.style.color).toBeTruthy();
    expect(badge.style.backgroundColor).toBeTruthy();
    // color should resolve to the VIP amber value (245, 158, 11)
    expect(badge.style.color).toContain('245, 158, 11');
    expect(badge.style.backgroundColor).toContain('245, 158, 11');
  });

  it('falls back to bullet icon when category has no icon', () => {
    render(<CustomerCategoryBadge category={noColorCategory} />);
    expect(screen.getByText('•')).toBeInTheDocument();
  });

  it('applies fallback slate color inline style when category.color is null', () => {
    const { container } = render(<CustomerCategoryBadge category={noColorCategory} />);
    const badge = container.firstChild as HTMLElement;
    // fallback color #64748B
    expect(badge.style.color).toBeTruthy();
  });

  it('passes className to the badge element', () => {
    const { container } = render(
      <CustomerCategoryBadge category={vipCategory} className="test-class" />,
    );
    expect(container.firstChild).toHaveClass('test-class');
  });
});
