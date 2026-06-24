// apps/backoffice/src/features/reports/components/ChartCard.tsx
//
// Lightweight titled panel for a single chart. Composes INSIDE ReportPage's
// card (as a sub-panel) and standalone on the Cost & Spend dashboard. Uses the
// defined surface/border tokens (white card on the light backoffice theme).

import type { ReactNode } from 'react';

export interface ChartCardProps {
  title:     string;
  subtitle?: string;
  /** Right-aligned slot — a headline value, legend toggle, etc. */
  aside?:    ReactNode;
  /** Small accent dot before the title (the cost-family color). */
  accent?:   string;
  className?: string;
  children:  ReactNode;
}

export function ChartCard({ title, subtitle, aside, accent, className, children }: ChartCardProps) {
  return (
    <section
      className={`rounded-lg border border-border-subtle bg-surface-2 p-4 ${className ?? ''}`}
    >
      <header className="mb-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
            {accent && (
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: accent }}
                aria-hidden
              />
            )}
            <span className="truncate">{title}</span>
          </h3>
          {subtitle && <p className="mt-0.5 text-xs text-text-muted">{subtitle}</p>}
        </div>
        {aside && <div className="shrink-0 text-right">{aside}</div>}
      </header>
      {children}
    </section>
  );
}
