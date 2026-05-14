import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EmptyState } from '../EmptyState.js';

describe('EmptyState', () => {
  it('renders title', () => {
    render(<EmptyState title="No data" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('renders optional description and action', () => {
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

  it('renders icon when provided (aria-hidden)', () => {
    render(
      <EmptyState
        icon={<svg data-testid="empty-icon" />}
        title="Empty"
      />,
    );
    const icon = screen.getByTestId('empty-icon');
    expect(icon).toBeInTheDocument();
    // The wrapper is aria-hidden so screen readers skip it.
    expect(icon.parentElement?.getAttribute('aria-hidden')).toBe('true');
  });

  it('propagates data-testid to the outer element', () => {
    render(<EmptyState title="x" data-testid="empty-root" />);
    expect(screen.getByTestId('empty-root')).toBeInTheDocument();
  });
});
