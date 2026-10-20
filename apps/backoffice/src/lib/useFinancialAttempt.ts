import { useEffect, useReducer, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore.js';
import { pendingFinancialTargets, readFinancialSlot, runFinancialAttempt, subscribeFinancialAttempts, type FinancialOperation, type FinancialPayloads } from './pendingFinancialAttempts.js';

export function captureFinancialSession() {
  const state = useAuthStore.getState();
  const profileId = state.user?.id;
  const token = state.sessionToken;
  return {
    profileId,
    current: () => {
      const now = useAuthStore.getState();
      return Boolean(profileId && token && now.isAuthenticated && !now.isLoading
        && now.user?.id === profileId && now.sessionToken === token);
    },
  };
}

export function useFinancialAttempt<K extends FinancialOperation>(operation: K, target: string, open: boolean) {
  const profileId = useAuthStore((s) => s.user?.id);
  const token = useAuthStore((s) => s.sessionToken);
  const permission = operation === 'refund' ? 'orders.refund' : 'b2b.payment.record';
  const allowed = useAuthStore((s) => s.hasPermission(permission));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = useState(false);
  const active = useRef(0);
  const environment = import.meta.env.VITE_SUPABASE_URL as string;
  const scope = profileId && environment && target ? { environment, profileId, operation, target } : null;
  const identity = JSON.stringify([environment, profileId, token, operation, target, open]);
  const observed = useRef<{ identity: string; revision: string | null }>({ identity: '', revision: null });
  let slot = null;
  let storageError: string | null = null;
  try { if (scope) slot = readFinancialSlot<K>(scope); }
  catch (error) { storageError = (error as Error).message; }
  // La révision reste celle de l'ouverture : un storage event n'autorise pas un nouveau geste.
  if (observed.current.identity !== identity) observed.current = { identity, revision: slot?.revision ?? null };
  useEffect(() => subscribeFinancialAttempts(refresh), []);
  useEffect(() => { active.current++; setBusy(false); }, [identity, allowed]);
  useEffect(() => () => { active.current++; }, []);

  async function submit<R>(payload: FinancialPayloads[K], send: (value: FinancialPayloads[K], key: string, current: () => boolean) => Promise<R>) {
    const session = captureFinancialSession();
    const generation = active.current;
    const isCurrent = () => generation === active.current && session.current();
    if (!scope || !session.current() || !useAuthStore.getState().hasPermission(permission)) {
      return { current: isCurrent(), error: new Error('Sign in with the required permission before continuing.') };
    }
    setBusy(true);
    try {
      const result = await runFinancialAttempt({ scope, expectedRevision: observed.current.revision, payload,
        current: () => isCurrent() && useAuthStore.getState().hasPermission(permission),
        send: (value, key) => send(value, key, isCurrent),
        onRevision: (revision) => { if (isCurrent()) observed.current.revision = revision; } });
      return { result, current: isCurrent() };
    } catch (error) {
      return { error, current: isCurrent() };
    } finally {
      // Le stockage peut changer même après un changement d'opérateur ; jamais son écran.
      if (isCurrent()) { setBusy(false); refresh(); }
    }
  }

  return { pending: slot?.status === 'pending' ? slot : null, storageError, busy, allowed, submit };
}

export function usePendingPaymentTargets(): string[] {
  const profileId = useAuthStore((s) => s.user?.id);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  useEffect(() => subscribeFinancialAttempts(refresh), []);
  try { return profileId ? pendingFinancialTargets(import.meta.env.VITE_SUPABASE_URL as string, profileId, 'payment') : []; }
  catch { return []; }
}

/** Lecture des entrées : leur permission métier reste vérifiée par l'appelant. */
export function useHasPendingFinancial(operation: FinancialOperation, target: string): boolean {
  return useFinancialAttempt(operation, target, false).pending !== null;
}
