// apps/backoffice/src/features/inventory-opname/hooks/useOpnameMutations.ts
// Session 13 / Phase 2.D — Mutations for the opname lifecycle.
//
// All call the RPCs created in migration 20260517000091. RPC return shapes
// are loose JSONB; we use `unknown` + a thin client-side type for the
// happy-path payload.

import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { OPNAME_LIST_QUERY_KEY } from './useOpnameList.js';
import { opnameDetailKey } from './useOpnameDetail.js';

type RpcFn = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

function rpc(): RpcFn {
  return supabase.rpc.bind(supabase) as unknown as RpcFn;
}

// ─────────────────────────────────────────────────────────────────────────────
// create_opname_v1
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateOpnameArgs {
  sectionId: string;
  notes?:    string | undefined;
}

export interface CreateOpnameResult {
  count_id:      string;
  count_number:  string;
  status:        string;
}

export function useCreateOpname() {
  const qc = useQueryClient();
  // Idempotency key held across retries; rotated on success so the next opname
  // gets a fresh key while a network retry of THIS create replays server-side.
  const idemKey = useRef<string>(crypto.randomUUID());
  return useMutation<CreateOpnameResult, Error, CreateOpnameArgs>({
    mutationFn: async (args) => {
      const { data, error } = await rpc()('create_opname_v1', {
        p_section_id: args.sectionId,
        p_idempotency_key: idemKey.current,
        ...(args.notes !== undefined && args.notes.trim() !== '' ? { p_notes: args.notes.trim() } : {}),
      });
      if (error !== null) throw new Error(error.message);
      return data as CreateOpnameResult;
    },
    onSuccess: async () => {
      idemKey.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: OPNAME_LIST_QUERY_KEY });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// add_opname_item_v1
// ─────────────────────────────────────────────────────────────────────────────

export interface AddOpnameItemArgs {
  countId:     string;
  productId:   string;
  expectedQty?: number | undefined;
  notes?:      string | undefined;
}

export function useAddOpnameItem() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, AddOpnameItemArgs>({
    mutationFn: async (args) => {
      const { data, error } = await rpc()('add_opname_item_v1', {
        p_count_id: args.countId,
        p_product_id: args.productId,
        ...(args.expectedQty !== undefined ? { p_expected_qty: args.expectedQty } : {}),
        ...(args.notes !== undefined && args.notes.trim() !== '' ? { p_notes: args.notes.trim() } : {}),
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async (_data, args) => {
      await qc.invalidateQueries({ queryKey: opnameDetailKey(args.countId) });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// set_opname_count_v1
// ─────────────────────────────────────────────────────────────────────────────

export interface SetOpnameCountArgs {
  countId:     string;
  countItemId: string;
  countedQty:  number;
  notes?:      string | undefined;
}

export function useSetOpnameCount() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, SetOpnameCountArgs>({
    mutationFn: async (args) => {
      const { data, error } = await rpc()('set_opname_count_v1', {
        p_count_item_id: args.countItemId,
        p_counted_qty: args.countedQty,
        ...(args.notes !== undefined && args.notes.trim() !== '' ? { p_notes: args.notes.trim() } : {}),
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async (_d, args) => {
      await qc.invalidateQueries({ queryKey: opnameDetailKey(args.countId) });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// validate_opname_v1 (counting → review)
// ─────────────────────────────────────────────────────────────────────────────

export function useValidateOpname() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, { countId: string }>({
    mutationFn: async ({ countId }) => {
      const { data, error } = await rpc()('validate_opname_v1', { p_count_id: countId });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async (_d, args) => {
      await qc.invalidateQueries({ queryKey: opnameDetailKey(args.countId) });
      await qc.invalidateQueries({ queryKey: OPNAME_LIST_QUERY_KEY });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// finalize_opname_v1
// ─────────────────────────────────────────────────────────────────────────────

export interface FinalizeOpnameResult {
  count_id:           string;
  count_number:       string;
  status:             string;
  movements_emitted:  number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- shape lives in JSONB
  movements:          any[];
  idempotent_replay:  boolean;
}

export function useFinalizeOpname() {
  const qc = useQueryClient();
  // Idempotency key held across retries; rotated on success. finalize_opname_v1
  // is also status-locked server-side, but a stable key makes the replay explicit.
  const idemKey = useRef<string>(crypto.randomUUID());
  return useMutation<FinalizeOpnameResult, Error, { countId: string }>({
    mutationFn: async ({ countId }) => {
      const { data, error } = await rpc()('finalize_opname_v1', {
        p_count_id: countId,
        p_idempotency_key: idemKey.current,
      });
      if (error !== null) throw new Error(error.message);
      return data as FinalizeOpnameResult;
    },
    onSuccess: async (_d, args) => {
      idemKey.current = crypto.randomUUID();
      await qc.invalidateQueries({ queryKey: opnameDetailKey(args.countId) });
      await qc.invalidateQueries({ queryKey: OPNAME_LIST_QUERY_KEY });
      await qc.invalidateQueries({ queryKey: ['stock-levels'] });
    },
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// cancel_opname_v1
// ─────────────────────────────────────────────────────────────────────────────

export interface CancelOpnameArgs {
  countId: string;
  reason:  string;
}

export function useCancelOpname() {
  const qc = useQueryClient();
  return useMutation<unknown, Error, CancelOpnameArgs>({
    mutationFn: async (args) => {
      const { data, error } = await rpc()('cancel_opname_v1', {
        p_count_id: args.countId,
        p_reason: args.reason,
      });
      if (error !== null) throw new Error(error.message);
      return data;
    },
    onSuccess: async (_d, args) => {
      await qc.invalidateQueries({ queryKey: opnameDetailKey(args.countId) });
      await qc.invalidateQueries({ queryKey: OPNAME_LIST_QUERY_KEY });
    },
  });
}
