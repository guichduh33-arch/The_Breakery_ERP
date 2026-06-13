import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FullScreenModal } from '../FullScreenModal.js';

describe('FullScreenModal', () => {
  it('renders children when open', () => {
    render(
      <FullScreenModal open={true} onOpenChange={vi.fn()}>
        <p>Modal content</p>
      </FullScreenModal>,
    );
    expect(screen.getByText('Modal content')).toBeInTheDocument();
  });

  it('does not render children when closed', () => {
    render(
      <FullScreenModal open={false} onOpenChange={vi.fn()}>
        <p>Hidden content</p>
      </FullScreenModal>,
    );
    expect(screen.queryByText('Hidden content')).not.toBeInTheDocument();
  });

  // S43 P2-4 — accessible dialog titles.
  it('renders a visually-hidden default title "Dialog" when none is provided', () => {
    render(
      <FullScreenModal open={true} onOpenChange={vi.fn()}>
        <p>Body</p>
      </FullScreenModal>,
    );
    expect(screen.getByRole('dialog', { name: 'Dialog' })).toBeInTheDocument();
  });

  it('uses accessibleTitle as the dialog accessible name', () => {
    render(
      <FullScreenModal open={true} onOpenChange={vi.fn()} accessibleTitle="Payment terminal">
        <p>Body</p>
      </FullScreenModal>,
    );
    expect(screen.getByRole('dialog', { name: 'Payment terminal' })).toBeInTheDocument();
  });

  it('still honours the legacy title prop (pre-S43 call-sites)', () => {
    render(
      <FullScreenModal open={true} onOpenChange={vi.fn()} title="Resume terminal">
        <p>Body</p>
      </FullScreenModal>,
    );
    expect(screen.getByRole('dialog', { name: 'Resume terminal' })).toBeInTheDocument();
  });
});
