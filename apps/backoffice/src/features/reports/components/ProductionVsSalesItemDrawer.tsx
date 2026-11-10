// apps/backoffice/src/features/reports/components/ProductionVsSalesItemDrawer.tsx
//
// S3-19 — la descente de « Production vs Sales » : le détail JOUR PAR JOUR d'un
// article, dans un tiroir (patron `ProductSalesLinesDrawer`) pour garder la
// période et le classement sous la main.
//
// Aucun nouvel appel : les jours viennent de `by_day_product`, déjà servi avec
// le classement — même portée, mêmes totaux. Le pied porte la ligne de
// l'article dans `by_product`, pas une somme recalculée ici.
//
// Deux sorties : la fiche produit, et « Sales by Product » sur la même période
// pour lire les ventes ligne à ligne.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Sheet, SheetDescription, cn } from '@breakery/ui';
import {
  Button, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/BackofficeUi.js';
import { FOCUS_RING } from '@/components/focusRing.js';
import { DrilldownLink } from './DrilldownLink.js';
import {
  GapValue, LeftoverValue, UnexplainedValue, formatSellThrough, sellThroughOf,
} from './productionVsSalesColumns.js';
import type { PvsDayProductRow, PvsProductRow } from '../hooks/useProductionVsSales.js';
import { buildDrilldownUrl } from '../utils/buildDrilldownUrl.js';
import { formatCount, longDate, periodLabel } from '../utils/reportFigures.js';

export interface ProductionVsSalesItemDrawerProps {
  /** `null` = tiroir fermé. */
  item:    PvsProductRow | null;
  /** Toutes les lignes jour × article du résultat courant. */
  days:    readonly PvsDayProductRow[];
  start:   string;
  end:     string;
  onClose: () => void;
}

const TH  = 'px-2 py-1.5';
const NUM = 'px-2 py-1.5 text-right font-data tabular-nums';

export function ProductionVsSalesItemDrawer({
  item, days, start, end, onClose,
}: ProductionVsSalesItemDrawerProps): JSX.Element {
  const rows = useMemo(
    () => (item === null ? [] : days
      .filter((d) => d.product_id === item.product_id)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))),
    [item, days],
  );

  const salesUrl = buildDrilldownUrl('sales_by_product', '', { start, end });

  return (
    <Sheet open={item !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl sm:max-w-3xl"
        data-testid="pvs-item-drawer"
      >
        <SheetHeader>
          {/* Playfair reste au monogramme : même parti que le tiroir des ventes. */}
          <SheetTitle className="font-sans text-lg">{item?.product_name ?? 'Item'}</SheetTitle>
          <SheetDescription>
            Production, sales and approved waste per day · {periodLabel(start, end)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 space-y-3 overflow-y-auto px-6 pb-4">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {item !== null && (
              <DrilldownLink
                entity="product"
                id={item.product_id}
                label="Open product"
                className={cn('rounded-sm', FOCUS_RING)}
              />
            )}
            {salesUrl !== null && (
              <Link
                to={salesUrl}
                className={cn('rounded-sm text-gold underline-offset-2 hover:underline', FOCUS_RING)}
                data-testid="pvs-sales-link"
              >
                Sales by Product for this period
              </Link>
            )}
          </div>

          {rows.length === 0 ? (
            <p className="py-8 text-center text-sm text-text-muted">No activity in this period.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="pvs-item-days">
                <caption className="sr-only">
                  Daily production and sales of {item?.product_name ?? 'this item'}
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-text-secondary">
                    <th scope="col" className={TH}>Day</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Carried over</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Produced</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Counter</th>
                    <th scope="col" className={cn(TH, 'text-right')}>B2B</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Sold total</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Approved waste</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Left at close</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Unexplained</th>
                    <th scope="col" className={cn(TH, 'text-right')}>Gap</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.date} className="border-b border-border-row" data-testid={`pvs-day-${d.date}`}>
                      <td className="whitespace-nowrap px-2 py-1.5 font-data">{longDate(d.date)}</td>
                      <td className={NUM}><LeftoverValue value={d.opening} /></td>
                      <td className={NUM}>{formatCount(d.produced)}</td>
                      <td className={NUM}>{formatCount(d.sold_counter)}</td>
                      <td className={NUM}>{formatCount(d.sold_b2b)}</td>
                      <td className={NUM}>{formatCount(d.sold_total)}</td>
                      <td className={NUM}>{formatCount(d.wasted)}</td>
                      <td className={NUM}><LeftoverValue value={d.closing} /></td>
                      <td className={NUM}><UnexplainedValue value={d.unexplained} /></td>
                      <td className={NUM}><GapValue gap={d.gap} /></td>
                    </tr>
                  ))}
                </tbody>
                {item !== null && (
                  <tfoot>
                    <tr className="border-t border-border-subtle font-semibold" data-testid="pvs-item-total">
                      <td className="px-2 py-2">Total</td>
                      <td className={NUM}>{formatCount(item.opening)}</td>
                      <td className={NUM}>{formatCount(item.produced)}</td>
                      <td className={NUM}>{formatCount(item.sold_counter)}</td>
                      <td className={NUM}>{formatCount(item.sold_b2b)}</td>
                      <td className={NUM}>{formatCount(item.sold_total)}</td>
                      <td className={NUM}>{formatCount(item.wasted)}</td>
                      <td className={NUM}>{formatCount(item.closing)}</td>
                      <td className={NUM}>
                        <UnexplainedValue value={item.unexplained} unknown={item.unknown_cells} />
                      </td>
                      <td className={NUM}><GapValue gap={item.gap} /></td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
        </div>

        <SheetFooter className="items-center sm:justify-between">
          <span className="font-data text-xs tabular-nums text-text-muted" data-testid="pvs-item-sell-through">
            {item !== null ? `Sell-through ${formatSellThrough(sellThroughOf(item))}` : ''}
            {' · '}days with no activity and nothing left are left out
          </span>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
