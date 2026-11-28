// apps/backoffice/src/features/reports/components/PurchaseItemLinesDrawer.tsx
//
// S3-20 — la descente de « Purchase Items » : les lignes d'achat d'UN article
// sur la période, paginées serveur (`get_purchase_item_lines_v1`), dans un
// tiroir comme les lignes de vente — le classement reste posé derrière.
//
// La pagination est par page (offset) et non « charger plus » : un article
// acheté chaque jour a vite des centaines de lignes, et la question est souvent
// « à quel prix l'ai-je payé tel mois », pas « tout faire descendre ».
// Le compteur dit toujours la position dans le jeu COMPLET.

import { useEffect, useState, type JSX } from 'react';
import { Package } from 'lucide-react';
import { Sheet, SheetDescription } from '@breakery/ui';
import { formatQuantity } from '@breakery/utils';
import {
  Button, EmptyState, SheetContent, SheetFooter, SheetHeader, SheetTitle,
} from '@/components/BackofficeUi.js';
import {
  PURCHASE_LINES_PAGE_SIZE, usePurchaseItemLines, type PurchaseItemStatus,
} from '../hooks/usePurchaseItems.js';
import { DrilldownLink } from './DrilldownLink.js';
import { POStatusBadge } from '@/features/purchasing/components/POStatusBadge.js';
import { PO_DATE_LABELS, formatPoDay } from '@/features/purchasing/poVocabulary.js';
import { formatIdrFull } from '../utils/chartColors.js';
import { formatCount, periodLabel } from '../utils/reportFigures.js';

export interface PurchaseItemLinesDrawerProps {
  /** `null` = tiroir fermé. */
  product:     { id: string; name: string } | null;
  start:       string;
  end:         string;
  /** La portée du classement : les lignes referment son total. */
  supplierId?: string | null;
  status?:     PurchaseItemStatus | null;
  onClose:     () => void;
}

const NUM_CELL = 'px-2 py-1.5 text-right font-data tabular-nums';
const TH       = 'px-2 py-1.5';
const DATE     = 'whitespace-nowrap px-2 py-1.5 font-data text-xs text-text-secondary';

export function PurchaseItemLinesDrawer({
  product, start, end, supplierId, status, onClose,
}: PurchaseItemLinesDrawerProps): JSX.Element {
  const [page, setPage] = useState(0);
  // Un autre article, une autre période ou un autre filtre repart de la page 1.
  useEffect(() => { setPage(0); }, [product?.id, start, end, supplierId, status]);

  const q = usePurchaseItemLines({
    start, end, productId: product?.id ?? null, supplierId: supplierId ?? null,
    status: status ?? null, page,
  });
  const lines = q.data?.lines ?? [];
  const total = q.data?.total_count ?? 0;
  const first = total === 0 ? 0 : page * PURCHASE_LINES_PAGE_SIZE + 1;
  const last  = Math.min(total, (page + 1) * PURCHASE_LINES_PAGE_SIZE);
  const isEmpty = !q.isLoading && q.data !== undefined && total === 0;

  return (
    <Sheet open={product !== null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent
        side="right"
        className="w-full max-w-2xl sm:max-w-4xl"
        data-testid="purchase-item-lines-drawer"
      >
        <SheetHeader>
          <SheetTitle className="font-sans text-lg">{product?.name ?? 'Article'}</SheetTitle>
          <SheetDescription>
            Every purchase line of this article, most recent first · {periodLabel(start, end)}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 pb-4">
          {q.error !== null && (
            <p role="alert" className="rounded border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
              {q.error.message.includes('42501') || q.error.message.includes('permission denied')
                ? 'You do not have permission to view these purchases.'
                : 'Unable to load the purchase lines.'}
            </p>
          )}
          {q.isLoading && (
            <p className="py-12 text-center text-sm text-text-muted">Loading purchase lines…</p>
          )}
          {isEmpty && (
            <EmptyState
              size="sm"
              icon={Package}
              title="No purchase in this period"
              description="This article was not ordered between these dates."
            />
          )}
          {q.error === null && lines.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm" data-testid="purchase-lines-table">
                <caption className="sr-only">
                  Purchase lines of {product?.name ?? 'this article'}, most recent first
                </caption>
                <thead>
                  <tr className="border-b border-border-subtle text-left text-text-secondary">
                    <th scope="col" className={TH}>{PO_DATE_LABELS.ordered}</th>
                    <th scope="col" className={TH}>{PO_DATE_LABELS.received}</th>
                    <th scope="col" className={TH}>PO#</th>
                    <th scope="col" className={TH}>Supplier</th>
                    <th scope="col" className={`${TH} text-right`}>Qty</th>
                    <th scope="col" className={`${TH} text-right`}>Received qty</th>
                    <th scope="col" className={`${TH} text-right`}>Unit cost</th>
                    <th scope="col" className={`${TH} text-right`}>Subtotal</th>
                    <th scope="col" className={TH}>Reception</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={`${l.po_id}-${i}`} className="border-b border-border-row">
                      <td className={DATE}>{formatPoDay(l.order_date.slice(0, 10))}</td>
                      <td className={DATE}>{formatPoDay(l.received_date?.slice(0, 10))}</td>
                      <td className="px-2 py-1.5 font-data">
                        <DrilldownLink entity="purchase_order" id={l.po_id} label={l.po_number} />
                      </td>
                      <td className="px-2 py-1.5 text-text-secondary">
                        <DrilldownLink entity="supplier" id={l.supplier_id} label={l.supplier_name} />
                      </td>
                      <td className={NUM_CELL}>{formatQuantity(l.quantity, l.unit)}</td>
                      <td className={NUM_CELL}>{formatQuantity(l.received_quantity, l.unit)}</td>
                      <td className={NUM_CELL}>{formatIdrFull(l.unit_cost)}</td>
                      <td className={`${NUM_CELL} font-semibold`}>{formatIdrFull(l.subtotal)}</td>
                      <td className="px-2 py-1.5"><POStatusBadge status={l.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <SheetFooter className="items-center sm:justify-between">
          <span className="font-data text-xs tabular-nums text-text-muted" data-testid="purchase-lines-count">
            {formatCount(first)}–{formatCount(last)} of {formatCount(total)} line{total === 1 ? '' : 's'}
          </span>
          <span className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={page === 0 || q.isFetching}
              onClick={() => { setPage((p) => Math.max(0, p - 1)); }}
            >
              Previous
            </Button>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={last >= total || q.isFetching}
              onClick={() => { setPage((p) => p + 1); }}
            >
              Next
            </Button>
            <Button type="button" variant="secondary" onClick={onClose}>Close</Button>
          </span>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
