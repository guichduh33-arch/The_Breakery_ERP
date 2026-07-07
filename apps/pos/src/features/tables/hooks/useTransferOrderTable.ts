// apps/pos/src/features/tables/hooks/useTransferOrderTable.ts
//
// Fiche 02 D2.5 — migration d'une commande active vers une autre table via
// transfer_order_table_v1 (gate pos.sale.create, audit_logs order.table_transfer
// {from,to} → traçabilité vérifiable au BO via le journal d'audit).

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { TABLE_ORDERS_KEY } from './useTableOrders';

export interface TransferOrderTableArgs {
  orderId: string;
  toTable: string;
}

export interface TransferOrderTableResult {
  order_id: string;
  order_number: string;
  from_table: string | null;
  to_table: string;
  noop: boolean;
}

export function useTransferOrderTable() {
  const queryClient = useQueryClient();
  return useMutation<TransferOrderTableResult, Error, TransferOrderTableArgs>({
    mutationFn: async ({ orderId, toTable }) => {
      const { data, error } = await supabase.rpc('transfer_order_table_v1', {
        p_order_id: orderId,
        p_to_table: toTable,
      });
      if (error) throw Object.assign(new Error(error.message), { details: error });
      return data as unknown as TransferOrderTableResult;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['table_occupancy'] });
      void queryClient.invalidateQueries({ queryKey: TABLE_ORDERS_KEY });
    },
  });
}
