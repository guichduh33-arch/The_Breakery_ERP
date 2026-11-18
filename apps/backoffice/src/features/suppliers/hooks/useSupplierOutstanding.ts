// apps/backoffice/src/features/suppliers/hooks/useSupplierOutstanding.ts
//
// S3-07 — Encours et total payé d'un fournisseur, lus dans le grand livre
// `purchase_payments`. Requête dédiée, indépendante du tableau « Purchases »
// (limité à 100 lignes) : la tuile « Unpaid » ne doit jamais être tronquée.
// On pagine par blocs de 1000 pour ne pas dépendre du plafond PostgREST.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import {
  computeSupplierOutstanding,
  sumPayments,
  type SupplierLedgerPo,
  type SupplierOutstandingSummary,
} from '../utils/supplierOutstanding.js';

export const SUPPLIER_OUTSTANDING_QUERY_KEY = ['supplier-outstanding'] as const;

const PAGE_SIZE = 1000;

interface LedgerRow {
  status:               string;
  total_amount:         number | string | null;
  is_historical_import: boolean;
  deleted_at:           string | null;
  purchase_payments:    { amount: number | string | null }[] | null;
}

export function useSupplierOutstanding(supplierId: string | undefined) {
  return useQuery<SupplierOutstandingSummary>({
    queryKey: [...SUPPLIER_OUTSTANDING_QUERY_KEY, supplierId ?? ''] as const,
    enabled:  supplierId !== undefined && supplierId !== '',
    staleTime: 15_000,
    queryFn: async () => {
      if (supplierId === undefined || supplierId === '') {
        return { outstanding: 0, openPoCount: 0, totalPaid: 0 };
      }
      const pos: SupplierLedgerPo[] = [];
      for (let from = 0; ; from += PAGE_SIZE) {
        const { data, error } = await supabase
          .from('purchase_orders')
          .select('status, total_amount, is_historical_import, deleted_at, purchase_payments(amount)')
          .eq('supplier_id', supplierId)
          .is('deleted_at', null)
          .order('id', { ascending: true })
          .range(from, from + PAGE_SIZE - 1);
        if (error !== null) throw error;
        const rows = (data ?? []) as unknown as LedgerRow[];
        for (const r of rows) {
          pos.push({
            status:               r.status,
            total_amount:         r.total_amount,
            is_historical_import: r.is_historical_import,
            deleted_at:           r.deleted_at,
            paid_amount:          sumPayments(r.purchase_payments),
          });
        }
        if (rows.length < PAGE_SIZE) break;
      }
      return computeSupplierOutstanding(pos);
    },
  });
}
