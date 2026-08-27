// apps/backoffice/src/features/reports/components/ProductSalesLinesDrawer.tsx
//
// Le drill-down de « Sales by Product » : les lignes de vente d'un produit sur
// la période courante, dans un tiroir plutôt qu'une seconde page — le retour au
// classement est immédiat et la période reste posée.
//
// Quatre points qui ne sont pas cosmétiques :
//
//  1. `order_number` N'EST PAS UNIQUE — la séquence repart par jour (`#0003`
//     revient chaque jour). Il ne se rend donc JAMAIS seul : la date est dans la
//     même ligne, et le lien passe par `order_id`, jamais par le numéro.
//  2. LE PIED PORTE LE JEU COMPLET (`totals` de la RPC), pas les lignes
//     descendues. Un pied qui totaliserait la page se lirait comme le total du
//     produit dès la 101ᵉ ligne.
//  3. `name_snapshot` s'affiche quand il DIFFÈRE du nom courant : c'est le nom
//     sous lequel le produit s'est vendu ce jour-là. Un écart est un fait
//     historique, pas une incohérence à masquer.
//  4. Le titre du tiroir ne prend pas le `font-display` par défaut de
//     `SheetTitle` : Playfair est réservé au monogramme de marque (DESIGN.md),
//     et cet écran n'a pas à grossir la dette de propagation.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, Loader2, Receipt } from 'lucide-react';
import {
  Badge, Button, EmptyState, Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle, cn,
} from '@breakery/ui';
import { formatDateTimeShortWita } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';
import {
  useProductSalesLines, type ProductSalesLine,
} from '../hooks/useProductSalesLines.js';
import { formatIdrFull } from '../utils/chartColors.js';
import { formatCount, periodLabel } from '../utils/reportFigures.js';

export interface ProductSalesLinesDrawerProps {
  /** `null` = tiroir fermé. Porte l'identité ET le nom courant du produit. */
  product: { id: string; name: string } | null;
  start:   string;
  end:     string;
  onClose: () => void;
}

const NUM_CELL  = 'px-2 py-1.5 text-right font-data tabular-nums';
const LINK_CELL = cn('text-gold underline-offset-2 hover:underline', FOCUS_RING);

function customerCell(line: ProductSalesLine): JSX.Element {
  if (line.customer_id === null) {
    // Une vente comptoir sans client n'est pas une donnée manquante : c'est un
    // passage. Le tiret dirait « on ne sait pas ».
    return <span className="text-text-muted">Walk-in</span>;
  }
  return (
    <Link to={`/backoffice/customers/${line.customer_id}`} className={LINK_CELL}>
      {line.customer_name ?? 'Customer'}
    </Link>
  );
}

