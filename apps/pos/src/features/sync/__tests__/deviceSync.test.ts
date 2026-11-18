import { QueryClient, QueryObserver, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCloudStatusStore } from '@/features/lan/cloudStatusStore';
import { syncDeviceData } from '../deviceSync';

let client: QueryClient;
const stops: (() => void)[] = [];

function active(key: string, queryFn: () => Promise<number>, enabled = true) {
  const observer = new QueryObserver(client, {
    queryKey: [key], queryFn, initialData: 2, staleTime: Infinity, enabled,
  });
  stops.push(observer.subscribe(() => undefined));
  return observer;
}

function preload(queryKey: string[], queryFn: () => Promise<unknown>, updatedAt = Date.now()) {
  const observer = new QueryObserver(client, {
    queryKey, queryFn, initialData: [], initialDataUpdatedAt: updatedAt, staleTime: Infinity,
  });
  stops.push(observer.subscribe(() => undefined));
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  onlineManager.setOnline(true);
  useCloudStatusStore.setState({ cloudOnline: true });
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
});

afterEach(() => {
  stops.splice(0).forEach((stop) => stop());
  client.clear();
  vi.restoreAllMocks();
});

describe('device data sync', () => {
  it('relit un stock encore frais et marque les écrans fermés périmés', async () => {
    const read = vi.fn().mockResolvedValue(5);
    active('products', read);
    const disabledRead = vi.fn().mockResolvedValue(9);
    active('disabled', disabledRead, false);
    client.setQueryData(['inactive-stock'], 7);
    const mutation = vi.fn();
    client.getMutationCache().build(client, { mutationFn: mutation });

    expect(await syncDeviceData(client)).toBe('success');
    expect(read).toHaveBeenCalledTimes(1);
    expect(client.getQueryData(['products'])).toBe(5);
    expect(client.getQueryState(['inactive-stock'])?.isInvalidated).toBe(true);
    expect(disabledRead).not.toHaveBeenCalled();
    expect(mutation).not.toHaveBeenCalled();
  });

  it('partage une seule relecture entre les doubles appuis et le timer', async () => {
    let finish!: (value: number) => void;
    const read = vi.fn(() => new Promise<number>((resolve) => { finish = resolve; }));
    active('products', read);
    const first = syncDeviceData(client);
    const second = syncDeviceData(client);
    expect(second).toBe(first);
    await Promise.resolve();
    expect(read).toHaveBeenCalledTimes(1);
    finish(8);
    expect(await first).toBe('success');
  });

  it('attend les lectures et signale un échec partiel sans effacer le cache', async () => {
    active('products', () => Promise.reject(new Error('network')));
    let finish!: (value: number) => void;
    active('settings', () => new Promise<number>((resolve) => { finish = resolve; }));
    const result = syncDeviceData(client);
    await Promise.resolve();
    finish(6);
    expect(await result).toBe('error');
    expect(client.getQueryData(['products'])).toBe(2);
    expect(client.getQueryData(['settings'])).toBe(6);
  });

  it('ne lance aucune lecture si le WAN est coupé malgré le Wi-Fi connecté', async () => {
    const read = vi.fn().mockResolvedValue(5);
    active('products', read);
    useCloudStatusStore.setState({ cloudOnline: false });
    expect(await syncDeviceData(client)).toBe('offline');
    expect(read).not.toHaveBeenCalled();
    expect(client.getQueryData(['products'])).toBe(2);
  });

  // Prod 2026-11-18 : l'écran de vente monte une query cachée par produit
  // (~290). Le filet de 30 s les relisait toutes à chaque tour.
  it('en arrière-plan, ne relit pas les préchargements par produit encore récents', async () => {
    const modifiers = vi.fn().mockResolvedValue([]);
    const combo = vi.fn().mockResolvedValue({});
    const products = vi.fn().mockResolvedValue(5);
    preload(['product-modifiers', 'p1', 'c1'], modifiers);
    preload(['combo-config', 'meal'], combo);
    active('products', products);

    expect(await syncDeviceData(client, { mode: 'background' })).toBe('success');
    expect(products).toHaveBeenCalledTimes(1);
    expect(modifiers).not.toHaveBeenCalled();
    expect(combo).not.toHaveBeenCalled();
    expect(client.getQueryState(['product-modifiers', 'p1', 'c1'])?.isInvalidated).toBe(false);
  });

  it('en arrière-plan, relit un préchargement par produit vieux de 5 minutes', async () => {
    const modifiers = vi.fn().mockResolvedValue([]);
    preload(['product-modifiers', 'p1', 'c1'], modifiers, Date.now() - 5 * 60_000);
    expect(await syncDeviceData(client, { mode: 'background' })).toBe('success');
    expect(modifiers).toHaveBeenCalledTimes(1);
  });

  it('le bouton de synchronisation relit tout, préchargements compris', async () => {
    const modifiers = vi.fn().mockResolvedValue([]);
    preload(['product-modifiers', 'p1', 'c1'], modifiers);
    expect(await syncDeviceData(client)).toBe('success');
    expect(modifiers).toHaveBeenCalledTimes(1);
  });

  it('un appui manuel pendant un passage de fond relit ensuite les préchargements', async () => {
    let finish!: (value: number) => void;
    const products = vi.fn()
      .mockImplementationOnce(() => new Promise<number>((resolve) => { finish = resolve; }))
      .mockResolvedValue(5);
    active('products', products);
    const modifiers = vi.fn().mockResolvedValue([]);
    preload(['product-modifiers', 'p1', 'c1'], modifiers);
    const background = syncDeviceData(client, { mode: 'background' });
    const manual = syncDeviceData(client);
    await Promise.resolve();
    expect(modifiers).not.toHaveBeenCalled();
    finish(4);
    expect(await background).toBe('success');
    expect(await manual).toBe('success');
    expect(products).toHaveBeenCalledTimes(2);
    expect(modifiers).toHaveBeenCalledTimes(1);
  });

  it('ne tient pas pour récent un préchargement daté dans le futur', async () => {
    const modifiers = vi.fn().mockResolvedValue([]);
    preload(['product-modifiers', 'p1', 'c1'], modifiers, Date.now() + 60_000);
    expect(await syncDeviceData(client, { mode: 'background' })).toBe('success');
    expect(modifiers).toHaveBeenCalledTimes(1);
  });

  it('ne prétend pas réussir quand la connexion est perdue pendant la lecture', async () => {
    active('products', () => {
      useCloudStatusStore.setState({ cloudOnline: false });
      return Promise.resolve(3);
    });
    expect(await syncDeviceData(client)).toBe('offline');
  });
});
