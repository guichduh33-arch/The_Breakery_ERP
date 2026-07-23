// packages/ui/src/primitives/__tests__/Dialog.focus-trap.test.tsx
//
// Session 22 — Phase 1.A.1 — Focus-trap regression lock-in.
//
// Asserts the four invariants a Radix-backed modal MUST uphold:
//   1. Tab forward stays within the modal subtree.
//   2. Shift+Tab backward stays within the modal subtree.
//   3. Escape fires onOpenChange(false).
//   4. Closing the modal restores focus to the trigger.
//
// Pairs with the ESLint custom rule `no-raw-modal-overlay` (phase 1.A.2)
// to prevent regressions where someone bypasses these primitives with a
// raw `<div className="fixed inset-0">` overlay.

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '../Dialog.js';

function Harness({
  onOpenChange = (): void => { /* noop */ },
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog defaultOpen onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>Test Dialog</DialogTitle>
        <button type="button" data-testid="btn-1">
          Button 1
        </button>
        <button type="button" data-testid="btn-2">
          Button 2
        </button>
        <button type="button" data-testid="btn-3">
          Button 3
        </button>
      </DialogContent>
    </Dialog>
  );
}

describe('Dialog focus trap', () => {
  it('Tab cycles forward stays within modal subtree', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const dialog = await screen.findByRole('dialog');

    // Cycle 5 times — enough to wrap past all 4 focusables (3 buttons + close).
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

  it('Focus returns to trigger on close', async () => {
    const user = userEvent.setup();

    function Toggleable() {
      const [open, setOpen] = useState(false);
      return (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger data-testid="trigger">Open</DialogTrigger>
          <DialogContent aria-describedby={undefined}>
            <DialogTitle>Test Dialog</DialogTitle>
            <button type="button" data-testid="inner">
              Inner
            </button>
          </DialogContent>
        </Dialog>
      );
    }

    render(<Toggleable />);

    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    // Open via the trigger so Radix tracks it as the "returnFocus" element.
    await user.click(trigger);
    await screen.findByRole('dialog');

    // Close via ESC — Radix should restore focus to the trigger asynchronously
    // (rAF/microtask boundary inside FocusScope). waitFor polls until the
    // restoration lands.
    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
