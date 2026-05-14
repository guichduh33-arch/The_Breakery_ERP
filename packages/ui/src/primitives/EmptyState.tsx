// packages/ui/src/primitives/EmptyState.tsx
//
// EmptyState — canonical empty-data placeholder. Used wherever a list, table,
// or feed has no rows to display. Centralizes copy + iconography conventions.
//
// Session 13 (Phase 1.D / ui-steward batch 1) — TASK-22-002.

import type { JSX, ReactNode } from 'react';
import { cn } from '../lib/cn.js';

export interface EmptyStateProps {
  /** Optional icon element rendered above the title (e.g. lucide icon). */
  icon?: ReactNode;
  /** Short headline, e.g. "No transfers yet". */
  title: string;
  /** Optional explanatory paragraph. */
  description?: string;
  /** Optional CTA (typically a Button). */
  action?: ReactNode;
  className?: string;
  /** Test ID propagated to the outer element. */
  'data-testid'?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  'data-testid': testId,
}: EmptyStateProps): JSX.Element {
  return (
    <div
      role="status"
      data-testid={testId}
      className={cn(
        'flex flex-col items-center justify-center gap-3 px-6 py-12 text-center',
        className,
      )}
    >
      {icon !== undefined && (
        <div aria-hidden="true" className="text-text-muted">
          {icon}
        </div>
      )}
      <h3 className="font-serif text-lg font-semibold text-text-primary">{title}</h3>
      {description !== undefined && (
        <p className="max-w-prose text-sm text-text-secondary">{description}</p>
      )}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
