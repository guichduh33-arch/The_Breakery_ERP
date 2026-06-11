// apps/backoffice/src/features/catalog-import/components/ImportSummaryCards.tsx
// S41 — displays a summary grid from import_catalog_v1 report.
// Shape: {categories:{create,update}, ingredients:{…}, products:{…},
//         units:{replace_products}, variants:{create,update},
//         recipes:{products_replaced}}

import type { JSX } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import type { ImportReport } from '../hooks/useImportCatalog.js';

interface Props {
  summary: ImportReport['summary'];
}

interface SectionMeta {
  label: string;
  key: string;
}

const SECTIONS: SectionMeta[] = [
  { label: 'Categories',   key: 'categories'   },
  { label: 'Ingredients',  key: 'ingredients'  },
  { label: 'Products',     key: 'products'     },
  { label: 'Units',        key: 'units'        },
  { label: 'Variants',     key: 'variants'     },
  { label: 'Recipes',      key: 'recipes'      },
];

function statLabel(metricKey: string): string {
  if (metricKey === 'replace_products') return 'Products with replaced units';
  if (metricKey === 'products_replaced') return 'Products with replaced BOM';
  return metricKey.charAt(0).toUpperCase() + metricKey.slice(1);
}

export function ImportSummaryCards({ summary }: Props): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {SECTIONS.map(({ label, key }) => {
        const section = summary[key];
        if (section === undefined) return null;
        return (
          <Card key={key} className="p-0">
            <CardHeader className="pb-1 pt-3 px-4">
              <CardTitle className="text-xs font-semibold uppercase tracking-widest text-text-muted">
                {label}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-3 pt-0">
              {Object.entries(section).map(([metricKey, count]) => (
                <div key={metricKey} className="flex items-center justify-between gap-2 text-sm">
                  <span className="text-text-secondary">{statLabel(metricKey)}</span>
                  <span
                    className={count > 0 ? 'font-semibold text-text-primary' : 'text-text-muted'}
                  >
                    {count}
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
