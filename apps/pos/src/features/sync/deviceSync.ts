import { onlineManager, type QueryClient } from '@tanstack/react-query';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';

export type DeviceSyncResult = 'success' | 'offline' | 'error' | 'empty';

const running = new WeakMap<QueryClient, Promise<DeviceSyncResult>>();

export function canReachSyncServer(): boolean {
  return navigator.onLine && onlineManager.isOnline()
    && useCloudStatusStore.getState().cloudOnline;
}

/** Relit les queries actives ; ne recharge ni la page, ni les files d'écriture. */
export function syncDeviceData(client: QueryClient): Promise<DeviceSyncResult> {
  const pending = running.get(client);
  if (pending) return pending;
  if (!canReachSyncServer()) return Promise.resolve('offline');

  const job = (async (): Promise<DeviceSyncResult> => {
    const queries = client.getQueryCache().findAll({ type: 'active' })
      .filter((query) => !query.isDisabled());
    // Les écrans actuellement fermés reliront aussi leurs données à l'ouverture.
    await client.invalidateQueries({ refetchType: 'none' });
    if (queries.length === 0) return 'empty';
    await client.refetchQueries({ type: 'active' }, { cancelRefetch: false });
    if (!canReachSyncServer()) return 'offline';
    return queries.some((query) => query.state.status === 'error'
      || query.state.fetchStatus === 'paused') ? 'error' : 'success';
  })().catch((): DeviceSyncResult => 'error').finally(() => {
    running.delete(client);
  });
  running.set(client, job);
  return job;
}
