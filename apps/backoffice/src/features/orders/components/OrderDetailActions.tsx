import { useState, type JSX } from 'react';
import { Edit3, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/BackofficeUi.js';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';
import type { OrderDetail } from '../hooks/useOrderDetail.js';
import type { OrderItemEdit } from '../types.js';
import { EditOrderItemsModal } from './EditOrderItemsModal.js';
import { CancelUnpaidOrderModal } from './CancelUnpaidOrderModal.js';
import { isOrderDetailPaid } from '../statusMeta.js';

/** Les mêmes RPC et contrôles que la liste, accessibles depuis la fiche. */
export function OrderDetailActions({ order }: { order: OrderDetail }): JSX.Element {
  const hasEdit = useAuthStore((s) => s.hasPermission('orders.edit_open'));
  const hasVoid = useAuthStore((s) => s.hasPermission('orders.void'));
  const hasPaymentProcess = useAuthStore((s) => s.hasPermission('payments.process'));
  const [loadingItems, setLoadingItems] = useState(false);
  const [editItems, setEditItems] = useState<OrderItemEdit[] | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const unpaid = !isOrderDetailPaid(order) && (order.status === 'draft' || order.status === 'pending_payment');
  const canEdit = hasEdit && unpaid;
  const hasUnpaidVoid = hasVoid && hasPaymentProcess;
  const canVoid = hasUnpaidVoid && unpaid;

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
      {canVoid && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="border-red text-red-as-text hover:bg-red-soft"
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
