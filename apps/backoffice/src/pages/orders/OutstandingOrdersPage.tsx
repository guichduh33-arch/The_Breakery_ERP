import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OutstandingOrdersPanel, type OutstandingPaymentRequest } from '@breakery/ui';
import { PageHeader } from '@/components/PageHeader.js';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';

export default function OutstandingOrdersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const actor = useAuthStore((s) => s.user?.id);
  const token = useAuthStore((s) => s.sessionToken);
  const canPay = useAuthStore((s) => s.hasPermission('payments.process'));
  const qc = useQueryClient();
  const isCurrent = () => {
    const state = useAuthStore.getState();
    return !!actor && !!token && state.user?.id === actor && state.sessionToken === token && state.isAuthenticated && !state.isLoading;
  };
  const list = useQuery({ queryKey: ['outstanding-orders', actor, search, page], enabled: !!actor,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_pos_outstanding_v1', { p_search: search, p_offset: page * 50, p_limit: 50 });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  async function settle(request: OutstandingPaymentRequest) {
    if (!isCurrent()) throw new Error('Your session changed. Reopen outstanding tickets.');
    const { error } = await supabase.rpc('settle_pos_outstanding_v2', {
      p_order_id: request.orderId, p_method: request.method, p_amount: request.amount,
      p_idempotency_key: request.idempotencyKey,
      ...(request.expectedPaid !== undefined ? { p_expected_paid: request.expectedPaid } : {}),
    });
    if (!isCurrent()) throw new Error('Your session changed. Resume the saved payment to confirm its result.');
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    await qc.invalidateQueries({ queryKey: ['outstanding-orders'] });
    void qc.invalidateQueries({ queryKey: ['orders'] });
  }
  return <div className="space-y-6">
    <PageHeader title="POS Outstanding" subtitle="Unpaid customer tickets. Back-office receipts are recorded separately from POS shifts." />
    <OutstandingOrdersPanel key={actor} rows={list.data ?? []} loading={list.isLoading}
      {...(list.error ? { loadError: list.error.message } : {})}
      search={search} onSearch={(value) => { setSearch(value); setPage(0); }} page={page} onPage={setPage}
      canSettle={!!actor && canPay} sessionId={null} isCurrent={isCurrent} disabledReason="Payment permission is required."
      storageKey={`breakery.outstanding-backoffice.v1:${actor}`} onSettle={settle} />
  </div>;
}
