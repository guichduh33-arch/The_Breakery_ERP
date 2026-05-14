import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
  SheetTrigger,
} from '../Sheet.js';

describe('Sheet', () => {
  it('renders trigger and reveals content on open', () => {
    render(
      <Sheet defaultOpen>
        <SheetTrigger>Open sheet</SheetTrigger>
        <SheetContent side="right">
          <SheetTitle>History</SheetTitle>
          <SheetDescription>Recent activity</SheetDescription>
          <SheetClose>Done</SheetClose>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.getByText('History')).toBeInTheDocument();
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
  });

  it('exposes the Radix close affordance (focus trap + ESC handled by Radix)', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="right">
          <SheetTitle>Title</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    // The default close button is aria-labelled "Close" (lucide X + sr-only).
    const closeBtn = screen.getByRole('button', { name: /close/i });
    expect(closeBtn).toBeInTheDocument();
  });

  it('does not render close button when showClose=false', () => {
    render(
      <Sheet defaultOpen>
        <SheetContent side="right" showClose={false}>
          <SheetTitle>No close</SheetTitle>
        </SheetContent>
      </Sheet>,
    );
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull();
  });

  it('closes via SheetClose child', () => {
    const onChange = (open: boolean): void => {
      // jsdom doesn't animate so the close event fires immediately.
      // We use a Tester closure pattern via a mutable ref captured in scope.
      receivedOpen = open;
    };
    let receivedOpen: boolean | undefined;
    render(
      <Sheet defaultOpen onOpenChange={onChange}>
        <SheetContent side="right">
          <SheetTitle>Trap</SheetTitle>
          <SheetClose>Confirm</SheetClose>
        </SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByText('Confirm'));
    expect(receivedOpen).toBe(false);
  });
});
