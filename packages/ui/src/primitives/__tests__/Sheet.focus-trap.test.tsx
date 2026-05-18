// packages/ui/src/primitives/__tests__/Sheet.focus-trap.test.tsx
//
// Session 22 — Phase 1.A.1 — Focus-trap regression lock-in (Sheet variant).
//
// Sheet is a side-mounted Radix Dialog, so all four a11y invariants hold
// identically — the visual presentation (slide-from-edge) does not change
// focus-trap semantics. See Dialog.focus-trap.test.tsx for the canonical
// pattern.

import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Sheet,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from '../Sheet.js';

function Harness({
  onOpenChange = (): void => {},
}: {
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Sheet defaultOpen onOpenChange={onOpenChange}>
      <SheetContent side="right" aria-describedby={undefined}>
        <SheetTitle>Test Sheet</SheetTitle>
        <button type="button" data-testid="btn-1">
          Button 1
        </button>
        <button type="button" data-testid="btn-2">
          Button 2
        </button>
        <button type="button" data-testid="btn-3">
          Button 3
        </button>
      </SheetContent>
    </Sheet>
  );
}

describe('Sheet focus trap', () => {
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

  it('Focus returns to trigger on close', async () => {
    const user = userEvent.setup();

    function Toggleable() {
      const [open, setOpen] = useState(false);
      return (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger data-testid="trigger">Open</SheetTrigger>
          <SheetContent side="right" aria-describedby={undefined}>
            <SheetTitle>Test Sheet</SheetTitle>
            <button type="button" data-testid="inner">
              Inner
            </button>
          </SheetContent>
        </Sheet>
      );
    }

    render(<Toggleable />);

    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    await user.click(trigger);
    await screen.findByRole('dialog');

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
  });
});
