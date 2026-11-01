import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OutstandingOrdersPanel, type OutstandingPaymentRequest } from '@breakery/ui';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { useShiftStore } from '@/stores/shiftStore';
import { useOfflineMode } from '@/features/lan/offlineMode';
import { assertTerminalPaymentAllowed } from '@/features/lan/terminalPaymentAccess';

export default function OutstandingPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const actor = useAuthStore((s) => s.user?.id);
  const token = useAuthStore((s) => s.sessionToken);
  const canPay = useAuthStore((s) => s.hasPermission('payments.process'));
  const sessionId = useShiftStore((s) => s.current?.id ?? null);
  const offline = useOfflineMode();
  const qc = useQueryClient();
  const isCurrent = () => {
    const state = useAuthStore.getState();
    return !!actor && !!token && state.user?.id === actor && state.sessionToken === token && !state.isLocked && state.isAuthenticated;
  };
  const list = useQuery({ queryKey: ['outstanding-orders', actor, search, page],
    enabled: !!actor && !offline, refetchInterval: 15_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('list_pos_outstanding_v1', { p_search: search, p_offset: page * 50, p_limit: 50 });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });
  async function settle(request: OutstandingPaymentRequest) {
    if (!isCurrent()) throw new Error('Your session changed. Reopen outstanding tickets.');
    assertTerminalPaymentAllowed();
    if (offline) throw new Error('Reconnect before collecting an outstanding payment');
    if (!request.sessionId) throw new Error('Open a shift before collecting payment');
    const { error } = await supabase.rpc('settle_pos_outstanding_v2', {
      p_order_id: request.orderId, p_method: request.method, p_amount: request.amount,
      p_idempotency_key: request.idempotencyKey, p_session_id: request.sessionId,
      ...(request.expectedPaid !== undefined ? { p_expected_paid: request.expectedPaid } : {}),
    });
    if (!isCurrent()) throw new Error('Your session changed. Resume the saved payment to confirm its result.');
    if (error) throw Object.assign(new Error(error.message), { code: error.code });
    await qc.invalidateQueries({ queryKey: ['outstanding-orders'] });
    void qc.invalidateQueries({ queryKey: ['shift-close-summary'] });
  }
  return <main className="min-h-screen bg-bg-base text-text-primary p-4 md:p-6 space-y-5">
    <header className="flex items-center gap-4"><Link to="/pos" className="min-h-11 inline-flex items-center text-gold">Back to POS</Link>
      <h1 className="text-2xl font-semibold">POS Outstanding</h1></header>
    <OutstandingOrdersPanel key={actor} rows={list.data ?? []} loading={list.isLoading}
      {...(list.error ? { loadError: list.error.message } : {})}
      search={search} onSearch={(value) => { setSearch(value); setPage(0); }} page={page} onPage={setPage}
      canSettle={!!actor && canPay && !!sessionId && !offline} sessionId={sessionId} isCurrent={isCurrent}
      disabledReason={offline ? 'Reconnect before collecting payment.' : !sessionId ? 'Open a shift to collect payment.' : 'Payment permission is required.'}
      storageKey={`breakery.outstanding-pos.v1:${actor}`} onSettle={settle} />
  </main>;
}
