// apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts
//
// Session 24 / Phase 2.A.3 — call create_b2b_order_v4 (S68 migration _130: assigns a
// dedicated annual-continuous invoice_number at creation; S52 TOCTOU fix preserved:
// credit re-checked after the customer FOR UPDATE lock).
//
// The RPC creates a B2B order in status='b2b_pending' with paid_at=NULL,
// emits the JE (DR B2B_AR / CR SALE_B2B_REVENUE), decrements stock and
// bumps customers.b2b_current_balance. Gate validate_b2b_credit_limit_v1
// raises 'credit_limit_exceeded' (P0011) when the proposed order would
// push the customer over its credit_limit — we surface the DETAIL payload
// to the caller so the UI can show would_exceed_by.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { B2B_DASHBOARD_QUERY_KEY } from './useB2bDashboard.js';

export type CreateB2bOrderErrorCode =
  | 'not_authenticated'
  | 'permission_denied'
  | 'items_required'
  | 'customer_not_found'
  | 'customer_not_b2b'
  | 'product_not_found'
  | 'insufficient_stock'
  | 'invalid_quantity'
  | 'invalid_unit_price'
  | 'invalid_total'
  | 'credit_limit_exceeded'
  | 'fiscal_period_closed'
  | 'unknown';

// Mirrors the validate_b2b_credit_limit_v1 jsonb payload exactly
// (migration 20260517000131). NOTE: the RPC does NOT echo the proposed order
// amount; `available` is the remaining credit (limit - current_balance).
export interface CreditLimitExceededPayload {
  allowed:           boolean;
  customer_type:     string;
  current_balance:   number;
  credit_limit:      number | null;
  available:         number | null;
  would_exceed_by:   number | null;
}

export class CreateB2bOrderError extends Error {
  payload?: CreditLimitExceededPayload;
  constructor(public code: CreateB2bOrderErrorCode, message?: string, payload?: CreditLimitExceededPayload) {
    super(message ?? code);
    this.name = 'CreateB2bOrderError';
    if (payload) this.payload = payload;
  }
}

export interface B2bOrderItemInput {
  product_id: string;
  quantity:   number;
  unit_price: number;
}

export interface CreateB2bOrderArgs {
  customerId:      string;
  items:           B2bOrderItemInput[];
  notes?:          string;
  deliveryDate?:   string;          // ISO date YYYY-MM-DD
  idempotencyKey:  string;
}

export interface CreateB2bOrderResult {
  order_id:          string;
  order_number:      string;
  invoice_number:    string;
  total:             number;
  credit_after:      number;
  je_id:             string;
  idempotent_replay: boolean;
}

export function classify(message: string): CreateB2bOrderErrorCode {
  if (message.includes('credit_limit_exceeded'))   return 'credit_limit_exceeded';
  if (message.includes('insufficient_stock'))      return 'insufficient_stock';
  if (message.includes('product_not_found'))       return 'product_not_found';
  if (message.includes('customer_not_b2b'))        return 'customer_not_b2b';
  if (message.includes('customer_not_found'))      return 'customer_not_found';
  if (message.includes('items_required'))          return 'items_required';
  if (message.includes('invalid_quantity'))        return 'invalid_quantity';
  if (message.includes('invalid_unit_price'))      return 'invalid_unit_price';
  if (message.includes('invalid_total'))           return 'invalid_total';
  if (message.includes('permission_denied'))       return 'permission_denied';
  if (message.includes('not_authenticated'))       return 'not_authenticated';
  if (message.includes('fiscal_period'))           return 'fiscal_period_closed';
  // S54 fail-closed guard: 'period_undefined: no fiscal period covers <date>'
  if (message.includes('period_undefined') || message.includes('no fiscal period')) {
    return 'fiscal_period_closed';
  }
  return 'unknown';
}

function parseCreditPayload(detail: string | null | undefined): CreditLimitExceededPayload | undefined {
  if (detail === null || detail === undefined || detail === '') return undefined;
  try {
    const parsed = JSON.parse(detail) as unknown;
    if (typeof parsed === 'object' && parsed !== null && 'allowed' in parsed) {
      return parsed as CreditLimitExceededPayload;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function useCreateB2bOrder() {
  const qc = useQueryClient();
  return useMutation<CreateB2bOrderResult, CreateB2bOrderError, CreateB2bOrderArgs>({
    mutationFn: async (args) => {
      const rpcArgs: {
        p_customer_id:     string;
        p_items:           unknown;
        p_notes?:          string;
        p_delivery_date?:  string;
        p_idempotency_key: string;
      } = {
        p_customer_id:     args.customerId,
        p_items:           args.items as unknown,
        p_idempotency_key: args.idempotencyKey,
      };
      if (args.notes        !== undefined && args.notes.trim() !== '') rpcArgs.p_notes        = args.notes.trim();
      if (args.deliveryDate !== undefined && args.deliveryDate     !== '') rpcArgs.p_delivery_date = args.deliveryDate;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase.rpc('create_b2b_order_v4', rpcArgs as any);
      if (error) {
        const code = classify(error.message);
        // Supabase exposes Postgres DETAIL on `error.details` (snake_case differs by SDK version);
        // try both common surfaces and fall back undefined.
        const detail = (error as unknown as { details?: string | null; detail?: string | null }).details
                    ?? (error as unknown as { details?: string | null; detail?: string | null }).detail
                    ?? null;
        const payload = code === 'credit_limit_exceeded' ? parseCreditPayload(detail) : undefined;
        throw new CreateB2bOrderError(code, error.message, payload);
      }
      if (data === null) throw new CreateB2bOrderError('unknown', 'Empty RPC response');
      return data as unknown as CreateB2bOrderResult;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: B2B_DASHBOARD_QUERY_KEY }),
        qc.invalidateQueries({ queryKey: ['customers'] }),
      ]);
    },
  });
}
