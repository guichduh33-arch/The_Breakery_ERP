import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandMark } from '../BrandMark.js';

describe('BrandMark', () => {
  it('renders default size (md = 40px) with default glyph B', () => {
    render(<BrandMark />);
    const wrapper = screen.getByRole('img', { name: 'The Breakery' });
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.getAttribute('style')).toContain('width: 40px');
    expect(wrapper.getAttribute('style')).toContain('height: 40px');
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('renders all 4 sizes with correct dimensions', () => {
    const cases: Array<[
      'sm' | 'md' | 'lg' | 'xl',
      number,
    ]> = [['sm', 32], ['md', 40], ['lg', 64], ['xl', 96]];
    for (const [size, px] of cases) {
      const { unmount } = render(<BrandMark size={size} />);
      const el = screen.getByRole('img', { name: 'The Breakery' });
      expect(el.getAttribute('style')).toContain(`width: ${px}px`);
      unmount();
    }
  });

  it('honors custom glyph + label', () => {
    render(<BrandMark glyph="TB" label="Custom Mark" />);
    expect(screen.getByRole('img', { name: 'Custom Mark' })).toBeInTheDocument();
    expect(screen.getByText('TB')).toBeInTheDocument();
  });

  it('merges custom className', () => {
    render(<BrandMark className="custom-x" />);
    const wrapper = screen.getByRole('img', { name: 'The Breakery' });
    expect(wrapper.className).toMatch(/custom-x/);
  });
});
