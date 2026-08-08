// apps/backoffice/src/features/dashboard/components/RevenueShareCard.tsx
//
// Écran 1c — d'où vient le revenu du jour, et par quel moyen il a été encaissé.
//
// Remplace le donut « revenue by order type ». À quatre parts, un donut coûte
// une carte entière pour une information qu'une barre de 10 px rend mieux :
// l'œil compare des longueurs, pas des angles. La place gagnée porte le second
// bloc — les encaissements — qui n'avait nulle part où vivre.
//
// La dernière ligne, « cash expected in drawer », reprend la formule EXACTE de
// la clôture de service (opening + cash_sales + in − out). C'est délibéré : ce
// chiffre est comparé au comptage physique du soir, et deux définitions du même
// montant se liraient comme une erreur de caisse.

import type { JSX } from 'react';
import { DashboardCard } from './DashboardCard.js';
import { formatIdr, formatIdrShort, formatPct, orderTypeLabel, paymentMethodLabel } from '../utils/format.js';
import { familyBase, familyColor } from '@/features/reports/utils/chartColors.js';
import type { PaymentsBlock, RevenueShare } from '../hooks/useDashboardOverview.js';

// Rampe des types de commande. On prend des crans ESPACÉS de la rampe COGS
// (0, 2, 4, 7) plutôt que consécutifs : à quatre segments collés, deux bleus
// voisins de la rampe ne se distinguent plus. Le B2B sort de la rampe et prend
// l'ambre — ce n'est pas de la vente au comptoir, et le distinguer d'un coup
// d'œil est justement l'intérêt de la barre.
const RETAIL_STEPS = [0, 2, 4, 7] as const;

function shareColor(type: string, retailRank: number): string {
  if (type === 'b2b') return familyBase('opex');
  return familyColor('cogs', RETAIL_STEPS[retailRank % RETAIL_STEPS.length] ?? 0);
}

export function RevenueShareCard({
  share, payments, isLoading, error,
}: {
  share: RevenueShare[];
  payments: PaymentsBlock | null;
  isLoading: boolean;
  error: Error | null;
}): JSX.Element {
  let retailRank = 0;
  const segments = share.map((s) => ({
    ...s,
    color: shareColor(s.order_type, s.order_type === 'b2b' ? 0 : retailRank++),
  }));

  return (
    <DashboardCard
      title="Share of revenue"
      isLoading={isLoading}
      error={error}
      testId="card-revenue-share"
    >
      {segments.length === 0 ? (
        <p className="py-2 text-[12.5px] text-text-muted">No sale recorded today.</p>
      ) : (
        <>
          <div className="flex h-2.5 overflow-hidden rounded-[5px] bg-surface-4" role="img" aria-label="Revenue share by order type">
            {segments.map((s) => (
              <div key={s.order_type} style={{ width: `${s.share_pct ?? 0}%`, background: s.color }} />
            ))}
          </div>
          <ul className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1">
            {segments.map((s) => (
              <li key={s.order_type} className="flex items-center gap-1.5 text-[11.5px] text-text-secondary">
                <span className="h-2 w-2 rounded-[2px]" style={{ background: s.color }} aria-hidden />
                {orderTypeLabel(s.order_type)}
                <span className="font-data tabular-nums text-text-muted">{formatPct(s.share_pct)}</span>
              </li>
            ))}
          </ul>
        </>
      )}

      {payments !== null && (
        <>
          <div className="my-3 h-px bg-border-muted" />
          <p className="font-data text-[11px] font-semibold uppercase tracking-widest text-text-primary">
            Payments collected
          </p>
          {payments.lines.length === 0 ? (
            <p className="mt-2 text-[12.5px] text-text-muted">No payment collected yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {payments.lines.map((p) => (
                <li key={p.method} className="flex items-baseline gap-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate text-text-primary">{paymentMethodLabel(p.method)}</span>
                  <span className="shrink-0 font-data tabular-nums text-text-muted">{formatPct(p.share_pct)}</span>
                  <span className="shrink-0 font-data tabular-nums text-text-primary">{formatIdrShort(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 space-y-1 border-t border-border-muted pt-2.5 text-[12.5px]">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-text-primary">Total collected</span>
              <span className="font-data font-semibold tabular-nums text-text-primary">
                {formatIdrShort(payments.total)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-text-muted">Cash expected in drawer</span>
              <span className="font-data tabular-nums text-text-primary">
                {formatIdr(payments.cash_expected_drawer)}
              </span>
            </div>
          </div>
        </>
      )}
    </DashboardCard>
  );
}
