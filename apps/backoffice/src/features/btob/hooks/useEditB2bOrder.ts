import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FinancialAttemptError } from '@/lib/pendingFinancialAttempts.js';
import { isRecord, finite, type B2bEditSnapshot } from '@/lib/pendingFinancialAttemptSchema.js';
import { captureFinancialSession } from '@/lib/useFinancialAttempt.js';

export const B2B_EDIT_KEY = ['b2b-order-edit'] as const;

export function useB2bEditData(orderId: string) {
  return useQuery({
    queryKey: [...B2B_EDIT_KEY, orderId], staleTime: 0,
    queryFn: async () => {
      const { data, error } = await supabase.from('orders')
        .select('notes,updated_at,order_items(id,product_id,name_snapshot,quantity,unit_price,is_cancelled)')
        .eq('id', orderId).single();
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export function useB2bEditProducts() {
  return useQuery({
    queryKey: ['b2b-edit-products'], staleTime: 60_000,
    queryFn: async () => {
      // Le sélecteur ne lit aucun stock confidentiel ; la disponibilité est validée par la RPC.
      const { data, error } = await supabase.from('products').select('id,name,sku')
        .eq('is_active', true).is('deleted_at', null).order('name').limit(500);
      if (error) throw new Error(error.message);
      return data;
    },
  });
}

export const editErrorMessage = (message: string) => {
  if (message.includes('order_changed_reload')) return 'This order changed. Close and reopen the editor to load its latest version.';
  if (message.includes('order_has_payments')) return 'This order has a payment and can no longer be edited.';
  if (message.includes('order_not_editable')) return 'Only unpaid orders that have not been collected can be edited.';
  if (message.includes('credit_limit_exceeded')) return 'The change would exceed the customer credit limit.';
  if (message.includes('insufficient_stock')) return 'There is not enough stock for this change.';
  if (message.includes('fiscal_period') || message.includes('period_undefined')) return 'The current accounting period is closed or unavailable.';
  if (message.includes('dedicated_workflow')) return 'This order requires a dedicated correction workflow.';
  if (message.includes('permission_denied')) return 'You do not have permission to edit B2B orders.';
  return 'Could not save this order. Check the pending attempt before making another change.';
};

export function useEditB2bOrder() {
  const qc = useQueryClient();
  return useMutation({
    meta: { errorHandled: true },
    mutationFn: async ({ snapshot, key, current }: { snapshot: B2bEditSnapshot; key: string; current: () => boolean }) => {
      const session = captureFinancialSession();
      if (!session.current() || !current()) throw new FinancialAttemptError('Your session changed. Reopen this form.');
      const { data, error } = await supabase.rpc('edit_b2b_order_v3', {
        p_order_id: snapshot.orderId, p_items: snapshot.items, p_notes: snapshot.notes,
        p_expected_updated_at: snapshot.expectedUpdatedAt, p_idempotency_key: key,
      });
      if (!session.current() || !current()) throw new FinancialAttemptError('Your session changed. Reopen this form.');
      if (error) {
        const definitive = ['P0001', 'P0002', 'P0003', 'P0004', 'P0011', '23514', '22P02', '22003'].includes(error.code);
        throw new FinancialAttemptError(editErrorMessage(error.message), definitive);
      }
      if (!isRecord(data) || data.order_id !== snapshot.orderId || data.idempotency_key !== key
        || !finite(data.total) || data.total <= 0 || typeof data.updated_at !== 'string'
        || !Number.isFinite(Date.parse(data.updated_at)) || typeof data.idempotent_replay !== 'boolean') {
        throw new FinancialAttemptError('The response was invalid. Check the pending attempt to confirm the result.');
      }
      return data;
    },
    onSuccess: async (_result, { snapshot, current }) => {
      if (!current()) return;
      await Promise.all([
        ...['b2b-invoices', 'b2b-dashboard', 'b2b-customers', 'customers', 'customer-detail',
          'orders', 'order-detail', 'products', 'products-typeahead', 'stock-levels', 'stock-movements',
          'display-stock', 'display-movements', 'b2b-order-products'].map((key) => qc.invalidateQueries({ queryKey: [key] })),
        qc.invalidateQueries({ queryKey: ['b2b-order-items', snapshot.orderId] }),
        qc.invalidateQueries({ queryKey: ['b2b', 'balance-drift'] }),
        qc.invalidateQueries({ queryKey: B2B_EDIT_KEY }),
      ]);
    },
  });
}
