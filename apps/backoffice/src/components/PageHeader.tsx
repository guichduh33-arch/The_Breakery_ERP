// apps/backoffice/src/components/PageHeader.tsx
//
// Shared backoffice page header — the single source of truth for the
// "serif title + muted subtitle + right-aligned actions" band that every
// BO page reinvented on its own (design audit 2026-07-07, finding I3-I5).
//
// Canonical style: `font-serif text-2xl` title (the token-calibrated ivoire
// heading) + `text-sm text-text-secondary` subtitle. Actions bottom-align
// with the title band (`items-end`) so date pickers / export buttons sit on
// the same baseline. Pure presentational — no business logic.

import type { ReactNode } from 'react';
import { cn } from '@breakery/ui';

export interface PageHeaderProps {
  /** Page title, rendered as the single `<h1>` for the view. */
  title: string;
  /** Optional supporting line under the title. String or arbitrary node. */
  subtitle?: ReactNode;
  /** Optional right-aligned slot: filters, export buttons, status chips… */
  actions?: ReactNode;
  /** Extra classes on the outer flex row (e.g. `items-start`). */
  className?: string;
  /** Extra classes on the `<h1>` (e.g. `text-3xl` for a hero page). */
  titleClassName?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  titleClassName,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className={cn('font-serif text-2xl text-text-primary', titleClassName)}>
          {title}
        </h1>
        {subtitle != null &&
          (typeof subtitle === 'string' ? (
            <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
          ) : (
            <div className="mt-1 text-sm text-text-secondary">{subtitle}</div>
          ))}
      </div>
      {actions != null && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
