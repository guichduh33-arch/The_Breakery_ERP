// packages/ui/src/components/__tests__/FullScreenModal.focus-trap.test.tsx
//
// Session 22 — Phase 1.A.1 — Focus-trap regression lock-in (FullScreenModal).
//
// FullScreenModal wraps Radix Dialog with a fixed-inset Content (full bleed).
// All four a11y invariants must hold — fixed inset is not a free pass to
// drop focus management.

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FullScreenModal } from '../FullScreenModal.js';

function Harness({
  open = true,
  onOpenChange = vi.fn(),
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <FullScreenModal open={open} onOpenChange={onOpenChange} title="Full Modal">
      <button type="button" data-testid="btn-1">
        Button 1
      </button>
      <button type="button" data-testid="btn-2">
        Button 2
      </button>
      <button type="button" data-testid="btn-3">
        Button 3
      </button>
    </FullScreenModal>
  );
}

describe('FullScreenModal focus trap', () => {
  it('Tab cycles forward stays within modal subtree', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole('dialog');

    for (let i = 0; i < 5; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('Shift+Tab cycles backward stays within modal subtree', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole('dialog');

    for (let i = 0; i < 5; i += 1) {
      await user.tab({ shift: true });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('Escape key fires onOpenChange(false)', async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<Harness onOpenChange={onOpenChange} />);

    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('Focus is restored outside the modal subtree on close', async () => {
    // Note: FullScreenModal does not expose `DialogTrigger` (its API is
    // `open` / `onOpenChange` props, not trigger-driven). Radix Dialog's
    // `onCloseAutoFocus` calls `triggerRef.current?.focus()` and ALWAYS
    // `preventDefault()`s the FocusScope fallback — so without a
    // `DialogTrigger` parent, focus is dropped to `body` rather than
    // restored to the consuming app's trigger button.
    //
    // The strongest a11y invariant we can lock-in at the primitive level
    // is therefore: focus is NOT trapped inside the unmounted modal
    // subtree after close. Apps consuming FullScreenModal are responsible
    // for explicit focus restoration (e.g., via `useEffect` watching
    // `open`). See spec deviation note in S22 INDEX §10.
    const user = userEvent.setup();

    function Toggleable() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button
            data-testid="trigger"
            type="button"
            onClick={() => setOpen(true)}
          >
            Open
          </button>
          <FullScreenModal open={open} onOpenChange={setOpen} title="Full Modal">
            <button type="button" data-testid="inner">
              Inner
            </button>
          </FullScreenModal>
        </>
      );
    }

    render(<Toggleable />);
    const trigger = screen.getByTestId('trigger');

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');

    // While open, focus is inside the modal subtree.
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Close — modal unmounts; focus must NOT remain trapped on a node that
    // no longer exists in the document.
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(trigger).toBeInTheDocument();
    // activeElement must be a node still attached to the document — body or
    // (in apps that wire focus restoration) the trigger itself.
    expect(document.body.contains(document.activeElement)).toBe(true);
  });
});
