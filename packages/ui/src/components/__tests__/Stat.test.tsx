import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stat } from '../Stat.js';

describe('Stat', () => {
  it('renders label + value', () => {
    render(<Stat label="Active Orders" value="12" />);
    expect(screen.getByText('Active Orders')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('applies horizontal layout by default', () => {
    render(<Stat label="x" value="1" />);
    const wrapper = screen.getByText('x').parentElement;
    expect(wrapper?.className).toMatch(/flex/);
    expect(wrapper?.className).toMatch(/items-baseline/);
    expect(wrapper?.className).toMatch(/justify-between/);
  });

  it('applies vertical layout when direction=vertical', () => {
    render(<Stat label="x" value="1" direction="vertical" />);
    const wrapper = screen.getByText('x').parentElement;
    expect(wrapper?.className).toMatch(/flex-col/);
  });

  it('applies gold emphasis to value', () => {
    render(<Stat label="x" value="123" emphasis="gold" />);
    expect(screen.getByText('123').className).toMatch(/text-gold/);
  });

  it('renders React node as value', () => {
    render(<Stat label="x" value={<span data-testid="custom">42</span>} />);
    expect(screen.getByTestId('custom')).toBeInTheDocument();
  });
});
