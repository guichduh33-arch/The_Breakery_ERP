// packages/ui/src/components/SkipToContent.tsx
//
// SkipToContent — visually-hidden anchor that becomes visible on focus.
// First keyboard Tab on any page jumps focus here, letting screen-reader and
// keyboard users skip nav chrome.
//
// Session 13 (Phase 1.D / ui-steward batch 1) — TASK-22-005.
//
// Usage:
//   render(<SkipToContent />, ...) // first child inside <App>
//   ...
//   <main id="main-content"> … </main>

import type { JSX } from 'react';
import { cn } from '../lib/cn.js';

export interface SkipToContentProps {
  /** Anchor target. Defaults to `#main-content`. */
  href?: string;
  /** Visible label. */
  label?: string;
  className?: string;
  'data-testid'?: string;
}

export function SkipToContent({
  href = '#main-content',
  label = 'Skip to main content',
  className,
  'data-testid': testId = 'skip-to-content',
}: SkipToContentProps): JSX.Element {
  return (
    <a
      href={href}
      data-testid={testId}
      className={cn(
        // Visually hidden by default, fully visible when focused.
        'sr-only focus:not-sr-only',
        'focus:fixed focus:top-2 focus:left-2 focus:z-[100]',
        'focus:rounded-md focus:bg-gold focus:px-4 focus:py-2',
        'focus:text-bg-base focus:font-semibold',
        'focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-gold',
        className,
      )}
    >
      {label}
    </a>
  );
}