export function ProductSalesLinesDrawer({
  product, start, end, onClose,
}: ProductSalesLinesDrawerProps): JSX.Element {
  const q = useProductSalesLines({ productId: product?.id ?? null, start, end });

  const lines  = q.data?.pages.flatMap((p) => p.lines) ?? [];
  const totals = q.data?.pages[0]?.totals;
  const loaded = lines.length;
  const all    = totals?.lines ?? 0;
  const isEmpty = !q.isLoading && q.data !== undefined && all === 0;

  return (
    <Sheet open={product !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl sm:max-w-4xl"
        data-testid="product-sales-lines-drawer"
      >
        <SheetHeader>
          <SheetTitle className="font-sans text-lg">
            {product?.name ?? 'Product'}
          </SheetTitle>
          <SheetDescription>
            Every sale of this product, most recent first · {periodLabel(start, end)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {q.error !== null && (
            <p
              role="alert"
              className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger"
              data-testid="lines-error"
            >
              {q.error.message === 'permission_denied' || q.error.message.includes('42501')
                ? 'You do not have permission to view these sales.'
                : q.error.message}
            </p>
          )}

          {q.isLoading && (
            <p className="py-12 text-center text-sm text-text-muted">Loading sales…</p>
          )}

          {isEmpty && (
            <EmptyState
              size="sm"
              icon={Receipt}
              title="No sale in this period"
              description="This product was not sold between these dates."
            />
          )}

          {q.error === null && lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="lines-table">
                <caption className="sr-only">
                  Sales of {product?.name ?? 'this product'}, most recent first
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-text-secondary">
                    <th scope="col" className="px-2 py-1.5">Sold at</th>
                    <th scope="col" className="px-2 py-1.5">Order</th>
                    <th scope="col" className="px-2 py-1.5">Customer</th>
                    <th scope="col" className="px-2 py-1.5">Channel</th>
                    <th scope="col" className="px-2 py-1.5 text-right">Qty</th>
                    <th scope="col" className="px-2 py-1.5 text-right">Unit price</th>
                    <th scope="col" className="px-2 py-1.5 text-right">Discount</th>
                    <th scope="col" className="px-2 py-1.5 text-right">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => (
                    <tr key={l.id} className="border-b border-border-row">
                      <td className="px-2 py-1.5 font-data tabular-nums text-text-secondary">
                        {formatDateTimeShortWita(l.sold_at)}
                      </td>
                      <td className="px-2 py-1.5">
                        <Link
                          to={`/backoffice/orders/${l.order_id}`}
                          className={cn(LINK_CELL, 'inline-flex items-center gap-1 font-data')}
                        >
                          {l.order_number}
                          <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
                        </Link>
                        {l.name_snapshot !== '' && l.name_snapshot !== product?.name && (
                          <span className="block text-xs text-text-muted">
                            sold as “{l.name_snapshot}”
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">{customerCell(l)}</td>
                      <td className="px-2 py-1.5">
                        <Badge variant={l.channel === 'b2b' ? 'default' : 'secondary'} className="text-xs">
                          {l.channel === 'b2b' ? 'B2B' : 'Counter'}
                        </Badge>
                      </td>
                      <td className={NUM_CELL}>{formatCount(l.quantity)}</td>
                      <td className={NUM_CELL}>{formatIdrFull(l.unit_price)}</td>
                      <td className={NUM_CELL}>
                        {l.discount_amount > 0 ? (
                          <span title={l.discount_reason ?? undefined}>
                            −{formatIdrFull(l.discount_amount)}
                          </span>
                        ) : (
                          <span className="text-text-subtle">—</span>
                        )}
                      </td>
                      <td className={cn(NUM_CELL, 'font-semibold')}>{formatIdrFull(l.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
                {totals !== undefined && (
                  <tfoot>
                    {/* Le jeu COMPLET, pas la page — d'où `totals` et non `lines`. */}
                    <tr className="border-t border-border-subtle font-semibold">
                      <td className="px-2 py-2" colSpan={4}>
                        Total · {formatCount(totals.orders)} order{totals.orders === 1 ? '' : 's'}
                      </td>
                      <td className={NUM_CELL}>{formatCount(totals.qty)}</td>
                      <td />
                      <td className={NUM_CELL}>
                        {totals.discount > 0 ? `−${formatIdrFull(totals.discount)}` : '—'}
                      </td>
                      <td className={NUM_CELL}>{formatIdrFull(totals.revenue)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>

              {q.hasNextPage && (
                <div className="pt-3 text-center">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    disabled={q.isFetchingNextPage}
                    onClick={() => { void q.fetchNextPage(); }}
                    data-testid="lines-load-more"
                  >
                    {q.isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />}
                    Load more
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        <SheetFooter className="items-center sm:justify-between">
          {/* Rendu MÊME quand la table est vide : « 0 of 0 » est une information. */}
          <span className="font-data text-xs tabular-nums text-text-muted" data-testid="lines-count">
            {formatCount(loaded)} of {formatCount(all)} line{all === 1 ? '' : 's'}
            {totals !== undefined && totals.b2b_qty > 0 && (
              <> · {formatCount(totals.counter_qty)} counter / {formatCount(totals.b2b_qty)} B2B</>
            )}
          </span>
          <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
