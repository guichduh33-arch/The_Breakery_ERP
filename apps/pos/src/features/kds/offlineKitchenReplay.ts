import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';
import { acknowledgeKitchenIntent, readKitchenJournal, retireKitchenRoot } from './offlineKitchenJournal';
import { queryClient } from '@/lib/queryClient';
import type { KdsItemRow } from './hooks/useKdsOrders';
import { useKdsOfflineStore } from './kdsOfflineStore';
import type { KitchenResolution } from './offlineKitchenReconciliation';

// Contrat local en attendant application autorisée et génération des types.
interface KitchenRpc {
  rpc: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
}
const api = supabase as unknown as KitchenRpc;
let running = false;

function resolutionOf(data: unknown): KitchenResolution | null {
  if (data === null) return null;
  if (!data || typeof data !== 'object') throw new Error('Invalid kitchen resolution');
  const value = data as KitchenResolution;
  if (typeof value.order_id !== 'string' || typeof value.order_number !== 'string' ||
      typeof value.order_status !== 'string' || !Array.isArray(value.items) ||
      value.items.some((item) => !item || typeof item.id !== 'string' ||
        !(item.client_line_id === null || typeof item.client_line_id === 'string') ||
        !['pending', 'preparing', 'ready', 'served'].includes(item.kitchen_status) ||
        typeof item.is_cancelled !== 'boolean')) throw new Error('Invalid kitchen resolution');
  return value;
}

/** Aucun échec n'efface une intention. Journal indépendant du drain argent. */
export async function replayKitchenJournal(): Promise<void> {
  if (running) return;
  const auth = useAuthStore.getState();
  if (!auth.isAuthenticated || auth.isLocked || !auth.user ||
      !(auth.user.role_code === 'SUPER_ADMIN' || auth.permissions.includes('kds.operate'))) return;
  const actor = auth.user.id;
  const session = auth.sessionToken;
  const stillAuthorized = () => {
    const current = useAuthStore.getState();
    return current.user?.id === actor && current.sessionToken === session && current.isAuthenticated &&
      !current.isLocked && (current.user.role_code === 'SUPER_ADMIN' || current.permissions.includes('kds.operate'));
  };
  running = true;
  try {
    const journal = readKitchenJournal();
    let issue: string | null = journal.intents.some((intent) => intent.actorId !== actor)
      ? 'Saved kitchen actions are waiting for their original employee to sign in.' : null;
    for (const root of Object.keys(journal.fired)) {
      if (!stillAuthorized()) return;
      const response = await api.rpc('resolve_kds_offline_order_v1', { p_client_uuid: root });
      if (!stillAuthorized()) return;
      if (response.error) throw new Error(response.error.message);
      const resolution = resolutionOf(response.data);
      if (!resolution) { issue ??= 'Kitchen orders are waiting for cloud synchronization.'; continue; }
      useKdsOfflineStore.getState().resolve(root, resolution);
      const terminal = journal.fired[root]!.items.every((local) =>
        resolution.items.some((item) => item.client_line_id === local.id && (item.is_cancelled || item.kitchen_status === 'served')));
      const queries = queryClient.getQueriesData<KdsItemRow[]>({ queryKey: ['kds'] });
      const refreshed = queries.length > 0 && queries.every(([key, rows]) => {
        const state = queryClient.getQueryState(key);
        return state?.status === 'success' && Array.isArray(rows) && !rows.some((row) => row.order_id === resolution.order_id);
      });
      const verifiedIds = journal.fired[root]!.items.map((item) => item.id);
      if (terminal && refreshed && retireKitchenRoot(root, verifiedIds)) {
        useKdsOfflineStore.getState().retire(root, verifiedIds);
        continue;
      }
      if (journal.fired[root]!.items.some((item) => !resolution.items.some((row) => row.client_line_id === item.id))) {
        issue = 'A saved kitchen line cannot be matched. Keep this browser data and contact a manager.';
      }
      for (const intent of journal.intents.filter((entry) => entry.rootId === root && entry.actorId === actor)) {
        if (!stillAuthorized()) return;
        if (!resolution.items.some((item) => item.client_line_id === intent.itemId)) {
          issue = 'A saved kitchen line cannot be matched. Keep this browser data and contact a manager.';
          continue;
        }
        const result = await api.rpc('replay_kds_offline_status_v1', {
          p_client_uuid: root, p_client_line_id: intent.itemId, p_status: intent.status,
          p_idempotency_key: intent.id, p_actor_id: actor, p_observed_at: intent.at,
        });
        if (!stillAuthorized()) return;
        if (result.error) throw new Error(result.error.message);
        const outcome = result.data && typeof result.data === 'object' && 'outcome' in result.data ? result.data.outcome : null;
        if (outcome === 'applied' || outcome === 'cancelled') acknowledgeKitchenIntent(intent.id);
        else issue = 'Kitchen actions are waiting for their cloud order. Keep this browser data.';
      }
    }
    useKdsOfflineStore.getState().setIssue(issue);
  } catch {
    useKdsOfflineStore.getState().setIssue('Kitchen synchronization is interrupted. Saved actions will be retried; keep this browser data.');
  } finally { running = false; }
}
