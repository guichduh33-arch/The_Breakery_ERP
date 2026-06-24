// apps/backoffice/src/features/data-import/components/EntitySummaryGrid.tsx
// Generic summary grid: one card per top-level summary key, one row per metric.
import type { JSX } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import type { ImportReport } from '../entityImportDef.js';

function metricLabel(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function EntitySummaryGrid({ summary }: { summary: ImportReport['summary'] }): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="entity-summary-grid">
      {Object.entries(summary).map(([section, metrics]) => (
        <Card key={section} className="p-0">
          <CardHeader className="pb-1 pt-3 px-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-widest text-text-muted">
              {section}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3 pt-0">
            {Object.entries(metrics).map(([metricKey, count]) => (
              <div key={metricKey} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-text-secondary">{metricLabel(metricKey)}</span>
                <span className={count > 0 ? 'font-semibold text-text-primary' : 'text-text-muted'}>
                  {count}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
