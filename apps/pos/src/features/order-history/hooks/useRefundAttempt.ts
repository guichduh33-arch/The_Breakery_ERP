import { useEffect, useReducer, useRef, useState } from 'react';
import { subscribeFinancialAttempts } from '@breakery/utils';
import { useAuthStore } from '@/stores/authStore';
import { pendingFinancialTargets, readFinancialSlot, runFinancialAttempt, type RefundSnapshot } from './refundRecovery';

export function captureRefundSession() {
  const state = useAuthStore.getState();
  const profileId = state.user?.id;
  const token = state.sessionToken;
  return { current: () => {
    const now = useAuthStore.getState();
    return Boolean(profileId && token && now.isAuthenticated && !now.isLoading && !now.isLocked
      && now.user?.id === profileId && now.sessionToken === token && now.hasPermission('orders.refund'));
  } };
}
export function useRefundAttempt(target: string, open: boolean) {
  const profileId = useAuthStore((s) => s.user?.id);
  const token = useAuthStore((s) => s.sessionToken);
  const allowed = useAuthStore((s) => s.hasPermission('orders.refund'));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = useState(false);
  const active = useRef(0);
  const environment = import.meta.env.VITE_SUPABASE_URL as string;
  const scope = profileId && environment && target ? { environment, profileId, operation: 'refund' as const, target } : null;
  const identity = JSON.stringify([environment, profileId, token, target, open]);
  const observed = useRef<{ identity: string; revision: string | null }>({ identity: '', revision: null });
  let slot = null;
  let storageError: string | null = null;
  try { if (scope) slot = readFinancialSlot(scope); } catch (error) { storageError = (error as Error).message; }
  if (observed.current.identity !== identity) observed.current = { identity, revision: slot?.revision ?? null };
  useEffect(() => subscribeFinancialAttempts(refresh), []);
  useEffect(() => { active.current++; setBusy(false); }, [identity, allowed]);
  useEffect(() => () => { active.current++; }, []);

  async function submit<R>(payload: RefundSnapshot, send: (value: RefundSnapshot, key: string, current: () => boolean) => Promise<R>,
    onCurrent?: (current: () => boolean) => void) {
    const session = captureRefundSession();
    const generation = active.current;
    const current = () => generation === active.current && session.current();
    onCurrent?.(current);
    if (!scope || !current()) throw new Error('Sign in with refund permission before continuing.');
    setBusy(true);
    try {
      return await runFinancialAttempt({ scope, expectedRevision: observed.current.revision, payload, current,
        send: (value, key) => send(value, key, current),
        onRevision: (revision) => { if (current()) observed.current.revision = revision; } });
    } finally { if (current()) { setBusy(false); refresh(); } }
  }
  return { pending: slot?.status === 'pending' ? slot : null, storageError, busy, allowed, submit };
}
export function usePendingRefundTargets() {
  const profileId = useAuthStore((s) => s.user?.id);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeFinancialAttempts(refresh), []);
  try {
    return { targets: profileId ? pendingFinancialTargets(import.meta.env.VITE_SUPABASE_URL as string, profileId, 'refund') : [], error: null };
  } catch (error) { return { targets: [], error: (error as Error).message }; }
}
