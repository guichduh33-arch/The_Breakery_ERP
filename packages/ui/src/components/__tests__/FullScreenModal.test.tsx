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
});
