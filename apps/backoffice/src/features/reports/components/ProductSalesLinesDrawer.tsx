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
//
// S3-21 (2026-11-10) — création, paiement et table de la commande à côté de
// « Sold at » ; tri CLIENT par colonne (`useSortedRows`, ordre serveur par
// défaut) sur les lignes DÉJÀ chargées ; export CSV de ces mêmes lignes, dans
// l'ordre affiché, gaté `reports.export` comme ExportMenu.

import { useMemo, type JSX } from 'react';
import { Link } from 'react-router-dom';
import { Download, ExternalLink, Loader2, Receipt } from 'lucide-react';
import { toast } from 'sonner';
import { Badge, Sheet, SheetDescription, cn } from '@breakery/ui';
import { buildCsv, downloadCsv, type CsvColumn } from '@breakery/domain';
import { Button, EmptyState, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '@/components/BackofficeUi.js';
import { formatDateTimeShortWita } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useAuthStore } from '@/stores/authStore.js';
import {
  useProductSalesLines, type ProductSalesLine,
} from '../hooks/useProductSalesLines.js';
import { useSortedRows, type SortSpec } from '../hooks/useSortedRows.js';
import { SortableTh } from './SortableTh.js';
import { exportErrorDetail } from './ExportButtons.js';
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
const TH_CELL   = 'px-2 py-1.5';
const TIME_CELL = 'whitespace-nowrap px-2 py-1.5 font-data tabular-nums text-text-secondary';
const DASH      = <span className="text-text-subtle">—</span>;

type LineSortKey =
  | 'sold_at' | 'created_at' | 'paid_at' | 'order' | 'table' | 'customer'
  | 'channel' | 'qty' | 'unit_price' | 'discount' | 'line_total';

const customerText = (l: ProductSalesLine): string =>
  l.customer_id === null ? 'Walk-in' : l.customer_name ?? 'Customer';

// Stable (niveau module) : `useSortedRows` le porte dans ses dépendances.
const SORT_SPECS: Readonly<Record<LineSortKey, SortSpec<ProductSalesLine>>> = {
  sold_at:    { kind: 'date',   value: (l) => l.sold_at },
  created_at: { kind: 'date',   value: (l) => l.created_at },
  paid_at:    { kind: 'date',   value: (l) => l.paid_at },
  order:      { kind: 'string', value: (l) => l.order_number },
  table:      { kind: 'string', value: (l) => l.table_number },
  customer:   { kind: 'string', value: customerText },
  channel:    { kind: 'string', value: (l) => l.channel },
  qty:        { kind: 'number', value: (l) => l.quantity },
  unit_price: { kind: 'number', value: (l) => l.unit_price },
  discount:   { kind: 'number', value: (l) => l.discount_amount },
  line_total: { kind: 'number', value: (l) => l.line_total },
};

const CSV_COLUMNS: CsvColumn<ProductSalesLine>[] = [
  { header: 'Sold at',    accessor: (l) => l.sold_at,    format: 'datetime' },
  { header: 'Created',    accessor: (l) => l.created_at, format: 'datetime' },
  { header: 'Paid',       accessor: (l) => l.paid_at,    format: 'datetime' },
  { header: 'Order #',    accessor: (l) => l.order_number },
  { header: 'Table',      accessor: (l) => l.table_number },
  { header: 'Customer',   accessor: customerText },
  { header: 'Channel',    accessor: (l) => (l.channel === 'b2b' ? 'B2B' : 'Counter') },
  { header: 'Sold as',    accessor: (l) => l.name_snapshot },
  { header: 'Qty',        accessor: (l) => l.quantity,        format: 'number' },
  { header: 'Unit price', accessor: (l) => l.unit_price,      format: 'idr' },
  { header: 'Discount',   accessor: (l) => l.discount_amount, format: 'idr' },
  { header: 'Line total', accessor: (l) => l.line_total,      format: 'idr' },
];
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
  const canExport = useAuthStore((s) => s.hasPermission('reports.export'));

  const hidden = q.isError || q.isFetching;
  // Mémoïsé : `useSortedRows` ne retrie que si le tableau change.
  const lines  = useMemo(
    () => (hidden ? [] : q.data?.pages.flatMap((p) => p.lines) ?? []),
    [hidden, q.data],
  );
  const sorted = useSortedRows<ProductSalesLine, LineSortKey>(lines, SORT_SPECS);
  const totals = q.isError || q.isFetching ? undefined : q.data?.pages[0]?.totals;
  const loaded = lines.length;
  const all    = totals?.lines ?? 0;
  const isEmpty = !q.isLoading && q.data !== undefined && all === 0;

  // Les lignes CHARGÉES, dans l'ordre affiché — pas le jeu complet du serveur.
  const handleCsv = (): void => {
    try {
      downloadCsv(buildCsv(sorted.rows, CSV_COLUMNS), `product-sales-lines-${start}_${end}`);
    } catch (e) {
      const detail = exportErrorDetail(e);
      toast.error(detail === '' ? 'CSV export failed. Please try again.' : `CSV export failed: ${detail}`);
    }
  };

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
                    <SortableTh label="Sold at"    sortKey="sold_at"    sorted={sorted} className={TH_CELL} />
                    <SortableTh label="Created"    sortKey="created_at" sorted={sorted} className={TH_CELL} />
                    <SortableTh label="Paid"       sortKey="paid_at"    sorted={sorted} className={TH_CELL} />
                    <SortableTh label="Order"      sortKey="order"      sorted={sorted} className={TH_CELL} />
                    <SortableTh label="Table"      sortKey="table"      sorted={sorted} className={TH_CELL} />
                    <SortableTh label="Customer"   sortKey="customer"   sorted={sorted} className={TH_CELL} />
                    <SortableTh label="Channel"    sortKey="channel"    sorted={sorted} className={TH_CELL} />
                    <SortableTh label="Qty"        sortKey="qty"        sorted={sorted} className={TH_CELL} align="right" />
                    <SortableTh label="Unit price" sortKey="unit_price" sorted={sorted} className={TH_CELL} align="right" />
                    <SortableTh label="Discount"   sortKey="discount"   sorted={sorted} className={TH_CELL} align="right" />
                    <SortableTh label="Line total" sortKey="line_total" sorted={sorted} className={TH_CELL} align="right" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.rows.map((l) => (
                    <tr key={l.id} className="border-b border-border-row" data-testid={`line-${l.id}`}>
                      <td className={TIME_CELL}>{formatDateTimeShortWita(l.sold_at)}</td>
                      <td className={TIME_CELL} data-testid="line-created">
                        {/* Une date vide ferait lever le formateur et blanchirait le tiroir. */}
                        {l.created_at !== '' ? formatDateTimeShortWita(l.created_at) : DASH}
                      </td>
                      <td className={TIME_CELL} data-testid="line-paid">
                        {l.paid_at !== null ? formatDateTimeShortWita(l.paid_at) : DASH}
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
                      <td className="px-2 py-1.5 font-data" data-testid="line-table">{l.table_number ?? DASH}</td>
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
                      <td className="px-2 py-2" colSpan={7}>
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
          <span className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleCsv}
              disabled={!canExport || sorted.rows.length === 0}
              title={!canExport ? 'Requires the reports.export permission.' : undefined}
              data-testid="lines-export-csv"
            >
              <Download className="h-3.5 w-3.5" aria-hidden />
              Export CSV
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          </span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
