import { onlineManager, type Query, type QueryClient } from '@tanstack/react-query';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';

export type DeviceSyncResult = 'success' | 'offline' | 'error' | 'empty';

/**
 * `manual` (bouton) relit tout. `background` (filet de 30 s, focus, reprise)
 * épargne les préchargements montés PAR PRODUIT tant qu'ils sont récents.
 */
export type DeviceSyncMode = 'manual' | 'background';

/**
 * Préchargements à une query par produit (écran de vente hors-ligne, ~300
 * observers cachés). Le filet de fond ne les relit qu'après cet âge : relus à
 * chaque tour de 30 s, ils ont produit ~800 000 requêtes en prod le 2026-11-18.
 * Le push catalogue (useCatalogRealtime) et le bouton manuel les relisent
 * toujours.
 */
const PER_PRODUCT_PRELOAD_ROOTS: ReadonlySet<unknown> = new Set(['product-modifiers', 'combo-config']);
export const PER_PRODUCT_PRELOAD_MAX_AGE_MS = 5 * 60_000;

function isFreshPerProductPreload(query: Query, now: number): boolean {
  const age = now - query.state.dataUpdatedAt;
  // Une date future (horloge décalée) n'est jamais « récente ».
  return PER_PRODUCT_PRELOAD_ROOTS.has(query.queryKey[0])
    && query.state.status === 'success'
    && !query.state.isInvalidated
    && age >= 0 && age < PER_PRODUCT_PRELOAD_MAX_AGE_MS;
}

const running = new WeakMap<QueryClient, { mode: DeviceSyncMode; job: Promise<DeviceSyncResult> }>();

export function canReachSyncServer(): boolean {
  return navigator.onLine && onlineManager.isOnline()
    && useCloudStatusStore.getState().cloudOnline;
}

/** Relit les queries actives ; ne recharge ni la page, ni les files d'écriture. */
export function syncDeviceData(
  client: QueryClient,
  { mode = 'manual' }: { mode?: DeviceSyncMode } = {},
): Promise<DeviceSyncResult> {
  const pending = running.get(client);
  if (pending) {
    // Un appui manuel pendant un passage de fond ne se contente pas d'un
    // passage qui a épargné les préchargements : il relit tout ensuite.
    if (mode === 'manual' && pending.mode === 'background') {
      return pending.job.then(() => syncDeviceData(client, { mode }));
    }
    return pending.job;
  }
  if (!canReachSyncServer()) return Promise.resolve('offline');

  const job = (async (): Promise<DeviceSyncResult> => {
    const now = Date.now();
    const included = (query: Query): boolean => mode === 'manual' || !isFreshPerProductPreload(query, now);
    const queries = client.getQueryCache().findAll({ type: 'active' })
      .filter((query) => !query.isDisabled() && included(query));
    // Les écrans actuellement fermés reliront aussi leurs données à l'ouverture.
    await client.invalidateQueries({ refetchType: 'none', predicate: included });
    if (queries.length === 0) return 'empty';
    await client.refetchQueries({ type: 'active', predicate: included }, { cancelRefetch: false });
    if (!canReachSyncServer()) return 'offline';
    return queries.some((query) => query.state.status === 'error'
      || query.state.fetchStatus === 'paused') ? 'error' : 'success';
  })().catch((): DeviceSyncResult => 'error').finally(() => {
    running.delete(client);
  });
  running.set(client, { mode, job });
  return job;
}
