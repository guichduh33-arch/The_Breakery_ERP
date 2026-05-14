// packages/ui/src/components/CenterModal.tsx
//
// Session 14 — Phase 2.D — Centered modal primitive.
//
// Sibling of FullScreenModal but for compact, centered dialogs (live sessions,
// stock categories toggles, etc.). Unlike the canonical DialogContent in the
// Dialog primitive, CenterModal does NOT inject a built-in close button — the
// caller is expected to render its own header with a close action so it can
// match the screenshot chrome exactly.
//
// Accessibility: relies on Radix Dialog under the hood, so focus trap, ESC
// dismiss, and aria-modal are wired for free. Title + Description should be
// rendered as children via the DialogTitle / DialogDescription components.

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface CenterModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  /** Tailwind width class — defaults to `w-[min(560px,90vw)]`. */
  className?: string;
  /** When true, the overlay click + ESC do NOT close the modal. */
  modal?: boolean;
  /** Test ID forwarded to the Content element. */
  'data-testid'?: string;
}

export function CenterModal({
  open,
  onOpenChange,
  children,
  className,
  modal = true,
  'data-testid': testId,
}: CenterModalProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-backdrop backdrop-blur-md motion-reduce:animate-none motion-reduce:transition-none" />
        <DialogPrimitive.Content
          data-testid={testId}
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[min(560px,90vw)] max-h-[85vh] flex flex-col',
            'rounded-xl border border-border-subtle bg-bg-elevated shadow-modal',
            'focus:outline-none',
            'motion-reduce:animate-none motion-reduce:transition-none',
            className,
          )}
        >
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
