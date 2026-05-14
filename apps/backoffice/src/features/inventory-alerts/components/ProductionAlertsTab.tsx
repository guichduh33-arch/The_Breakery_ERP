// apps/backoffice/src/features/inventory-alerts/components/ProductionAlertsTab.tsx
// Session 13 / Phase 2.D — Production alerts tab.
//
// This is a thin reader of get_production_suggestions_v1 (Phase 2.A
// migration 000065). The RPC may not exist if Phase 2.A is not yet
// merged ; we degrade gracefully to a placeholder.

import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/lib/supabase.js';

interface ProductionSuggestion {
  product_id:         string;
  product_sku:        string;
  product_name:       string;
  current_stock:      number;
  avg_daily_sales:    number;
  days_of_stock:      number | null;
  suggested_quantity: number;
  priority:           string;
}

type RpcFn = (
  fn: string, args?: Record<string, unknown>
) => Promise<{ data: ProductionSuggestion[] | null; error: { message: string } | null }>;

export function ProductionAlertsTab() {
  const q = useQuery<ProductionSuggestion[]>({
    queryKey: ['production-suggestions'] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const rpc = supabase.rpc as unknown as RpcFn;
      const { data, error } = await rpc('get_production_suggestions_v1', {});
      if (error !== null) {
        // RPC may not exist yet (Phase 2.A not merged) — treat as empty.
        if (/does not exist|undefined function/i.test(error.message)) return [];
        throw new Error(error.message);
      }
      return data ?? [];
    },
    retry: false,
  });

  if (q.isLoading) return <div className="text-sm text-text-secondary">Loading…</div>;

  const rows = q.data ?? [];
  if (rows.length === 0) {
    return (
      <div className="text-sm text-text-secondary py-4">
        No production suggestions. Either nothing needs production today, or
        the production module (Phase 2.A) is not yet deployed.
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="text-xs uppercase text-text-secondary border-b border-border-subtle">
        <tr>
          <th className="text-left py-2 px-3">Product</th>
          <th className="text-right py-2 px-3">Current</th>
          <th className="text-right py-2 px-3">Avg daily sales</th>
          <th className="text-right py-2 px-3">Days left</th>
          <th className="text-right py-2 px-3">Produce</th>
          <th className="text-left py-2 px-3">Priority</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.product_id} className="border-b border-border-subtle">
            <td className="py-2 px-3">
              <Link
                to={`/backoffice/products/${r.product_id}/dashboard`}
                className="text-gold hover:underline"
              >
                {r.product_name}
              </Link>
              <div className="text-xs text-text-secondary">{r.product_sku}</div>
            </td>
            <td className="py-2 px-3 text-right font-mono">{Number(r.current_stock)}</td>
            <td className="py-2 px-3 text-right font-mono">{Number(r.avg_daily_sales).toFixed(2)}</td>
            <td className="py-2 px-3 text-right font-mono">{r.days_of_stock === null ? '—' : Number(r.days_of_stock).toFixed(1)}</td>
            <td className="py-2 px-3 text-right font-mono font-medium">{Number(r.suggested_quantity).toFixed(2)}</td>
            <td className="py-2 px-3">
              <span className={`text-xs font-medium ${r.priority === 'high' ? 'text-rose-600' : r.priority === 'medium' ? 'text-amber-600' : 'text-text-secondary'}`}>
                {r.priority}
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
