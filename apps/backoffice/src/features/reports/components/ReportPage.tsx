// apps/backoffice/src/features/reports/components/ReportPage.tsx
//
// Layout wrapper shared by every report page : title, optional date filter
// row, and a card-wrapped content area. Pure presentational.

import type { ReactNode } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';

export interface ReportPageProps {
  title:    string;
  subtitle?: string;
  filters?: ReactNode;
  children: ReactNode;
}

export function ReportPage({ title, subtitle, filters, children }: ReportPageProps) {
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
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}
