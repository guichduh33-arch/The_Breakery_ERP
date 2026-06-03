/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { VirtualKeypadProvider } from '@breakery/ui';
import { CustomerAttachModal } from '../CustomerAttachModal';

// Harness note (E3 deviation): CustomerAttachModal requires `searchFn`/`onSelect`
// props to render — we pass inert stubs. The modal opens on the "search" tab by
// default and renders its `aria-label="Search customer"` <Input data-vkp="qwerty">.
//
// The VKP overlay is rendered inline by the provider, OUTSIDE the Radix modal
// Dialog's portal. Radix `DialogContent` (modal) sets `aria-hidden="true"` on all
// other body subtrees, so the overlay's "q" key is technically aria-hidden while
// the customer modal is open — `screen.getByRole('button', { name: 'q' })` would
// not see it. We therefore scope the assertion to the rendered overlay node
// directly (presence of the QWERTY "q" key), which still proves the intent:
// focusing the real modal's search field opens the QWERTY on-screen keyboard.

describe('CustomerAttachModal + VKP', () => {
  it('focusing the search input opens the QWERTY overlay', () => {
    render(
      <VirtualKeypadProvider>
        <CustomerAttachModal
          open
          onClose={() => {}}
          onSelect={() => {}}
          searchFn={async () => []}
        />
      </VirtualKeypadProvider>,
    );

    const input = screen.getByLabelText(/search customer/i);
    expect(input).toHaveAttribute('data-vkp', 'qwerty');

    fireEvent.focus(input);

    const overlay = document.querySelector<HTMLElement>(
      '[aria-label="Virtual keyboard"]',
    );
    expect(overlay).not.toBeNull();
    // The QWERTY layout renders one button per key; "q" proves it's the qwerty layout.
    expect(
      within(overlay as HTMLElement).getByText('q', { selector: 'button' }),
    ).toBeInTheDocument();
  });
});
