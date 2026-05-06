// packages/ui/src/components/__tests__/PromotionLineRow.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromotionLineRow } from '../PromotionLineRow.js';

describe('PromotionLineRow', () => {
  it('renders name + discount amount formatted IDR', () => {
    render(<PromotionLineRow name="Happy Hour" discount_amount={5250} />);
    expect(screen.getByText(/Happy Hour/)).toBeInTheDocument();
    expect(screen.getByText(/5\.250|5,250/)).toBeInTheDocument();
  });
  it('renders subtitle when provided', () => {
    render(<PromotionLineRow name="Promo X" discount_amount={1000} subtitle="−15% category" />);
    expect(screen.getByText('−15% category')).toBeInTheDocument();
  });
});
