import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoyaltyBadge } from '../LoyaltyBadge.js';

describe('LoyaltyBadge', () => {
  it('renders bronze tier with amber classes and points', () => {
    render(<LoyaltyBadge tier="bronze" points={120} />);
    const badge = screen.getByText('Bronze').parentElement;
    expect(badge).toHaveClass('bg-amber-100', 'text-amber-800');
    expect(screen.getByText(/120/)).toBeInTheDocument();
  });

  it('renders silver tier with slate classes and points', () => {
    render(<LoyaltyBadge tier="silver" points={650} />);
    const badge = screen.getByText('Silver').parentElement;
    expect(badge).toHaveClass('bg-slate-200', 'text-slate-700');
    expect(screen.getByText(/650/)).toBeInTheDocument();
  });

  it('renders gold tier with gold classes and points', () => {
    render(<LoyaltyBadge tier="gold" points={2500} />);
    const badge = screen.getByText('Gold').parentElement;
    expect(badge).toHaveClass('bg-gold-soft', 'text-gold');
    expect(screen.getByText(/2[,.]?500/)).toBeInTheDocument();
  });

  it('renders platinum tier with violet classes and points', () => {
    render(<LoyaltyBadge tier="platinum" points={5100} />);
    const badge = screen.getByText('Platinum').parentElement;
    expect(badge).toHaveClass('bg-violet-100', 'text-violet-800');
    expect(screen.getByText(/5[,.]?100/)).toBeInTheDocument();
  });
});
