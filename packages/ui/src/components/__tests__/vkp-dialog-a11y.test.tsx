// packages/ui/src/components/__tests__/vkp-dialog-a11y.test.tsx
//
// DEV-S35-E3-01 — when the virtual keypad opens from an input INSIDE a Radix
// Dialog, the overlay must not be hidden from screen readers. Radix applies
// aria-hidden to everything OUTSIDE the open dialog, so an overlay rendered at
// the provider root (a dialog sibling) inherits aria-hidden. The fix portals
// the overlay INTO the active [role="dialog"] node, making it a descendant that
// Radix's aria-hidden cannot reach.
//
// We assert the structural invariant (overlay is contained by the dialog node)
// rather than the literal aria-hidden attribute: jsdom does not run Radix's
// aria-hidden side-effects, so containment is the real, testable guarantee
// (DEV-S36-C-02).

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { VirtualKeypadProvider } from '../VirtualKeypadProvider.js';

describe('VKP a11y inside a Radix Dialog (DEV-S35-E3-01)', () => {
  it('portals the keypad overlay INTO the active dialog', () => {
    render(
      <VirtualKeypadProvider>
        <div role="dialog" data-testid="dlg">
          <input aria-label="reason" data-vkp="qwerty" />
        </div>
      </VirtualKeypadProvider>,
    );
    fireEvent.focus(screen.getByLabelText('reason'));

    const overlay = screen.getByTestId('vkp-overlay');
    const dialog = screen.getByTestId('dlg');
    // Descendant of the dialog → outside the reach of Radix's aria-hidden.
    expect(dialog.contains(overlay)).toBe(true);
    expect(overlay.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('still renders the overlay inline when not inside a dialog (no regression)', () => {
    render(
      <VirtualKeypadProvider>
        <input aria-label="name" data-vkp="qwerty" />
      </VirtualKeypadProvider>,
    );
    fireEvent.focus(screen.getByLabelText('name'));

    expect(screen.getByTestId('vkp-overlay')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'q' })).toBeInTheDocument();
  });
});
