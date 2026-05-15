// apps/backoffice/src/features/combos/components/CombosKpiGrid.tsx
//
// Session 14 / Phase 4.B — 3-up KPI strip on the Combo Management page.

import { AlertCircle, Box, CheckCircle2 } from 'lucide-react';
import type { JSX } from 'react';
import { KpiTile } from '@breakery/ui';
import type { CombosKpis } from '../types.js';

interface Props {
  kpis: CombosKpis;
  isLoading?: boolean;
}

export function CombosKpiGrid({ kpis, isLoading = false }: Props): JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <KpiTile
        label="Total Combos"
        value={isLoading ? '—' : kpis.total}
        valueFormat="number"
        icon={Box}
      />
      <KpiTile
        label="Active Sets"
        value={isLoading ? '—' : kpis.active}
        valueFormat="number"
        icon={CheckCircle2}
      />
      <KpiTile
        label="Inactive"
        value={isLoading ? '—' : kpis.inactive}
        valueFormat="number"
        icon={AlertCircle}
      />
    </div>
  );
}
