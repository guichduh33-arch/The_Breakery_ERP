import { useState, type JSX } from 'react';
import { Edit3, Undo2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/BackofficeUi.js';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { OrderDetail } from '../hooks/useOrderDetail.js';
import type { OrderItemEdit } from '../types.js';
import { EditOrderItemsModal } from './EditOrderItemsModal.js';
import { CancelUnpaidOrderModal } from './CancelUnpaidOrderModal.js';
import { RefundOrderModalBo } from './RefundOrderModalBo.js';
import { VoidOrderModal } from './VoidOrderModal.js';
import { isEditableStatus, isOrderDetailPaid, isOrderRefundable, isVoidablePaidStatus } from '../statusMeta.js';
import { useHasPendingFinancial } from '@/lib/useFinancialAttempt.js';

// Teinte seulement (DESIGN.md § Boutons) : aucun geste destructif n'est un
// aplat rouge ici — même surcharge du variant `secondary` que le tiroir.
const BTN_DANGER = 'border-red text-red-as-text hover:bg-red-soft';

// Même convention que `payment_method_primary` de la liste : un seul moyen le
// nomme, plusieurs moyens donnent « mixed ». Le premier paiement ne représente
// pas une commande réglée en plusieurs fois.
function primaryPaymentMethod(payments: OrderDetail['payments']): string | null {
  const methods = new Set(payments.map((p) => p.method));
  if (methods.size === 0) return null;
  if (methods.size > 1) return 'mixed';
  return [...methods][0] ?? null;
}

/**
 * Les mêmes RPC et contrôles que la liste ET le tiroir, accessibles depuis la
 * fiche : Edit, Refund, Void payé et Void impayé. Les conditions de statut
 * viennent de `statusMeta`, partagées avec le tiroir.
 */
export function OrderDetailActions({ order }: { order: OrderDetail }): JSX.Element {
  const hasEdit = useAuthStore((s) => s.hasPermission('orders.edit_open'));
  const hasVoid = useAuthStore((s) => s.hasPermission('orders.void'));
  const hasPaymentProcess = useAuthStore((s) => s.hasPermission('payments.process'));
  const hasRefund = useAuthStore((s) => s.hasPermission('orders.refund'));
  const pendingRefund = useHasPendingFinancial('refund', order.id);
  const [loadingItems, setLoadingItems] = useState(false);
  const [editItems, setEditItems] = useState<OrderItemEdit[] | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [paidVoidOpen, setPaidVoidOpen] = useState(false);
  const [refundOpen, setRefundOpen] = useState(false);
  const unpaid = !isOrderDetailPaid(order) && isEditableStatus(order.status);
  const canEdit = hasEdit && unpaid;
  const hasUnpaidVoid = hasVoid && hasPaymentProcess;
  const canVoid = hasUnpaidVoid && unpaid;
  const canPaidVoid = hasVoid && isVoidablePaidStatus(order.status);
  const canRefund = hasRefund && isOrderRefundable(order, pendingRefund);

  async function openEdit(): Promise<void> {
    if (!canEdit || loadingItems) return;
    setLoadingItems(true);
    try {
      // Relire les verrous cuisine à l'ouverture ; ne jamais les déduire du statut.
      const { data, error } = await supabase.from('order_items')
        .select('id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, is_locked')
        .eq('order_id', order.id)
        .eq('is_cancelled', false);
      if (error) throw error;
      setEditItems((data ?? []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        name_snapshot: item.name_snapshot,
        qty: Number(item.quantity),
        unit_price: Number(item.unit_price),
        line_total: Number(item.line_total),
        modifiers: Array.isArray(item.modifiers) ? item.modifiers : [],
        is_locked: item.is_locked,
      })));
    } catch {
      toast.error('Could not load order items. Please try again.');
    } finally {
      setLoadingItems(false);
    }
  }

  return (
    <>
      {canEdit && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={loadingItems}
          data-testid="detail-edit-items"
          onClick={() => { void openEdit(); }}
        >
          <Edit3 className="h-3.5 w-3.5 text-text-muted" aria-hidden />
          {loadingItems ? 'Loading items…' : 'Edit items'}
        </Button>
      )}
      {canRefund && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={BTN_DANGER}
          data-testid="detail-refund"
          onClick={() => { setRefundOpen(true); }}
        >
          <Undo2 className="h-3.5 w-3.5" aria-hidden />
          {pendingRefund ? 'Check pending refund' : 'Refund'}
        </Button>
      )}
      {canPaidVoid && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={BTN_DANGER}
          data-testid="detail-void-paid"
          onClick={() => { setPaidVoidOpen(true); }}
        >
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          Void
        </Button>
      )}
      {canVoid && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className={BTN_DANGER}
          data-testid="detail-void"
          onClick={() => { setVoidOpen(true); }}
        >
          <XCircle className="h-3.5 w-3.5" aria-hidden />
          Void unpaid order
        </Button>
      )}
      {canEdit && editItems !== null && (
        <EditOrderItemsModal
          open
          orderId={order.id}
          orderNumber={order.order_number}
          currentItems={editItems}
          onClose={() => { setEditItems(null); }}
        />
      )}
      {hasRefund && (
        <RefundOrderModalBo open={refundOpen} order={order} onClose={() => { setRefundOpen(false); }} />
      )}
      {canPaidVoid && paidVoidOpen && (
        <VoidOrderModal
          open
          orderId={order.id}
          orderNumber={order.order_number}
          total={order.total}
          paymentMethod={primaryPaymentMethod(order.payments)}
          onClose={() => { setPaidVoidOpen(false); }}
        />
      )}
      {hasUnpaidVoid && (
        <CancelUnpaidOrderModal
          open={voidOpen}
          orderId={order.id}
          onClose={() => { setVoidOpen(false); }}
        />
      )}
    </>
  );
}
