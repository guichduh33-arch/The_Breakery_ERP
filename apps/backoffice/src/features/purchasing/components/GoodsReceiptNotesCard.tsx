// apps/backoffice/src/features/purchasing/components/GoodsReceiptNotesCard.tsx
//
// S3-05 — carte des réceptions du bon de commande, sortie de
// `PurchaseOrderDetailCards` pour porter l'annulation d'une réception.
//
// Une réception active offre « Cancel receipt » quand l'utilisateur a
// `purchasing.po.cancel` et que le serveur peut l'accepter (bon `partial` ou
// `received`, hors import historique). Une réception annulée reste listée,
// marquée, avec sa date et sa raison, sans action : elle compte toujours
// comme réception pour `cancel_purchase_order_v1`, qui refuse donc ensuite
// d'annuler le bon lui-même (limite connue, signalée sous le tableau).

import { useState, type JSX } from 'react';
import { Badge } from '@breakery/ui';
import { Card, EmptyState, Button } from '@/components/BackofficeUi.js';
import { SectionLabel } from '@/components/SectionLabel.js';
import { formatCurrency, formatDateShortWita } from '@breakery/utils';
import type { GoodsReceiptNoteRow, PurchaseOrderDetail } from '../hooks/usePurchaseOrderDetail.js';
import {
  useCancelGoodsReceipt,
  cancelReceiptErrorMessage,
  CancelReceiptError,
} from '../hooks/useCancelGoodsReceipt.js';
import { CancelReceiptDialog } from './CancelReceiptDialog.js';

const NUM_CELL = 'px-3 py-2 text-right font-data tabular-nums';

function fmtIdr(amount: number | string | null): string {
  return formatCurrency(Number(amount ?? 0));
}

export interface GoodsReceiptNotesCardProps {
  po: PurchaseOrderDetail;
  /** `purchasing.po.cancel` — la permission que vérifie aussi le serveur. */
  canCancelReceipt?: boolean;
}

export function GoodsReceiptNotesCard({ po, canCancelReceipt = false }: GoodsReceiptNotesCardProps): JSX.Element {
  const cancel = useCancelGoodsReceipt();
  const [target, setTarget] = useState<GoodsReceiptNoteRow | null>(null);
  const [error, setError]   = useState<string | undefined>(undefined);

  const grns = po.goods_receipt_notes;
  const cancellableOrder = (po.status === 'partial' || po.status === 'received')
    && po.financial_import_document_id === null;
  const showAction = canCancelReceipt && cancellableOrder;
  const allCancelled = grns.length > 0 && grns.every((g) => g.cancelled_at !== null);

  function productName(productId: string | undefined): string | undefined {
    if (productId === undefined) return undefined;
    return po.purchase_order_items.find((it) => it.product_id === productId)?.products?.name;
  }

  function open(g: GoodsReceiptNoteRow): void {
    setError(undefined);
    setTarget(g);
  }

  async function handleConfirm(reason: string): Promise<void> {
    if (target === null) return;
    setError(undefined);
    try {
      await cancel.mutateAsync({ grnId: target.id, poId: po.id, reason });
      setTarget(null);
    } catch (e) {
      setError(e instanceof CancelReceiptError
        ? cancelReceiptErrorMessage(e, productName(e.details.productId))
        : (e instanceof Error ? e.message : 'Unknown error'));
    }
  }

  return (
    <Card variant="default" padding="md" className="space-y-3">
      <SectionLabel as="h2" size="sm" id="po-grn-heading" className="text-gold">Goods Receipt Notes</SectionLabel>
      {grns.length === 0 ? (
        <EmptyState
          title="No receipts recorded yet"
          description="The first GRN will appear here once goods have been received."
          size="sm"
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border-subtle">
          <table className="w-full text-sm" aria-labelledby="po-grn-heading">
            <thead className="bg-surface-inert">
              <tr>
                <th scope="col" className="px-3 py-2 text-left">
                  <SectionLabel as="span" size="xs">GRN</SectionLabel>
                </th>
                <th scope="col" className="px-3 py-2 text-left w-32">
                  <SectionLabel as="span" size="xs">Date</SectionLabel>
                </th>
                <th scope="col" className="px-3 py-2 text-right w-32">
                  <SectionLabel as="span" size="xs">Subtotal</SectionLabel>
                </th>
                <th scope="col" className="px-3 py-2 text-right w-32">
                  <SectionLabel as="span" size="xs">VAT</SectionLabel>
                </th>
                <th scope="col" className="px-3 py-2 text-right w-32">
                  <SectionLabel as="span" size="xs">Total</SectionLabel>
                </th>
                {showAction && (
                  <th scope="col" className="px-3 py-2 text-right w-36">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {grns.map((g) => {
                const cancelled = g.cancelled_at !== null;
                const amountCls = cancelled ? 'text-text-muted line-through' : '';
                return (
                  <tr key={g.id} className="border-t border-border-subtle align-top" data-testid={`grn-row-${g.id}`}>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`font-mono text-xs ${cancelled ? 'text-text-muted' : ''}`}>{g.grn_number}</span>
                        {cancelled && (
                          <Badge variant="outline" className="border-danger text-danger">CANCELLED</Badge>
                        )}
                      </div>
                      {cancelled && (
                        <p className="mt-1 text-xs text-text-secondary">
                          Cancelled {formatDateShortWita(g.cancelled_at!)}
                          {g.cancel_reason !== null && g.cancel_reason !== '' && <> — {g.cancel_reason}</>}
                        </p>
                      )}
                    </td>
                    <td className="px-3 py-2 font-data tabular-nums text-text-secondary">{formatDateShortWita(g.received_date)}</td>
                    <td className={`${NUM_CELL} ${amountCls}`}>{fmtIdr(g.subtotal)}</td>
                    <td className={`${NUM_CELL} ${amountCls}`}>{fmtIdr(g.vat_amount)}</td>
                    <td className={`${NUM_CELL} font-medium ${amountCls}`}>{fmtIdr(g.total)}</td>
                    {showAction && (
                      <td className="px-3 py-2 text-right">
                        {!cancelled && (
                          <Button
                            type="button"
                            variant="ghostDestructive"
                            size="sm"
                            onClick={() => open(g)}
                            aria-label={`Cancel receipt ${g.grn_number}`}
                          >
                            Cancel receipt
                          </Button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {allCancelled && (
        <p role="status" className="text-xs text-text-muted">
          Every receipt on this order is cancelled. The order can be received again, but it
          can no longer be cancelled itself: cancelled receipts stay on record.
        </p>
      )}

      {target !== null && (
        <CancelReceiptDialog
          grnNumber={target.grn_number}
          cashTerms={(target.payment_terms ?? po.payment_terms) === 'cash'}
          onCancel={() => { setTarget(null); setError(undefined); }}
          onConfirm={handleConfirm}
          submitting={cancel.isPending}
          {...(error !== undefined ? { error } : {})}
        />
      )}
    </Card>
  );
}
