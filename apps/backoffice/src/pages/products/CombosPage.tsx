// apps/backoffice/src/pages/products/CombosPage.tsx
//
// Session 14 / Phase 4.B — Combo Management page.
// URL: /backoffice/products/combos
// Mirrors `combo management.jpg`: header + 3 KPI tiles + searchable card grid.

import { useMemo, type JSX } from 'react';
import { CombosGrid } from '@/features/combos/components/CombosGrid.js';
import { CombosHeader } from '@/features/combos/components/CombosHeader.js';
import { CombosKpiGrid } from '@/features/combos/components/CombosKpiGrid.js';
import { useCombos } from '@/features/combos/hooks/useCombos.js';
import { emptyKpis, type CombosKpis } from '@/features/combos/types.js';

export default function CombosPage(): JSX.Element {
  const combos = useCombos();
  const list = combos.data ?? [];

  const kpis: CombosKpis = useMemo(() => {
    const k = emptyKpis();
    for (const c of list) {
      k.total += 1;
      if (c.is_active) k.active += 1;
      else k.inactive += 1;
    }
    return k;
  }, [list]);

  if (combos.error !== null && combos.error !== undefined) {
    return (
      <div className="rounded-lg border border-red bg-red-soft p-4 text-sm text-red" role="alert">
        Failed to load combos: {(combos.error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CombosHeader />
      <CombosKpiGrid kpis={kpis} isLoading={combos.isLoading} />
      <CombosGrid combos={list} isLoading={combos.isLoading} />
    </div>
  );
}
