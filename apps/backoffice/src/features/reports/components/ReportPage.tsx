// apps/backoffice/src/features/reports/components/ReportPage.tsx
//
// Layout wrapper shared by every report page : title, optional date filter
// row, and a card-wrapped content area. Pure presentational.

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle, EmptyState } from '@breakery/ui';
import type { EmptyStateProps } from '@breakery/ui';

export interface ReportPageProps {
  title:    string;
  subtitle?: string;
  filters?: ReactNode;
  children: ReactNode;
  /**
   * When true AND `emptyState` is provided, the card body renders the canonical
   * `<EmptyState>` primitive instead of `children`. Pages compute this as
   * "loaded, no error, zero rows" so the muted `<td>No data</td>` row is gone.
   * D-D1 (S57) — single decision point shared by all `pages/reports/*`.
   */
  isEmpty?: boolean;
  /** Props forwarded to `<EmptyState>` when `isEmpty` is true. */
  emptyState?: EmptyStateProps;
}

export function ReportPage({
  title,
  subtitle,
  filters,
  children,
  isEmpty,
  emptyState,
}: ReportPageProps) {
  const showEmpty = isEmpty === true && emptyState !== undefined;
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif">{title}</h1>
          {subtitle && (
            <p className="text-sm text-text-secondary">{subtitle}</p>
          )}
        </div>
        {filters && <div className="flex items-center gap-2">{filters}</div>}
      </div>
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-widest text-text-secondary">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {showEmpty ? <EmptyState size="sm" {...emptyState} /> : children}
        </CardContent>
      </Card>
    </div>
  );
}
