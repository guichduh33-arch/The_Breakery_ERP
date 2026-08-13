import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Input } from '../Input.js';

describe('Input', () => {
  it('renders with placeholder', () => {
    render(<Input placeholder="type" />);
    expect(screen.getByPlaceholderText('type')).toBeInTheDocument();
  });
  // DESIGN.md exige liseré ET halo au focus (--shadow-focus, audit P1-1).
  it('carries the focus halo utility alongside the outline ring', () => {
    render(<Input placeholder="type" />);
    const input = screen.getByPlaceholderText('type');
    expect(input).toHaveClass('focus-visible:outline-gold');
    expect(input).toHaveClass('focus-visible:shadow-focus');
  });
});
