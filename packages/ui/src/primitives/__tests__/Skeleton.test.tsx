import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Skeleton } from '../Skeleton.js';

describe('Skeleton', () => {
  it('renders a pulsing, motion-safe, decorative placeholder', () => {
    const { container } = render(<Skeleton />);
    const el = container.querySelector('[data-slot="skeleton"]');
    expect(el).not.toBeNull();
    expect(el?.getAttribute('aria-hidden')).toBe('true');
    expect(el?.className).toContain('animate-pulse');
    expect(el?.className).toContain('bg-surface-4');
    expect(el?.className).toContain('motion-reduce:animate-none');
    // default line variant gets a text-height fallback + tight radius
    expect(el?.className).toContain('h-4');
    expect(el?.className).toContain('rounded-sm');
  });

  it('maps variants to radii', () => {
    const { container: block } = render(<Skeleton variant="block" />);
    expect(block.querySelector('[data-slot="skeleton"]')?.className).toContain('rounded-md');
    const { container: circle } = render(<Skeleton variant="circle" />);
    expect(circle.querySelector('[data-slot="skeleton"]')?.className).toContain('rounded-full');
  });

  it('applies width/height props as inline styles and drops the h-4 fallback when sized', () => {
    const { container } = render(<Skeleton width={120} height="2rem" />);
    const el = container.querySelector<HTMLElement>('[data-slot="skeleton"]');
    expect(el?.style.width).toBe('120px');
    expect(el?.style.height).toBe('2rem');
    expect(el?.className).not.toContain('h-4');
  });

  it('merges custom className', () => {
    const { container } = render(<Skeleton className="custom-x" />);
    expect(container.querySelector('[data-slot="skeleton"]')?.className).toMatch(/custom-x/);
  });
});
