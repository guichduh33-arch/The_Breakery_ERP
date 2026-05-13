// apps/backoffice/src/features/inventory-opname/__tests__/OpnameStatusBadge.test.tsx
// Session 13 / Phase 2.D — smoke test for the status pill component.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OpnameStatusBadge } from '../components/OpnameStatusBadge.js';

describe('OpnameStatusBadge', () => {
  it('renders the human label for each status', () => {
    const cases = [
      ['draft',     'Draft'],
      ['counting',  'Counting'],
      ['review',    'Review'],
      ['finalized', 'Finalized'],
      ['cancelled', 'Cancelled'],
    ] as const;
    for (const [status, label] of cases) {
      const { unmount } = render(<OpnameStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeInTheDocument();
      unmount();
    }
  });

  it('applies status-specific colour classes', () => {
    const { container, rerender } = render(<OpnameStatusBadge status="draft" />);
    expect(container.firstChild).toHaveClass('text-text-secondary');

    rerender(<OpnameStatusBadge status="finalized" />);
    expect(container.firstChild).toHaveClass('text-emerald-700');

    rerender(<OpnameStatusBadge status="cancelled" />);
    expect(container.firstChild).toHaveClass('text-rose-700');
  });
});
