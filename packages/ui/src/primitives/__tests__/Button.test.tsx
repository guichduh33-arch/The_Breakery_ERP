import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button.js';

describe('Button', () => {
  it('renders text', () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });
  it('applies variant classes', () => {
    render(<Button variant="primary">P</Button>);
    expect(screen.getByRole('button')).toHaveClass('bg-green');
  });
  it('disables when disabled', () => {
    render(<Button disabled>D</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
});
