import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BrandLogo, type BrandLogoSize } from '../BrandLogo.js';

describe('BrandLogo', () => {
  it('renders default size (lg = 280x140) with default label', () => {
    render(<BrandLogo />);
    const wrapper = screen.getByRole('img', {
      name: 'The Breakery — French Bakery & Pastry',
    });
    expect(wrapper).toBeInTheDocument();
    expect(wrapper.getAttribute('style')).toContain('width: 280px');
    expect(wrapper.getAttribute('style')).toContain('height: 140px');
    expect(wrapper.getAttribute('data-size')).toBe('lg');
    // Wordmark is rendered as SVG <text> — query by text content
    expect(screen.getByText('THE BREAKERY')).toBeInTheDocument();
  });

  it('renders all 4 size variants with correct pixel dimensions', () => {
    const cases: Array<[BrandLogoSize, number, number]> = [
      ['sm', 120, 60],
      ['md', 200, 100],
      ['lg', 280, 140],
      ['xl', 400, 200],
    ];
    for (const [size, w, h] of cases) {
      const { unmount } = render(<BrandLogo size={size} />);
      const el = screen.getByRole('img', {
        name: 'The Breakery — French Bakery & Pastry',
      });
      expect(el.getAttribute('style')).toContain(`width: ${w}px`);
      expect(el.getAttribute('style')).toContain(`height: ${h}px`);
      expect(el.getAttribute('data-size')).toBe(size);
      unmount();
    }
  });

  it('shows tagline by default for lg + xl', () => {
    const { unmount: u1 } = render(<BrandLogo size="lg" />);
    expect(screen.getByTestId('brand-logo-tagline')).toBeInTheDocument();
    expect(screen.getByText('French Bakery')).toBeInTheDocument();
    expect(screen.getByText('Pastry')).toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(<BrandLogo size="xl" />);
    expect(screen.getByTestId('brand-logo-tagline')).toBeInTheDocument();
    u2();
  });

  it('hides tagline by default for sm + md', () => {
    const { unmount: u1 } = render(<BrandLogo size="sm" />);
    expect(screen.queryByTestId('brand-logo-tagline')).not.toBeInTheDocument();
    expect(screen.queryByText('French Bakery')).not.toBeInTheDocument();
    u1();

    const { unmount: u2 } = render(<BrandLogo size="md" />);
    expect(screen.queryByTestId('brand-logo-tagline')).not.toBeInTheDocument();
    u2();
  });

  it('respects explicit showTagline=false on lg', () => {
    render(<BrandLogo size="lg" showTagline={false} />);
    expect(screen.queryByTestId('brand-logo-tagline')).not.toBeInTheDocument();
    expect(screen.queryByText('French Bakery')).not.toBeInTheDocument();
    // Wordmark and croissant are still present
    expect(screen.getByText('THE BREAKERY')).toBeInTheDocument();
  });

  it('respects explicit showTagline=true on sm', () => {
    render(<BrandLogo size="sm" showTagline />);
    expect(screen.getByTestId('brand-logo-tagline')).toBeInTheDocument();
    expect(screen.getByText('French Bakery')).toBeInTheDocument();
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
