// apps/backoffice/src/features/products/components/ProductsKpiGrid.tsx
//
// Session 14 / Phase 4.B — 4-up KPI grid (TOTAL / FINISHED / SEMI-FINISHED /
// RAW MATERIALS) shown on the Products page above the catalog table.

import { Box, ChefHat, Coffee, Package, type LucideIcon } from 'lucide-react';
import type { JSX } from 'react';
import { KpiTile } from '@breakery/ui';
import type { ProductsKpis } from '../types.js';

interface Props {
  kpis: ProductsKpis;
  isLoading?: boolean;
}

interface Tile {
  label: string;
  value: number;
  icon:  LucideIcon;
}

export function ProductsKpiGrid({ kpis, isLoading = false }: Props): JSX.Element {
  const tiles: Tile[] = [
    { label: 'All Products',   value: kpis.total,         icon: Box     },
    { label: 'Finished',       value: kpis.finished,      icon: Coffee  },
    { label: 'Semi-Finished',  value: kpis.semi_finished, icon: ChefHat },
    { label: 'Raw Materials',  value: kpis.raw_material,  icon: Package },
  ];
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {tiles.map((t) => (
        <KpiTile
          key={t.label}
          label={t.label}
          value={isLoading ? '—' : t.value}
          valueFormat="number"
          icon={t.icon}
        />
      ))}
    </div>
  );
}
