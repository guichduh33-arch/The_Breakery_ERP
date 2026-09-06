// apps/backoffice/src/features/dashboard/components/CostMtdCard.tsx
//
// Écran 1c — COGS et OpEx du mois en cours, par compte.
//
// Le dashboard montrait le CA et rien de ce qu'il coûte. Cette carte remet les
// deux familles de coût en face du chiffre d'affaires : un CA record avec des
// achats matière qui montent plus vite n'est pas une bonne journée.
//
// Le codage couleur est celui du module Coûts (`chartColors.ts`) : BLEU =
// matière (COGS), AMBRE = exploitation (OpEx). Il est le même partout pour
// qu'un lecteur n'ait jamais à relire une légende.
//
// La variation MoM est rendue avec `invert` : sur un coût, MONTER est mauvais.
// C'est le seul endroit du dashboard où le vert est en bas.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { DashboardCard } from './DashboardCard.js';
import { Delta } from './Delta.js';
import { formatIdr, formatIdrShort, formatPct } from '../utils/format.js';
import { familyColor } from '@/features/reports/utils/chartColors.js';
import type { CostMtd } from '../hooks/useDashboardOverview.js';

const MAX_LINES = 6;

export function CostMtdCard({
  cost, isLoading, error,
}: {
  cost: CostMtd | null;
  isLoading: boolean;
  error: Error | null;
}): JSX.Element {
  const lines = cost?.lines ?? [];
  const shown = lines.slice(0, MAX_LINES);
  const hidden = lines.length - shown.length;

  // Part de chaque famille DANS LE COÛT TOTAL (pas dans le CA) : la barre
  // partage 100 % du coût du mois, ses deux segments doivent donc sommer à 1.
  const total = cost?.total ?? 0;
  const cogsShare = total > 0 ? ((cost?.cogs_total ?? 0) / total) * 100 : 0;

  // Réserve de plausibilité. « OpEx · 1036,2% of sales » est arithmétiquement
  // exact et se lit comme une erreur d'affichage : le dénominateur est le CA du
  // MOIS EN COURS, qui vaut peu de chose un 2 du mois, et un loyer payé le 1er
  // le dépasse à lui seul. On garde le chiffre — un mois réellement déficitaire
  // doit rester visible — et on DIT à côté qu'il dépasse 100 % (DESIGN.md : « la
  // réserve s'affiche à côté de la valeur »). Le seuil se lit sur les deux
  // ratios ensemble, pas sur une famille : c'est le coût total qui mange le CA.
  const costsExceedSales =
    cost !== null && cost.sales_mtd > 0 && cost.total > cost.sales_mtd;

  // Index par famille : la rampe de couleur se compte à l'intérieur d'une
  // famille, alors que les lignes arrivent triées par montant, familles mêlées.
  const rank = new Map<string, number>();
  let nCogs = 0, nOpex = 0;
  for (const l of shown) {
    rank.set(l.account_code, l.family === 'cogs' ? nCogs++ : nOpex++);
  }

  return (
    <DashboardCard
      title="COGS & expenses"
      aside={<span className="text-xs text-text-muted">month to date</span>}
      isLoading={isLoading}
      error={error}
      testId="card-cost-mtd"
    >
      {cost === null ? null : (
        <>
          <div className="flex gap-5">
            <div>
              {/* Le dénominateur est NOMMÉ : la même carte voisine un P&L sur
                  28 jours, et deux ratios sans fenêtre se lisent comme une
                  contradiction alors qu'ils mesurent deux périodes. */}
              <p className="text-xs text-text-muted">
                COGS · <span className="font-data tabular-nums">{formatPct(cost.cogs_pct_of_sales)}</span> of MTD sales
              </p>
              <p
                className="font-data text-base font-semibold tabular-nums text-text-primary"
                title={formatIdr(cost.cogs_total)}
              >
                {formatIdrShort(cost.cogs_total)}
              </p>
            </div>
            <div>
              <p className="text-xs text-text-muted">
                OpEx · <span className="font-data tabular-nums">{formatPct(cost.opex_pct_of_sales)}</span> of MTD sales
              </p>
              <p
                className="font-data text-base font-semibold tabular-nums text-text-primary"
                title={formatIdr(cost.opex_total)}
              >
                {formatIdrShort(cost.opex_total)}
              </p>
            </div>
          </div>

          {costsExceedSales && (
            <p className="mt-2 text-xs text-text-muted" data-testid="cost-mtd-reserve">
              Month-to-date cost ({formatIdrShort(cost.total)}) exceeds month-to-date sales
              ({formatIdrShort(cost.sales_mtd)}) — ratios above 100% are expected early in the
              month, when fixed costs are already booked.
            </p>
          )}

          <div
            className="mt-3 flex h-2 overflow-hidden rounded-[5px] bg-surface-4"
            role="img"
            aria-label={`COGS ${formatPct(cogsShare)} of month-to-date cost, OpEx the rest`}
          >
            <div style={{ width: `${cogsShare}%`, background: familyColor('cogs', 0) }} />
            <div style={{ width: `${100 - cogsShare}%`, background: familyColor('opex', 0) }} />
          </div>

          <ul className="mt-3 space-y-2">
            {shown.map((l) => (
              <li key={l.account_code} className="flex items-baseline gap-2 text-xs">
                <span
                  className="h-2 w-2 shrink-0 rounded-[2px]"
                  style={{ background: familyColor(l.family, rank.get(l.account_code) ?? 0) }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate text-text-primary">{l.account_name}</span>
                <Delta value={l.mom_delta_pct} period="MoM" invert className="shrink-0" />
                <span
                  className="shrink-0 font-data tabular-nums text-text-primary"
                  title={formatIdr(l.amount)}
                >
                  {formatIdrShort(l.amount)}
                </span>
              </li>
            ))}
            {hidden > 0 && (
              <li className="text-xs">
                <Link to="/backoffice/reports/operating-expenses" className="font-medium text-gold">
                  +{hidden} more account{hidden > 1 ? 's' : ''}
                </Link>
              </li>
            )}
          </ul>

          <div className="mt-3 space-y-1 border-t border-border-muted pt-2.5 text-xs">
            <div className="flex items-baseline justify-between">
              <span className="font-medium text-text-primary">Total cost MTD</span>
              <span
                className="font-data font-semibold tabular-nums text-text-primary"
                title={formatIdr(cost.total)}
              >
                {formatIdrShort(cost.total)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-text-muted">Cost per basket</span>
              <span className="font-data tabular-nums text-text-primary">
                {formatIdr(cost.cost_per_basket)}
              </span>
            </div>
          </div>
        </>
      )}
    </DashboardCard>
  );
}
