import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

const SR_ONLY =
  'absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0';

export interface FullScreenModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  className?: string;
  /**
   * Screen-reader title. Radix DialogContent requires a Title for a11y;
   * we render it visually-hidden by default so callers can keep their own
   * visible header. Override per modal for clearer SR output. Defaults to
   * "Modal" — fine to silence the Radix warning, less great for SR users.
   */
  title?: string;
  /**
   * Screen-reader description. Optional. When omitted we set
   * aria-describedby={undefined} on the Content so Radix doesn't warn
   * about a missing Description.
   */
  description?: string;
}

export function FullScreenModal({
  open,
  onOpenChange,
  children,
  className,
  title = 'Modal',
  description,
}: FullScreenModalProps): JSX.Element {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-backdrop backdrop-blur-md z-50 motion-reduce:animate-none motion-reduce:transition-none"
        />
        <DialogPrimitive.Content
          // When no description child is rendered, explicitly pass
          // aria-describedby={undefined} so Radix doesn't warn. Spread to
          // preserve auto-linking when a Description child IS present.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-0 bg-bg-base text-text-primary z-50 flex flex-col focus:outline-none',
            'motion-reduce:animate-none motion-reduce:transition-none motion-reduce:duration-0',
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

export const FullScreenModalClose = DialogPrimitive.Close;
