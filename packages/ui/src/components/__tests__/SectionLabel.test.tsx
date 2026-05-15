import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SectionLabel } from '../SectionLabel.js';

describe('SectionLabel', () => {
  it('renders children with default tag (div)', () => {
    render(<SectionLabel>Operations</SectionLabel>);
    const el = screen.getByText('Operations');
    expect(el.tagName).toBe('DIV');
  });

  it('renders as h2 when as="h2"', () => {
    render(<SectionLabel as="h2">Management</SectionLabel>);
    const el = screen.getByText('Management');
    expect(el.tagName).toBe('H2');
  });

  it('applies signature uppercase + tracking-widest classes', () => {
    render(<SectionLabel data-testid="sl">Active order</SectionLabel>);
    const cls = screen.getByTestId('sl').className;
    expect(cls).toMatch(/uppercase/);
    expect(cls).toMatch(/tracking-widest/);
    expect(cls).toMatch(/font-bold/);
    expect(cls).toMatch(/text-text-muted/);
  });

  it('uses text-xs by default and text-sm with size=sm', () => {
    const { rerender } = render(<SectionLabel data-testid="sl">x</SectionLabel>);
    expect(screen.getByTestId('sl').className).toMatch(/text-xs/);
    rerender(<SectionLabel data-testid="sl" size="sm">x</SectionLabel>);
    expect(screen.getByTestId('sl').className).toMatch(/text-sm/);
  });

  it('merges custom className', () => {
    render(<SectionLabel data-testid="sl" className="text-gold">x</SectionLabel>);
    expect(screen.getByTestId('sl').className).toMatch(/text-gold/);
  });
});
