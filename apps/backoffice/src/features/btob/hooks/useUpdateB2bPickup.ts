import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_INVOICES_QUERY_KEY } from './useB2bInvoices.js';
import { B2B_STOCK_AVAILABILITY_KEY } from './useB2bStockAvailability.js';

export function pickupErrorMessage(message: string): string {
  if (message.includes('insufficient_stock')) return 'There is not enough general stock to confirm pickup. Replenish stock, then try again.';
  if (message.includes('financial_import_requires_dedicated_workflow') || message.includes('order_requires_dedicated_workflow')) {
    return 'This order requires a dedicated correction workflow. Pickup was not confirmed.';
  }
  if (message.includes('fiscal_period') || message.includes('period_undefined') || message.includes('no fiscal period')) {
    return 'The current accounting period is closed or unavailable. Pickup was not confirmed.';
  }
  if (message.includes('permission_denied')) return 'You do not have permission to update B2B pickup.';
  if (message.includes('not_authenticated') || message.includes('user_profile_not_found')) return 'Your session is unavailable. Sign in again before updating pickup.';
  if (message.includes('b2b_order_not_found')) return 'This B2B order is no longer available. Refresh the order.';
  if (message.includes('order_voided')) return 'This order was cancelled and cannot be collected.';
  if (message.includes('order_already_delivered')) return 'This order has already been collected. Its pickup date cannot be changed.';
  if (message.includes('pickup_date_required')) return 'Choose a pickup date.';
  if (message.includes('order_not_collectable')) return 'This order cannot be collected in its current state. Refresh the order.';
  if (message.includes('b2b_stock_state_inconsistent') || message.includes('invalid_stock_consumption')) {
    return 'This order needs a stock review before pickup can be confirmed.';
  }
  return 'Could not confirm the pickup result. Retry to check the same order before handing it over.';
}

export function useUpdateB2bPickup() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorHandled: true },
    mutationFn: async (args: { orderId: string; pickupDate?: string; delivered: boolean }) => {
      const { data, error } = await Promise.resolve(supabase.rpc('update_b2b_pickup_v4', {
        p_order_id: args.orderId,
        ...(args.pickupDate ? { p_pickup_date: args.pickupDate } : {}),
        p_mark_delivered: args.delivered,
      })).catch(() => { throw new Error(pickupErrorMessage('')); });
      if (error) throw new Error(pickupErrorMessage(error.message));
      if (typeof data !== 'object' || data === null || Array.isArray(data)
        || data.order_id !== args.orderId
        || !(data.pickup_date === null || (typeof data.pickup_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.pickup_date)))
        || !(data.b2b_delivered_at === null || (typeof data.b2b_delivered_at === 'string' && Number.isFinite(Date.parse(data.b2b_delivered_at))))
        || (args.delivered && data.b2b_delivered_at === null)
        || (!args.delivered && data.b2b_delivered_at !== null)
        || (args.pickupDate !== undefined && data.pickup_date !== args.pickupDate)) {
        throw new Error('Could not confirm the pickup result. Retry to check the same order before handing it over.');
      }
      return data;
    },
    onSuccess: async (_result, args) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: B2B_INVOICES_QUERY_KEY }),
        ...(args.delivered ? ['stock-levels', 'stock-movements', 'stock-movements-feed', 'products',
          'products-typeahead', 'inventory-dashboard'].map((key) => qc.invalidateQueries({ queryKey: [key] })) : []),
        ...(args.delivered ? [qc.invalidateQueries({ queryKey: B2B_STOCK_AVAILABILITY_KEY })] : []),
      ]);
    },
  });
}
