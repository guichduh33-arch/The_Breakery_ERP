import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoyaltyBadge } from '../LoyaltyBadge.js';

describe('LoyaltyBadge', () => {
  it('renders bronze tier with warning tokens and points', () => {
    render(<LoyaltyBadge tier="bronze" points={120} />);
    const badge = screen.getByText('Bronze').parentElement;
    expect(badge).toHaveClass('bg-warning-soft', 'text-warning');
    expect(screen.getByText(/120/)).toBeInTheDocument();
  });

  it('renders silver tier with neutral tokens and points', () => {
    render(<LoyaltyBadge tier="silver" points={650} />);
    const badge = screen.getByText('Silver').parentElement;
    expect(badge).toHaveClass('bg-bg-overlay', 'text-text-secondary');
    expect(screen.getByText(/650/)).toBeInTheDocument();
  });

  it('renders gold tier with gold classes and points', () => {
    render(<LoyaltyBadge tier="gold" points={2500} />);
    const badge = screen.getByText('Gold').parentElement;
    expect(badge).toHaveClass('bg-gold-soft', 'text-gold');
    expect(screen.getByText(/2[,.]?500/)).toBeInTheDocument();
  });

  it('renders platinum tier with info tokens and points', () => {
    render(<LoyaltyBadge tier="platinum" points={5100} />);
    const badge = screen.getByText('Platinum').parentElement;
    expect(badge).toHaveClass('bg-info-soft', 'text-info');
    expect(screen.getByText(/5[,.]?100/)).toBeInTheDocument();
  });
});
