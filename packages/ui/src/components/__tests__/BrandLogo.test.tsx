import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo, type BrandLogoSize } from '../BrandLogo.js';

describe('BrandLogo', () => {
  it('renders default size (lg, height 128) with default label', () => {
    render(<BrandLogo />);
    const wrapper = screen.getByRole('img', {
      name: 'The Breakery — French Bakery & Pastry',
    });
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.getAttribute('style')).toContain('height: 128px');
    expect(wrapper.getAttribute('data-size')).toBe('lg');
    expect(wrapper.getAttribute('data-testid')).toBe('brand-logo');
    // Artwork is a raster <img> nested in the wrapper.
    expect(wrapper.querySelector('img')).not.toBeNull();
  });

  it('renders all 4 size variants with the correct rendered height', () => {
    const cases: [BrandLogoSize, number][] = [
      ['sm', 52],
      ['md', 84],
      ['lg', 128],
      ['xl', 190],
    ];
    for (const [size, h] of cases) {
      const { unmount } = render(<BrandLogo size={size} />);
      const el = screen.getByRole('img', {
        name: 'The Breakery — French Bakery & Pastry',
      });
      expect(el.getAttribute('style')).toContain(`height: ${h}px`);
      expect(el.getAttribute('data-size')).toBe(size);
      unmount();
    }
  });

  it('marks tagline on by default for lg + xl (dark theme)', () => {
    const { unmount: u1 } = render(<BrandLogo size="lg" />);
    expect(screen.getByTestId('brand-logo').getAttribute('data-tagline')).toBe('on');
    u1();

    const { unmount: u2 } = render(<BrandLogo size="xl" />);
    expect(screen.getByTestId('brand-logo').getAttribute('data-tagline')).toBe('on');
    u2();
  });

  it('marks tagline off by default for sm + md', () => {
    const { unmount: u1 } = render(<BrandLogo size="sm" />);
    expect(screen.getByTestId('brand-logo').getAttribute('data-tagline')).toBe('off');
    u1();

    const { unmount: u2 } = render(<BrandLogo size="md" />);
    expect(screen.getByTestId('brand-logo').getAttribute('data-tagline')).toBe('off');
    u2();
  });

  it('respects explicit showTagline=false on lg', () => {
    render(<BrandLogo size="lg" showTagline={false} />);
    expect(screen.getByTestId('brand-logo').getAttribute('data-tagline')).toBe('off');
  });

  it('respects explicit showTagline=true on sm', () => {
    render(<BrandLogo size="sm" showTagline />);
    expect(screen.getByTestId('brand-logo').getAttribute('data-tagline')).toBe('on');
  });

  it('uses the light variant (no tagline) under theme="backoffice"', () => {
    render(<BrandLogo size="lg" theme="backoffice" />);
    const el = screen.getByTestId('brand-logo');
    expect(el.getAttribute('data-theme')).toBe('backoffice');
    // Light artwork has no tagline crop — always off regardless of size.
    expect(el.getAttribute('data-tagline')).toBe('off');
  });

  it('merges custom className on outer wrapper', () => {
    render(<BrandLogo className="custom-xx" />);
    const wrapper = screen.getByRole('img', {
      name: 'The Breakery — French Bakery & Pastry',
    });
    expect(wrapper.className).toMatch(/custom-xx/);
  });

  it('honors custom label', () => {
    render(<BrandLogo label="Custom Brand Label" />);
    expect(screen.getByRole('img', { name: 'Custom Brand Label' })).toBeInTheDocument();
  });

  it('accepts theme override prop without crashing', () => {
    const { unmount: u1 } = render(<BrandLogo theme="pos" />);
    expect(
      screen.getByRole('img', { name: 'The Breakery — French Bakery & Pastry' }),
    ).toBeInTheDocument();
    u1();
    render(<BrandLogo theme="backoffice" />);
    expect(
      screen.getByRole('img', { name: 'The Breakery — French Bakery & Pastry' }),
    ).toBeInTheDocument();
  });
});
