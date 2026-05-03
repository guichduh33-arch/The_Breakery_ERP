import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Currency } from '../Currency.js';

describe('Currency', () => {
  it('formats amount as IDR', () => {
    render(<Currency amount={35000} />);
    expect(screen.getByText('Rp 35,000')).toBeInTheDocument();
  });

  it('applies gold emphasis class', () => {
    const { container } = render(<Currency amount={35000} emphasis="gold" />);
    expect(container.firstChild).toHaveClass('text-gold');
  });

  it('applies large emphasis class', () => {
    const { container } = render(<Currency amount={35000} emphasis="large" />);
    expect(container.firstChild).toHaveClass('text-3xl');
  });
});
