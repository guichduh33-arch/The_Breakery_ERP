// apps/backoffice/src/features/dashboard/components/TopProductsList.tsx
// S63 — top 5 produits du jour par revenu (liste, plus lisible qu'un graphe).

import { EmptyState } from '@breakery/ui';
import { formatIdrFull } from '@/features/reports/utils/chartColors.js';
import type { TopProduct } from '../hooks/useDashboardOverview.js';

export function TopProductsList({ data }: { data: TopProduct[] }) {
  if (data.length === 0) {
    return (
      <div className="h-40 flex items-center justify-center">
        <EmptyState size="sm" title="No sales today yet" />
      </div>
    );
  }
  return (
    <ul className="space-y-2">
      {data.map((p, i) => (
        <li key={p.product_id} className="flex items-center gap-3 text-sm">
          <span className="w-5 text-text-muted tabular-nums">{i + 1}.</span>
          <span className="flex-1 truncate text-text-primary">{p.name}</span>
          <span className="text-text-muted tabular-nums">×{p.qty}</span>
          <span className="text-text-primary tabular-nums">{formatIdrFull(p.revenue)}</span>
        </li>
      ))}
    </ul>
  );
}
