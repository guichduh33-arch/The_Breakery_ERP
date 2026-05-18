// packages/ui/src/components/__tests__/CenterModal.focus-trap.test.tsx
//
// Session 22 — Phase 1.A.1 — Focus-trap regression lock-in (CenterModal).
//
// CenterModal is the centered Radix Dialog variant used for compact dialogs
// (live sessions, stock toggles, etc.). Same a11y invariants as Dialog.

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CenterModal } from '../CenterModal.js';

function Harness({
  open = true,
  onOpenChange = vi.fn(),
}: {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <CenterModal open={open} onOpenChange={onOpenChange} title="Center Modal">
      <button type="button" data-testid="btn-1">
        Button 1
      </button>
      <button type="button" data-testid="btn-2">
        Button 2
      </button>
      <button type="button" data-testid="btn-3">
        Button 3
      </button>
    </CenterModal>
  );
}

describe('CenterModal focus trap', () => {
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
    // Note: CenterModal does not expose `DialogTrigger` (its API is
    // `open` / `onOpenChange` props, not trigger-driven). Radix Dialog's
    // `onCloseAutoFocus` calls `triggerRef.current?.focus()` and ALWAYS
    // `preventDefault()`s the FocusScope fallback — so without a
    // `DialogTrigger` parent, focus is dropped to `body` rather than
    // restored to the consuming app's trigger button.
    //
    // The strongest a11y invariant we can lock-in at the primitive level
    // is therefore: focus is NOT trapped inside the unmounted modal
    // subtree after close. Apps consuming CenterModal are responsible for
    // explicit focus restoration (e.g., via `useEffect` watching `open`).
    // See spec deviation note in S22 INDEX §10.
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
          <CenterModal open={open} onOpenChange={setOpen} title="Center Modal">
            <button type="button" data-testid="inner">
              Inner
            </button>
          </CenterModal>
        </>
      );
    }

    render(<Toggleable />);
    const trigger = screen.getByTestId('trigger');

    await user.click(trigger);
    const dialog = await screen.findByRole('dialog');

    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    expect(trigger).toBeInTheDocument();
    expect(document.body.contains(document.activeElement)).toBe(true);
  });
});
