// apps/backoffice/src/features/reports/components/ReportPage.tsx
//
// Layout wrapper shared by every report page : title, optional date filter
// row, and a card-wrapped content area. Pure presentational.

import type { ReactNode } from 'react';
import { Card, CardContent, EmptyState } from '@breakery/ui';
import type { EmptyStateProps } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';

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
      <PageHeader title={title} subtitle={subtitle} actions={filters} />
      <Card>
        <CardContent className="pt-6">
          {showEmpty ? <EmptyState size="sm" {...emptyState} /> : children}
        </CardContent>
      </Card>
    </div>
  );
}
