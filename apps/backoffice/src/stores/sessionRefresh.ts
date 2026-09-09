import { useAuthStore } from './authStore.js';

/** Renouvelle le bearer dix minutes avant expiration, sans déclarer d'activité. */
export function startSessionRefresh(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let probing = false;
  const schedule = () => {
    clearTimeout(timer);
    const state = useAuthStore.getState();
    if (stopped || probing || !state.isAuthenticated || !state.sessionToken || !state.authSnapshot) return;
    const delay = Math.max(60_000, state.authSnapshot.expires_at * 1000 - Date.now() - 600_000);
    timer = setTimeout(() => { void refresh(); }, delay);
  };
  const refresh = async () => {
    if (stopped || probing) return;
    probing = true;
    try { await useAuthStore.getState().validateSession(); }
    finally { probing = false; schedule(); }
  };
  const unsubscribe = useAuthStore.subscribe((state, previous) => {
    if (state.authSnapshot !== previous.authSnapshot || state.sessionToken !== previous.sessionToken || state.isAuthenticated !== previous.isAuthenticated) schedule();
  });
  schedule();
  return () => { stopped = true; clearTimeout(timer); unsubscribe(); };
}
