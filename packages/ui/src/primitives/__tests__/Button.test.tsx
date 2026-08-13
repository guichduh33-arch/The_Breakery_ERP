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
  // DESIGN.md exige liseré ET halo au focus (--shadow-focus, audit P1-1) ; le
  // seul `focus-visible:outline-*` a déjà été silencieusement absorbé une fois
  // par tailwind-merge (voir cn.ts) — on fige la présence de l'utilitaire.
  it('carries the focus halo utility alongside the outline ring', () => {
    render(<Button>F</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('focus-visible:outline-gold');
    expect(btn).toHaveClass('focus-visible:shadow-focus');
  });
  it('disables when disabled', () => {
    render(<Button disabled>D</Button>);
    expect(screen.getByRole('button')).toBeDisabled();
  });
  // A filled button must go neutral when disabled, not merely translucent:
  // half-opacity green/gold still reads as a live action (design audit
  // 2026-08-04).
  it.each(['primary', 'gold'] as const)('neutralises the %s fill when disabled', (variant) => {
    render(<Button variant={variant} disabled>D</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveClass('disabled:bg-surface-4');
    expect(btn).toHaveClass('disabled:text-text-muted');
    expect(btn).toHaveClass('disabled:opacity-100');
  });
});
