// apps/pos/src/features/cart/__tests__/CartActionsBar.test.tsx
//
// Session 14 / Phase 2.B — verify the action row:
//   - Held Orders button disabled when count is 0 ; enabled with badge when > 0.
//   - Clear button disabled when canClear is false ; calls handler on click.

/// <reference types="@testing-library/jest-dom" />
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CartActionsBar } from '../CartActionsBar';

describe('CartActionsBar', () => {
  it('disables Held Orders when count is 0', () => {
    render(
      <CartActionsBar
        heldCount={0}
        onOpenHeldOrders={vi.fn()}
        onClear={vi.fn()}
        canClear
      />,
    );
    const heldBtn = screen.getByRole('button', { name: /held orders/i });
    expect(heldBtn).toBeDisabled();
  });

  it('shows the count badge when heldCount > 0', () => {
    render(
      <CartActionsBar
        heldCount={3}
        onOpenHeldOrders={vi.fn()}
        onClear={vi.fn()}
        canClear
      />,
    );
    const heldBtn = screen.getByRole('button', { name: /held orders/i });
    expect(heldBtn).toBeEnabled();
    expect(screen.getByLabelText(/3 held orders/i)).toBeInTheDocument();
  });

  it('Clear button is disabled when canClear is false', () => {
    render(
      <CartActionsBar
        heldCount={0}
        onOpenHeldOrders={vi.fn()}
        onClear={vi.fn()}
        canClear={false}
      />,
    );
    const clearBtn = screen.getByRole('button', { name: /clear/i });
    expect(clearBtn).toBeDisabled();
  });

  it('Clear button fires the handler when clicked', () => {
    const onClear = vi.fn();
    render(
      <CartActionsBar
        heldCount={0}
        onOpenHeldOrders={vi.fn()}
        onClear={onClear}
        canClear
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /clear/i }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });
});
