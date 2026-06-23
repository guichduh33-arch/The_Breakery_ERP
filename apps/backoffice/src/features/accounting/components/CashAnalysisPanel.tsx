// apps/backoffice/src/features/accounting/components/CashAnalysisPanel.tsx
// Cash Wallets module — "Private Analysis" replica panel.
// Calls get_cash_wallet_analysis_v1(p_date_start, p_date_end) and renders:
//   • Top Petty Cash spend categories
//   • Movements summary: bank deposits + boss withdrawals totals
import { useQuery } from '@tanstack/react-query';
import { Card } from '@breakery/ui';
import { supabase } from '@/lib/supabase.js';

const idr = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

interface Analysis {
  revenue_by_shift:        { d: string; shift: string; total: number }[];
  top_petty_categories:    { category: string; total: number; occurrences: number }[];
  deposits_total:          number;
  boss_withdrawals_total:  number;
}

export function CashAnalysisPanel({ start, end }: { start: string; end: string }) {
  const { data } = useQuery<Analysis>({
    queryKey: ['accounting', 'cash-analysis', start, end],
    staleTime: 60_000,
    queryFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('get_cash_wallet_analysis_v1' as any, {
        p_date_start: start,
        p_date_end:   end,
      });
      if (error !== null) throw new Error(error.message);
      return data as Analysis;
    },
  });

  if (!data || !Array.isArray(data.top_petty_categories)) return null;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="p-4">
        <h3 className="font-medium mb-2">Top Petty Cash categories</h3>
        {data.top_petty_categories.length === 0 ? (
          <p className="text-sm text-muted-foreground">No petty-cash expenses in this period.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {data.top_petty_categories.map((c) => (
              <li key={c.category} className="flex justify-between">
                <span>
                  {c.category}{' '}
                  <span className="text-muted-foreground">×{c.occurrences}</span>
                </span>
                <span className="tabular-nums">{idr.format(c.total)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="p-4 space-y-2">
        <h3 className="font-medium mb-2">Movements summary</h3>
        <div className="flex justify-between text-sm">
          <span>Bank deposits</span>
          <span className="tabular-nums">{idr.format(data.deposits_total)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span>Boss withdrawals</span>
          <span className="tabular-nums">{idr.format(data.boss_withdrawals_total)}</span>
        </div>
      </Card>
    </div>
  );
}
