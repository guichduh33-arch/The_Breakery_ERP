import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { queryClient } from '@/lib/queryClient';
import { pingCloud } from '@/features/lan/hooks/useCloudPing';
import { supabaseUrl } from '@/lib/supabase';

/** Le réseau revenu ne vaut pas une session validée. Aucune activité n'est rejouée. */
export function startCloudSession(): () => void {
  let disposed = false;
  let probing = false;
  const probe = (): void => {
    const auth = useAuthStore.getState();
    if (disposed || probing || !navigator.onLine || !auth.isAuthenticated
      || auth.cloudValidated || auth.lockReason === 'session_expired' || auth.bootstrapStatus === 'pending' || auth.bootstrapStatus === 'loading') return;
    probing = true;
    void (async () => {
      // Les pages Settings n'ont pas de ping monté : la reprise appartient au shell.
      if (!useCloudStatusStore.getState().cloudOnline) {
        const env = import.meta.env as Record<string, string | undefined>;
        if (!await pingCloud(supabaseUrl, env.VITE_SUPABASE_ANON_KEY ?? '') || disposed) return;
        useCloudStatusStore.getState().setCloudOnline(true);
      }
      if (!disposed && useAuthStore.getState().lockReason !== 'session_expired') await useAuthStore.getState().validateSession();
    })().finally(() => { probing = false; });
  };
  const cloud = useCloudStatusStore.subscribe((state, previous) => {
    if (!state.cloudOnline && previous.cloudOnline && useAuthStore.getState().isAuthenticated) useAuthStore.getState().suspendCloud();
    if (state.cloudOnline && !previous.cloudOnline) probe();
  });
  const auth = useAuthStore.subscribe((state, previous) => {
    if (state.cloudValidated && !previous.cloudValidated) void queryClient.invalidateQueries();
  });
  const offline = (): void => {
    useCloudStatusStore.getState().setCloudOnline(false);
    if (useAuthStore.getState().isAuthenticated) useAuthStore.getState().suspendCloud();
  };
  window.addEventListener('offline', offline);
  window.addEventListener('online', probe);
  const timer = setInterval(probe, 15_000);
  if (!useCloudStatusStore.getState().cloudOnline && useAuthStore.getState().isAuthenticated) useAuthStore.getState().suspendCloud();
  probe();
  return () => { disposed = true; cloud(); auth(); clearInterval(timer); window.removeEventListener('offline', offline); window.removeEventListener('online', probe); };
}
