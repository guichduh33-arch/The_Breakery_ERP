import { useEffect, useReducer, useRef, useState } from 'react';
import type { PermissionCode } from '@breakery/supabase';
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
  const permissions: Record<FinancialOperation, PermissionCode> = {
    refund: 'orders.refund', payment: 'b2b.payment.record',
    expense_creation: 'expenses.create', expense_receipt: 'expenses.create',
    loyalty_conversion: 'customers.store_credit.convert', loyalty_adjustment: 'loyalty.adjust',
  };
  const permission = permissions[operation];
  const expenseOperation = operation === 'expense_creation' || operation === 'expense_receipt';
  const permitted = () => useAuthStore.getState().hasPermission(permission)
    || (expenseOperation && useAuthStore.getState().hasPermission('expenses.manage'));
  const allowed = useAuthStore((s) => s.hasPermission(permission)
    || (expenseOperation && s.hasPermission('expenses.manage')));
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const [busy, setBusy] = useState(false);
  const active = useRef(0);
  const mounted = useRef(true);
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
  // Ce ref est un compteur de génération, pas un nœud DOM : sa valeur courante doit être invalidée.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current++; }; }, []);

  async function submit<R>(payload: FinancialPayloads[K], send: (value: FinancialPayloads[K], key: string, current: () => boolean) => Promise<R>) {
    const session = captureFinancialSession();
    // Un callback ancien ne peut pas emprunter la session ou la cible d'un nouveau rendu.
    if (!mounted.current || observed.current.identity !== identity
      || session.profileId !== profileId || useAuthStore.getState().sessionToken !== token) {
      return { current: false, error: new Error('Your session or target changed. Reopen this form before continuing.') };
    }
    const generation = active.current;
    const isCurrent = () => mounted.current && observed.current.identity === identity
      && generation === active.current && session.current();
    if (!scope || !session.current() || !permitted()) {
      return { current: isCurrent(), error: new Error('Sign in with the required permission before continuing.') };
    }
    setBusy(true);
    try {
      const result = await runFinancialAttempt({ scope, expectedRevision: observed.current.revision, payload,
        current: () => isCurrent() && permitted(),
        send: (value, key) => send(value, key, () => isCurrent() && permitted()),
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
