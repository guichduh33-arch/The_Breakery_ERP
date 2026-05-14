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
// dismiss, and aria-modal are wired for free. A visually-hidden DialogTitle
// is rendered by default (override via the `title` prop) so Radix's a11y
// requirement is satisfied without forcing every caller to wire it manually.

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

const SR_ONLY =
  'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

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
  /**
   * Screen-reader title. Radix DialogContent requires a Title for a11y;
   * we render it visually-hidden by default so callers can keep their own
   * visible header. Override per modal for clearer SR output.
   */
  title?: string;
  /**
   * Screen-reader description. Optional. When omitted we set
   * aria-describedby={undefined} on the Content so Radix doesn't warn.
   */
  description?: string;
}

export function CenterModal({
  open,
  onOpenChange,
  children,
  className,
  modal = true,
  'data-testid': testId,
  title = 'Modal',
  description,
}: CenterModalProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-backdrop backdrop-blur-md motion-reduce:animate-none motion-reduce:transition-none" />
        <DialogPrimitive.Content
          data-testid={testId}
          // Spread to preserve Radix auto-linking when a Description child IS
          // rendered; explicit undefined silences the warning when not.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50',
            'w-[min(560px,90vw)] max-h-[85vh] flex flex-col',
            'rounded-xl border border-border-subtle bg-bg-elevated shadow-modal',
            'focus:outline-none',
            'motion-reduce:animate-none motion-reduce:transition-none',
            className,
          )}
        >
          <DialogPrimitive.Title className={SR_ONLY}>{title}</DialogPrimitive.Title>
          {description && (
            <DialogPrimitive.Description className={SR_ONLY}>
              {description}
            </DialogPrimitive.Description>
          )}
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
