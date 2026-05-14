import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Coffee } from 'lucide-react';
import { EmptyState } from '../EmptyState.js';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No data" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders title in Playfair italic (font-display italic class)', () => {
    render(<EmptyState title="No transfers yet" />);
    const heading = screen.getByText('No transfers yet');
    expect(heading.className).toMatch(/font-display/);
    expect(heading.className).toMatch(/italic/);
  });

  it('renders optional description and action node', () => {
    render(
      <EmptyState
        title="No transfers yet"
        description="Create the first transfer to begin."
        action={<button type="button">New transfer</button>}
      />,
    );
    expect(screen.getByText('Create the first transfer to begin.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New transfer' })).toBeInTheDocument();
  });

  it('renders icon as a ReactNode (legacy API)', () => {
    render(
      <EmptyState
        icon={<svg data-testid="empty-icon" />}
        title="Empty"
      />,
    );
    const icon = screen.getByTestId('empty-icon');
    expect(icon).toBeInTheDocument();
    expect(icon.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders icon as a Lucide component (new API)', () => {
    render(<EmptyState icon={Coffee} title="Empty" />);
    // Lucide renders an <svg> with class lucide-coffee.
    const svg = document.querySelector('svg');
    expect(svg).not.toBeNull();
  });

  it('renders {label, onClick} action as a button and fires onClick', () => {
    const handler = vi.fn();
    render(
      <EmptyState
        title="Empty"
        action={{ label: 'Add transfer', onClick: handler }}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Add transfer' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(handler).toHaveBeenCalledOnce();
  });

  it('renders BrandMark when tone=branded and no icon', () => {
    render(<EmptyState tone="branded" title="Welcome to The Breakery" />);
    // BrandMark uses role='img' with aria-label.
    expect(screen.getByRole('img', { name: 'The Breakery' })).toBeInTheDocument();
  });

  it('respects size variants', () => {
    const { rerender } = render(<EmptyState data-testid="es" title="x" size="sm" />);
    expect(screen.getByTestId('es').className).toMatch(/py-8/);
    rerender(<EmptyState data-testid="es" title="x" size="lg" />);
    expect(screen.getByTestId('es').className).toMatch(/py-16/);
  });

  it('propagates data-testid to the outer element', () => {
    render(<EmptyState title="x" data-testid="empty-root" />);
    expect(screen.getByTestId('empty-root')).toBeInTheDocument();
  });
});
