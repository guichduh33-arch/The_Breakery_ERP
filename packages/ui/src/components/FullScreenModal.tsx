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
   * Accessible dialog title (Session 43 P2-4). Radix DialogContent requires
   * a Title for a11y; we render it visually-hidden so callers can keep their
   * own visible header. Always rendered FIRST inside the Content, so it wins
   * as the accessible name even when a consumer also renders its own
   * `DialogPrimitive.Title` in children (duplicate titles are harmless to
   * Radix — the first in DOM resolves the aria-labelledby reference).
   * Defaults to "Dialog" — fine to silence the Radix warning, less great
   * for SR users, so pass a real title per modal.
   */
  accessibleTitle?: string;
  /**
   * Legacy alias for `accessibleTitle` (pre-S43 call-sites). Ignored when
   * `accessibleTitle` is provided.
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
  accessibleTitle,
  title,
  description,
}: FullScreenModalProps): JSX.Element {
  const resolvedTitle = accessibleTitle ?? title ?? 'Dialog';
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        {/* No backdrop-blur here: the Content below is opaque and covers the
            full viewport, so a full-screen backdrop-filter is pure GPU cost
            with zero visible effect (audit 2026-08-24 P1). CenterModal keeps
            its blur — there the backdrop is actually visible. */}
        <DialogPrimitive.Overlay
          className="fixed inset-0 bg-backdrop z-50 motion-reduce:animate-none motion-reduce:transition-none"
        />
        <DialogPrimitive.Content
          // Radix DialogContent does NOT set aria-modal (verified in the
          // bundle, re-audit 2026-08-24) — without it, screen readers keep
          // the page behind the payment terminal in the reading order.
          aria-modal="true"
          // When no description child is rendered, explicitly pass
          // aria-describedby={undefined} so Radix doesn't warn. Spread to
          // preserve auto-linking when a Description child IS present.
          {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(
            'fixed inset-0 bg-bg-base text-text-primary z-50 flex flex-col focus:outline-none',
            // pb-safe-bottom : sur l'APK Capacitor le pied de modale (Process
            // Payment) passait sous la barre gestuelle Android ; vaut 0 sur
            // desktop (fallback env()).
            'pb-safe-bottom',
            'motion-reduce:animate-none motion-reduce:transition-none motion-reduce:duration-0',
            className,
          )}
        >
          {/* asChild → span : Radix renders Title as <h2> by default, which
              would duplicate consumers' visible <h2> in the heading tree
              (S43 review follow-up). A span still resolves aria-labelledby. */}
          <DialogPrimitive.Title asChild>
            <span className={SR_ONLY}>{resolvedTitle}</span>
          </DialogPrimitive.Title>
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
