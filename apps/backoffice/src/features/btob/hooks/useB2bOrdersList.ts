// apps/backoffice/src/features/btob/hooks/useB2bOrdersList.ts
//
// La liste des commandes B2B — régime FENÊTRÉ, filtres et tri SERVEUR.
//
// ── Pourquoi un hook NEUF, et pas un argument de plus sur `useB2bInvoices` ───
//
// `useB2bInvoices` a trois appelants. Deux d'entre eux — `RecordB2bPaymentModal`
// et `B2bInvoicesTab` — dépendent de son ordre `invoice_date` ASCENDANT, qui est
// l'ordre d'IMPUTATION FIFO des règlements côté serveur. Y greffer un tri ou une
// tranche mettrait un écran d'argent à la merci d'un défaut d'appel : un
// paramètre oublié, et la modale de règlement proposerait d'imputer sur les
// factures dans le mauvais ordre. Les deux régimes de lecture sont donc deux
// fonctions, et `useB2bInvoices` n'est pas touché.
//
// ── Pourquoi fenêtré, alors qu'il y a onze factures aujourd'hui ─────────────
//
// L'ancien écran lisait `.limit(500)` et affichait « N of N » calculé sur ce
// qu'il avait reçu. Ce n'est pas un défaut de présentation : au-delà de 500
// commandes le pied MENT sur le total, et les quatre compteurs de la bande
// comptent 500 lignes en se présentant comme le tout. À vingt commandes B2B par
// mois, le plafond tombe en deux ans — et il tombe SANS RIEN DIRE.
//
// Le régime retenu est celui d'`OrdersListPage` : progression par fenêtres, pied
// qui déclare le CHARGÉ contre l'EXISTANT. Pas de pages numérotées : « page 7 »
// d'un flux qui bouge n'est pas une adresse stable — une commande créée pendant
// la lecture décale tout ce qui suit.
//
// ── Ce que la base fournit déjà ─────────────────────────────────────────────
//
// AUCUNE migration, aucun bump de RPC. `view_b2b_invoices` est une vue
// `security_invoker` lue par PostgREST : `.range()`, `{ count: 'exact' }`,
// `.or(…ilike…)` et `.order()` sont des capacités de l'existant. La RLS suit
// l'appelant, comme avant.

import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_INVOICES_QUERY_KEY, type B2bInvoiceRow } from './useB2bInvoices.js';

/** Colonnes triables — celles que la VUE porte telles qu'on les AFFICHE. */
export type B2bOrdersSortColumn = 'invoice_date' | 'order_number' | 'invoice_total';
export type B2bOrdersSortDir = 'asc' | 'desc';
export type B2bPaymentFilter = 'all' | 'unpaid' | 'paid';

export const B2B_ORDERS_SORT_COLUMNS: readonly B2bOrdersSortColumn[] =
  ['invoice_date', 'order_number', 'invoice_total'];

/**
 * Taille de fenêtre. 50, comme `useOrdersList` : assez pour que le premier
 * chargement couvre la lecture ordinaire, assez peu pour qu'il reste court.
 */
export const B2B_ORDERS_PAGE_SIZE = 50;

const COLS =
  'invoice_id, order_number, invoice_number, customer_id, b2b_company_name, ' +
  'customer_name, invoice_total, invoice_date, paid_at, order_status, age_days, ' +
  'is_unpaid, amount_paid, outstanding, pickup_date';

/**
 * Une recherche part dans une chaîne de filtre PostgREST où la virgule sépare
 * les termes et la parenthèse groupe. Un client nommé « Ayu, Warung (Bali) »
 * casserait donc le filtre — au mieux une erreur, au pire un prédicat autre que
 * celui qu'on croit poser. On retire les caractères STRUCTURELS et les jokers,
 * plutôt que d'espérer un échappement correct à travers deux couches.
 */
export function sanitizeB2bSearch(raw: string): string {
  return raw.replace(/[,()*%\\."']/g, ' ').trim().slice(0, 64);
}

export interface B2bOrdersListParams {
  payment: B2bPaymentFilter;
  search:  string;
  sort:    B2bOrdersSortColumn;
  dir:     B2bOrdersSortDir;
}

export interface B2bOrdersListPage {
  rows: B2bInvoiceRow[];
  /** Nombre de lignes qui EXISTENT sous ces filtres, tout serveur confondu. */
  total: number;
}

export function useB2bOrdersList(params: B2bOrdersListParams) {
  return useInfiniteQuery<B2bOrdersListPage, Error>({
    queryKey: [...B2B_INVOICES_QUERY_KEY, 'orders-list', params],
    staleTime: 15_000,
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      const offset = pageParam as number;
      let q = supabase
        .from('view_b2b_invoices')
        .select(COLS, { count: 'exact' })
        .order(params.sort, { ascending: params.dir === 'asc' })
        // Départage STABLE : à `invoice_date` égal (deux commandes du même
        // instant, ou tri par montant), l'ordre serait sinon libre côté
        // Postgres — et une fenêtre suivante pourrait rendre une ligne déjà
        // affichée ou en sauter une.
        .order('invoice_id', { ascending: true })
        .range(offset, offset + B2B_ORDERS_PAGE_SIZE - 1);

      if (params.payment === 'unpaid') q = q.gt('outstanding', 0);
      else if (params.payment === 'paid') q = q.lte('outstanding', 0);

      const needle = sanitizeB2bSearch(params.search);
      if (needle !== '') {
        // Par CLIENT et par NUMÉRO DE COMMANDE : c'est l'écran où l'on poursuit
        // un impayé nommé. Le numéro de facture suit, c'est la même poursuite
        // depuis le document plutôt que depuis la commande.
        q = q.or(
          `order_number.ilike.%${needle}%,` +
          `invoice_number.ilike.%${needle}%,` +
          `b2b_company_name.ilike.%${needle}%,` +
          `customer_name.ilike.%${needle}%`,
        );
      }

      const { data, error, count } = await q;
      if (error) throw error as Error;
      return {
        rows: (data ?? []) as unknown as B2bInvoiceRow[],
        total: count ?? 0,
      };
    },
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((n, p) => n + p.rows.length, 0);
      return loaded >= lastPage.total ? undefined : loaded;
    },
  });
}
