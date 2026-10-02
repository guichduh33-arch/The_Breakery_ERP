import type { QueryClient, QueryKey } from '@tanstack/react-query';
import type { Product } from '@breakery/domain';
import type { ActiveShift } from '@/stores/shiftStore';
import type { POSVariantRow } from '@/features/products/hooks/useProductVariants';
import { validSaleData } from './offlineSaleValidation';

export const SALE_SNAPSHOT_KEY = 'breakery.sale-snapshot.v1';
export interface SaleIdentity { project: string; terminal: string; user: string; session: string }
interface Entry { key: QueryKey; data: unknown; updatedAt: number }
interface Snapshot { version: 1; identity: SaleIdentity; shift: ActiveShift; entries: Entry[] }
const settings = ['offline-network', 'tax-config', 'enabled-payment-methods'];

/** Le manifeste couvre aussi les produits jamais ouverts dans une modale. */
export function saleKeys(client: QueryClient): QueryKey[] | null {
  const products = client.getQueryData<Product[]>(['products']);
  if (!Array.isArray(products)) return null;
  const stations = client.getQueryData<Record<string, unknown>>(['station-map']);
  if (!validSaleData(['station-map'], stations)) return null;
  const hasRouting = (id: string) => Object.prototype.hasOwnProperty.call(stations, id);
  const keys: QueryKey[] = [['products'], ['categories'], ['station-map'], ['promotions', 'active'], ...settings.map((key) => ['business-config', key])];
  for (const product of products) {
    if (!product || typeof product.id !== 'string' || !hasRouting(product.id)) return null;
    keys.push(['product-modifiers', product.id, product.category_id]);
    if (product.product_type === 'combo') keys.push(['combo-config', product.id]);
    if (product.has_variants) {
      const variantKey = ['pos-product-variants', product.id];
      keys.push(variantKey);
      const variants = client.getQueryData<POSVariantRow[]>(variantKey);
      if (!Array.isArray(variants)) return null;
      for (const variant of variants) {
        if (!variant || typeof variant.id !== 'string' || !hasRouting(variant.id)) return null;
        keys.push(['product-modifiers', variant.id, product.category_id]);
      }
    }
  }
  return keys;
}

function validShift(value: ActiveShift | null): value is ActiveShift {
  return Boolean(value && typeof value.id === 'string' && typeof value.opened_at === 'string'
    && value.id.length > 0 && Number.isFinite(Date.parse(value.opened_at)) && Number.isFinite(value.opening_cash));
}

/** Un jeu partiel n'écrase jamais un instantané complet. Aucune valeur de repli n'est persistée. */
export function saveSaleSnapshot(storage: Storage, client: QueryClient, identity: SaleIdentity, shift: ActiveShift | null): boolean {
  const keys = saleKeys(client);
  if (!keys || !validShift(shift)) return false;
  const entries: Entry[] = [];
  for (const key of keys) {
    const state = client.getQueryState(key);
    if (state?.status !== 'success' || !validSaleData(key, state.data) || !state.dataUpdatedAt) return false;
    entries.push({ key, data: state.data, updatedAt: state.dataUpdatedAt });
  }
  try {
    storage.setItem(SALE_SNAPSHOT_KEY, JSON.stringify({ version: 1, identity, shift, entries } satisfies Snapshot));
    return true;
  } catch { return false; }
}

export function clearSaleSnapshot(storage: Storage): void {
  try { storage.removeItem(SALE_SNAPSHOT_KEY); } catch { /* Stockage indisponible : aucune reprise. */ }
}

/** Le caller doit avoir validé l'authentification locale et le reload du même onglet. */
export function restoreSaleSnapshot(storage: Storage, client: QueryClient, identity: SaleIdentity): ActiveShift | null {
  try {
    const snapshot = JSON.parse(storage.getItem(SALE_SNAPSHOT_KEY) ?? 'null') as Snapshot | null;
    if (snapshot?.version !== 1 || !validShift(snapshot.shift)
      || !snapshot.identity || Object.keys(identity).some((key) => snapshot.identity[key as keyof SaleIdentity] !== identity[key as keyof SaleIdentity])
      || !Array.isArray(snapshot.entries)) return null;
    // Valider le manifeste avant de toucher le cache consommé par les écrans.
    const entries = new Map(snapshot.entries.map((entry) => [JSON.stringify(entry.key), entry]));
    if (entries.size !== snapshot.entries.length) return null;
    const staging = {
      getQueryData: (key: QueryKey) => entries.get(JSON.stringify(key))?.data,
    } as QueryClient;
    const required = saleKeys(staging);
    if (required?.length !== entries.size) return null;
    for (const key of required) {
      const entry = entries.get(JSON.stringify(key));
      if (!entry?.updatedAt || !validSaleData(key, entry.data) || !Number.isFinite(entry.updatedAt) || entry.updatedAt <= 0) return null;
    }
    for (const entry of entries.values()) client.setQueryData(entry.key, entry.data, { updatedAt: entry.updatedAt });
    client.setQueryData(['pos_sessions', 'current', identity.user], snapshot.shift, { updatedAt: 1 });
    return snapshot.shift;
  } catch { return null; }
}
