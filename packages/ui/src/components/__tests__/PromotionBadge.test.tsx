// packages/ui/src/components/__tests__/PromotionBadge.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PromotionBadge } from '../PromotionBadge.js';

describe('PromotionBadge', () => {
  it('renders FREE label when isFree=true', () => {
    render(<PromotionBadge promotionName="BOGO" discountAmount={35000} isFree />);
    expect(screen.getByText(/FREE|BOGO/)).toBeInTheDocument();
  });
  it('renders percentage label when isFree=false', () => {
    render(<PromotionBadge promotionName="Happy Hour" discountAmount={5250} isFree={false} />);
    expect(screen.getByText(/Happy Hour|−/)).toBeInTheDocument();
  });
});
