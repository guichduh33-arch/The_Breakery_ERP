// apps/backoffice/src/layouts/usePaletteSearch.ts
//
// Audit UX/UI 2026-08-13 (lot 4) — la palette Ctrl+K cherche désormais des
// ENTITÉS, pas seulement des pages : commandes (RPC search_orders_v1, gate
// orders.read), produits (get_stock_levels_v4 p_search, gate inventory.read),
// clients (PostgREST nom/téléphone/email — le seul chemin couvrant l'email),
// fournisseurs (PostgREST nom/code). Chaque section est gatée côté client par
// la permission que le serveur exigera de toute façon (defense-in-depth : le
// gate réel est serveur), plafonnée à 5 résultats, et validée à la réception —
// une réponse RPC déréférencée sans garde blanchit la page (leçon connue du
// repo). Une section en erreur rend une liste vide, jamais un crash.

import { useQuery } from '@tanstack/react-query';
import { formatCurrency } from '@breakery/utils';
import { supabase } from '@/lib/supabase.js';
import { useAuthStore } from '@/stores/authStore.js';

export interface PaletteHit {
  to: string;
  label: string;
  /**
   * MÉTADONNÉE d'une entité — « paid · Rp 25.000 », un SKU, un téléphone. Ce
   * champ s'appelait `breadcrumb`, ce qu'il n'a jamais été : le fil d'Ariane
   * d'une PAGE est une suite de segments, rendue chevron par chevron par la
   * palette. Renommé le 2026-08-18 pour que les deux ne se confondent plus.
   */
  meta: string;
}

export interface PaletteSection {
  group: string;
  hits: PaletteHit[];
}

const SECTION_LIMIT = 5;
/** En dessous de 2 caractères, aucune requête ne part (même règle que le serveur). */
export const MIN_ENTITY_QUERY = 2;

// PostgREST .or() et ilike sont sensibles aux métacaractères — même scrubbing
// que useCustomersList / useLoyaltyCustomersList.
const OR_FILTER_UNSAFE = /[,()*%_\\]/g;
function sanitizeTerm(term: string): string {
  return term.replace(OR_FILTER_UNSAFE, '').slice(0, 64);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function asString(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

interface UsePaletteSearchResult {
  sections: PaletteSection[];
  /** Au moins une section interrogeable est en cours de chargement. */
  isSearching: boolean;
  /** La requête est assez longue pour interroger les entités. */
  entityQueryActive: boolean;
}

export function usePaletteSearch(rawTerm: string, open: boolean): UsePaletteSearchResult {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const term = sanitizeTerm(rawTerm.trim());
  const active = open && term.length >= MIN_ENTITY_QUERY;

  const canOrders = hasPermission('orders.read');
  const canProducts = hasPermission('inventory.read');
  const canCustomers = hasPermission('customers.read');
  const canSuppliers = hasPermission('suppliers.read');

  const orders = useQuery({
    queryKey: ['palette-search', 'orders', term],
    enabled: active && canOrders,
    staleTime: 30_000,
    queryFn: async (): Promise<PaletteHit[]> => {
      const { data, error } = await supabase.rpc('search_orders_v1', {
        p_query: term,
        p_limit: SECTION_LIMIT,
      });
      if (error) throw error;
      if (!Array.isArray(data)) return [];
      return data.filter(isRecord).flatMap((r) => {
        const id = asString(r.id);
        const num = asString(r.order_number);
        if (id === null || num === null) return [];
        const customer = asString(r.customer_name);
        const status = asString(r.status) ?? '';
        return [{
          to: `/backoffice/orders/${id}`,
          label: `#${num}${customer !== null ? ` — ${customer}` : ''}`,
          meta: `${status} · ${formatCurrency(r.total)}`,
        }];
      });
    },
  });

  const products = useQuery({
    queryKey: ['palette-search', 'products', term],
    enabled: active && canProducts,
    staleTime: 30_000,
    queryFn: async (): Promise<PaletteHit[]> => {
      const { data, error } = await supabase.rpc('get_stock_levels_v4', {
        p_search: term,
        p_limit: SECTION_LIMIT,
        p_offset: 0,
      });
      if (error) throw error;
      if (!Array.isArray(data)) return [];
      return data.filter(isRecord).flatMap((r) => {
        const id = asString(r.product_id);
        const name = asString(r.name);
        if (id === null || name === null) return [];
        const sku = asString(r.sku);
        return [{
          to: `/backoffice/products/${id}`,
          label: name,
          meta: sku ?? '',
        }];
      });
    },
  });

  const customers = useQuery({
    queryKey: ['palette-search', 'customers', term],
    enabled: active && canCustomers,
    staleTime: 30_000,
    queryFn: async (): Promise<PaletteHit[]> => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, phone, email')
        .is('deleted_at', null)
        .or(`name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%`)
        .limit(SECTION_LIMIT);
      if (error) throw error;
      return (data ?? []).map((c) => ({
        to: `/backoffice/customers/${c.id}`,
        label: c.name,
        meta: c.phone ?? c.email ?? '',
      }));
    },
  });

  const suppliers = useQuery({
    queryKey: ['palette-search', 'suppliers', term],
    enabled: active && canSuppliers,
    staleTime: 30_000,
    queryFn: async (): Promise<PaletteHit[]> => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, code')
        .is('deleted_at', null)
        .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
        .limit(SECTION_LIMIT);
      if (error) throw error;
      return (data ?? []).map((s) => ({
        to: `/backoffice/suppliers/${s.id}`,
        label: s.name,
        meta: s.code ?? '',
      }));
    },
  });

  const sections: PaletteSection[] = active
    ? [
        { group: 'Orders', hits: orders.data ?? [] },
        { group: 'Products', hits: products.data ?? [] },
        { group: 'Customers', hits: customers.data ?? [] },
        { group: 'Suppliers', hits: suppliers.data ?? [] },
      ].filter((s) => s.hits.length > 0)
    : [];

  const isSearching =
    active
    && [
      [canOrders, orders.isFetching],
      [canProducts, products.isFetching],
      [canCustomers, customers.isFetching],
      [canSuppliers, suppliers.isFetching],
    ].some(([can, fetching]) => can === true && fetching === true);

  return { sections, isSearching, entityQueryActive: active };
}
