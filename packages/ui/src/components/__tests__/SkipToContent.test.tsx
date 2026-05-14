import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkipToContent } from '../SkipToContent.js';

describe('SkipToContent', () => {
  it('renders an anchor with default href and label', () => {
    render(<SkipToContent />);
    const link = screen.getByRole('link', { name: 'Skip to main content' });
    expect(link).toHaveAttribute('href', '#main-content');
  });

  it('respects custom href + label', () => {
    render(<SkipToContent href="#app" label="Skip" />);
    const link = screen.getByRole('link', { name: 'Skip' });
    expect(link).toHaveAttribute('href', '#app');
  });

  it('is visually hidden by default (sr-only) and shown on focus', () => {
    render(<SkipToContent />);
    const link = screen.getByRole('link');
    // Tailwind classes are applied as-is in tests; assert presence of the
    // visually-hidden helper class.
    expect(link.className).toMatch(/sr-only/);
    expect(link.className).toMatch(/focus:not-sr-only/);
  });

  it('propagates data-testid', () => {
    render(<SkipToContent data-testid="custom-skip" />);
    expect(screen.getByTestId('custom-skip')).toBeInTheDocument();
  });
});
