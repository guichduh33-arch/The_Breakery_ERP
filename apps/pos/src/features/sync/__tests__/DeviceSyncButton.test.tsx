import { QueryClient, QueryClientProvider, QueryObserver } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/stores/authStore';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { useTabletCartStore } from '@/stores/tabletCartStore';
import { DeviceSyncButton } from '../DeviceSyncButton';

const notifications = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('sonner', () => ({ toast: notifications }));

let client: QueryClient;
let stop: () => void;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  useAuthStore.setState({ isAuthenticated: true, bootstrapStatus: 'ready', cloudValidated: true, isLocked: false });
  useCloudStatusStore.setState({ cloudOnline: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  stop?.();
  client.clear();
  vi.restoreAllMocks();
});

function mount(queryFn: () => Promise<number>) {
  stop = new QueryObserver(client, {
    queryKey: ['products'], queryFn, initialData: 2, staleTime: Infinity,
  }).subscribe(() => undefined);
  render(<QueryClientProvider client={client}><DeviceSyncButton /></QueryClientProvider>);
}

describe('manual device sync button', () => {
  it('relit les données sans modifier le panier et confirme le succès', async () => {
    useTabletCartStore.setState({ tableNumber: 'T13', orderType: 'dine_in' });
    const cartBefore = useTabletCartStore.getState();
    const read = vi.fn().mockResolvedValue(5);
    mount(read);
    fireEvent.click(screen.getByRole('button', { name: 'Sync data' }));
    await waitFor(() => expect(notifications.success).toHaveBeenCalledWith('Data synced.'));
    expect(client.getQueryData(['products'])).toBe(5);
    expect(useTabletCartStore.getState()).toBe(cartBefore);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('bloque les doubles appuis et montre un échec sans fausse confirmation', async () => {
    let reject!: (reason: Error) => void;
    const read = vi.fn(() => new Promise<number>((_resolve, fail) => { reject = fail; }));
    mount(read);
    fireEvent.click(screen.getByRole('button', { name: 'Sync data' }));
    const button = await screen.findByRole('button', { name: 'Syncing data' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(1));
    reject(new Error('network'));
    await waitFor(() => expect(notifications.error).toHaveBeenCalled());
    expect(notifications.success).not.toHaveBeenCalled();
    expect(client.getQueryData(['products'])).toBe(2);
  });

  it('reste désactivé hors ligne', () => {
    useCloudStatusStore.setState({ cloudOnline: false });
    const read = vi.fn().mockResolvedValue(5);
    mount(read);
    expect(screen.getByRole('button', { name: 'Sync data' })).toBeDisabled();
    expect(read).not.toHaveBeenCalled();
  });
});
