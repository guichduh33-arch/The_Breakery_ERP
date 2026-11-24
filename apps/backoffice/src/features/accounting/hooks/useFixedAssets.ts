// apps/backoffice/src/features/accounting/hooks/useFixedAssets.ts
//
// ADR-047 — registre des équipements. Lectures sous `reports.statements.read`
// (gate serveur, 42501 sinon) ; inscription d'un équipement déjà au bilan et
// sortie sous `accounting.fixed_assets.manage`. Le serveur calcule tout :
// dotations, cumul, valeur nette, résultat de sortie. L'écran ne fait qu'afficher.
//
// Sortie : le PIN manager est un ARGUMENT de la RPC, vérifiée avec verrouillage.
// Un PIN faux REVIENT en { ok:false, error:'invalid_pin' } (une exception
// annulerait le compteur d'échecs) ; les autres refus lèvent avec leur code.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Database } from '@breakery/supabase';
import { supabase } from '@/lib/supabase.js';
import { JOURNAL_ENTRIES_KEY } from './useJournalEntries.js';
import {
  parseFixedAssetDetail,
  parseFixedAssets,
  type FixedAssetDetail,
  type FixedAssetDisposalReason,
  type FixedAssetRow,
  type FixedAssetTaxGroup,
  type FixedAssetType,
} from '../components/fixedAssetContract.js';

type Fns = Database['public']['Functions'];
/** Les types générés ne savent pas qu'un argument SQL sans défaut accepte NULL. */
type Nullable<T> = { [K in keyof T]: T[K] | null };

export const FIXED_ASSETS_KEY = ['accounting', 'fixed-assets'] as const;
export const fixedAssetDetailKey = (id: string) => [...FIXED_ASSETS_KEY, 'detail', id] as const;

export function useFixedAssets() {
  return useQuery<FixedAssetRow[]>({
    queryKey: FIXED_ASSETS_KEY,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_fixed_assets_v1');
      if (error) throw new Error(error.message);
      return parseFixedAssets(data);
    },
  });
}

export function useFixedAsset(id: string) {
  return useQuery<FixedAssetDetail>({
    queryKey: fixedAssetDetailKey(id),
    enabled: id !== '',
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_fixed_asset_v1', { p_asset_id: id });
      if (error) throw new Error(error.message);
      return parseFixedAssetDetail(data);
    },
  });
}

// ---------------------------------------------------------------------------
// Refus serveur → code connu → phrase lisible
// ---------------------------------------------------------------------------
const KNOWN = [
  'invalid_pin', 'pin_required', 'account_locked',
  'period_locked', 'period_undefined',
  'fixed_asset_not_found', 'fixed_asset_already_disposed', 'fixed_asset_disposal_date_invalid',
  'fixed_asset_disposal_before_posted_depreciation', 'fixed_asset_disposal_before_opening_balance',
  'fixed_asset_sale_price_invalid',
  'fixed_asset_proceeds_account_invalid', 'fixed_asset_sale_fields_only_for_sale',
  'fixed_asset_disposal_reason_required', 'fixed_asset_disposal_notes_too_long',
  'fixed_asset_name_invalid', 'fixed_asset_type_and_group_required', 'fixed_asset_cost_invalid',
  'fixed_asset_accumulated_invalid', 'fixed_asset_as_of_must_be_month_end',
  'fixed_asset_in_service_after_as_of', 'fixed_asset_as_of_in_future',
  'idempotency_key_conflict', 'missing_permission',
] as const;
export type FixedAssetErrorCode = (typeof KNOWN)[number] | 'unknown';

export class FixedAssetError extends Error {
  constructor(public readonly code: FixedAssetErrorCode, message: string) {
    super(message);
    this.name = 'FixedAssetError';
  }
}

// Les refus de période portent un suffixe (« period_locked: date … ») et le
// refus de droit est préfixé du nom de la fonction : on cherche le code dans
// le message, le plus long d'abord pour qu'un code n'en masque pas un autre.
const BY_LENGTH = [...KNOWN].sort((a, b) => b.length - a.length);
function codeOf(message: string): FixedAssetErrorCode {
  if (message.includes('missing permission')) return 'missing_permission';
  return BY_LENGTH.find((code) => message.includes(code)) ?? 'unknown';
}

export function fixedAssetErrorMessage(err: unknown): string {
  const code = err instanceof FixedAssetError ? err.code : 'unknown';
  switch (code) {
    case 'invalid_pin':
    case 'pin_required':
      return 'Wrong PIN. Try again.';
    case 'account_locked':
      return 'Account locked after too many wrong PINs. Try again later.';
    case 'period_locked':
    case 'period_undefined':
      return 'The accounting period of this date is closed or not defined. Pick another date or reopen the period.';
    case 'fixed_asset_not_found':
      return 'This asset no longer exists.';
    case 'fixed_asset_already_disposed':
      return 'This asset is already disposed.';
    case 'fixed_asset_disposal_date_invalid':
      return 'The disposal date must be between the in-service date and today.';
    case 'fixed_asset_disposal_before_posted_depreciation':
      return 'Depreciation is already posted for this month or later. Pick a later disposal date.';
    case 'fixed_asset_disposal_before_opening_balance':
      return 'The disposal date must be after the date of the opening accumulated depreciation.';
    case 'fixed_asset_sale_price_invalid':
      return 'Enter a sale price above zero, with at most two decimals.';
    case 'fixed_asset_proceeds_account_invalid':
      return 'Pick an active cash or bank account to receive the sale price.';
    case 'fixed_asset_sale_fields_only_for_sale':
      return 'A price and a receiving account only apply to a sale.';
    case 'fixed_asset_disposal_reason_required':
      return 'Pick a disposal reason.';
    case 'fixed_asset_disposal_notes_too_long':
      return 'Notes are limited to 500 characters.';
    case 'fixed_asset_name_invalid':
      return 'The name must be 2 to 120 characters.';
    case 'fixed_asset_type_and_group_required':
      return 'Pick a type and a tax group.';
    case 'fixed_asset_cost_invalid':
      return 'Enter a cost above zero, with at most two decimals.';
    case 'fixed_asset_accumulated_invalid':
      return 'Accumulated depreciation must be between zero and the cost.';
    case 'fixed_asset_as_of_must_be_month_end':
      return 'The accumulated depreciation date must be the last day of a month.';
    case 'fixed_asset_in_service_after_as_of':
      return 'The in-service date must be on or before the accumulated depreciation date.';
    case 'fixed_asset_as_of_in_future':
      return 'The accumulated depreciation date cannot be in the future.';
    case 'idempotency_key_conflict':
      return 'This request was already used by someone else. Close the window and start again.';
    case 'missing_permission':
      return 'You do not have the permission to manage fixed assets.';
    default:
      return 'The change is not confirmed. Check the connection and try again.';
  }
}

function body(data: unknown): Record<string, unknown> {
  return typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
}

// ---------------------------------------------------------------------------
// Inscription d'un équipement déjà au bilan
// ---------------------------------------------------------------------------
export interface RegisterExistingAssetInput {
  name: string;
  assetType: FixedAssetType;
  taxGroup: FixedAssetTaxGroup;
  inServiceDate: string;
  cost: number;
  accumulated: number;
  accumulatedAsOf: string;
  /** Stable pour une ouverture de la fenêtre : un nouvel essai rejoue, il ne double pas. */
  idempotencyKey: string;
}

export interface RegisterExistingAssetResult {
  assetId: string;
  assetNumber: string;
  replay: boolean;
}

export function useRegisterExistingFixedAsset() {
  const qc = useQueryClient();
  return useMutation<RegisterExistingAssetResult, FixedAssetError, RegisterExistingAssetInput>({
    retry: false,
    mutationFn: async (input) => {
      const args: Fns['register_existing_fixed_asset_v1']['Args'] = {
        p_name: input.name.trim(),
        p_asset_type: input.assetType,
        p_tax_group: input.taxGroup,
        p_in_service_date: input.inServiceDate,
        p_cost: input.cost,
        p_accumulated: input.accumulated,
        p_accumulated_as_of: input.accumulatedAsOf,
        p_idempotency_key: input.idempotencyKey,
      };
      const { data, error } = await supabase.rpc('register_existing_fixed_asset_v1', args);
      if (error) throw new FixedAssetError(codeOf(error.message), error.message);
      const b = body(data);
      if (typeof b.asset_id !== 'string' || typeof b.asset_number !== 'string') {
        throw new FixedAssetError('unknown', 'registration_not_confirmed');
      }
      return { assetId: b.asset_id, assetNumber: b.asset_number, replay: b.idempotent_replay === true };
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: FIXED_ASSETS_KEY });
    },
  });
}

// ---------------------------------------------------------------------------
// Sortie (vente, casse, rebut)
// ---------------------------------------------------------------------------
export interface DisposeFixedAssetInput {
  assetId: string;
  disposalDate: string;
  reason: FixedAssetDisposalReason;
  /** Vente seulement ; NULL hors vente (le serveur refuse sinon). */
  salePrice: number | null;
  proceedsAccountId: string | null;
  notes: string;
  managerPin: string;
}

export interface DisposeFixedAssetResult {
  entryNumber: string;
  accumulatedDepreciation: number;
  netBookValue: number;
  salePrice: number;
  result: number;
}

export function useDisposeFixedAsset() {
  const qc = useQueryClient();
  return useMutation<DisposeFixedAssetResult, FixedAssetError, DisposeFixedAssetInput>({
    retry: false,
    mutationFn: async (input) => {
      const isSale = input.reason === 'sale';
      const args: Nullable<Fns['dispose_fixed_asset_v1']['Args']> = {
        p_asset_id: input.assetId,
        p_disposal_date: input.disposalDate,
        p_reason: input.reason,
        p_sale_price: isSale ? input.salePrice : null,
        p_proceeds_account_id: isSale ? input.proceedsAccountId : null,
        p_notes: input.notes.trim() === '' ? null : input.notes.trim(),
        p_manager_pin: input.managerPin,
      };
      const { data, error } = await supabase.rpc(
        'dispose_fixed_asset_v1', args as Fns['dispose_fixed_asset_v1']['Args'],
      );
      const b = body(data);
      // Un refus retourné permet au serveur de commiter le compteur PIN.
      if (b.ok === false) {
        const code = typeof b.error === 'string' ? b.error : 'invalid_pin';
        throw new FixedAssetError(codeOf(code), code);
      }
      if (error) throw new FixedAssetError(codeOf(error.message), error.message);
      const numeric = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
      const accum = numeric(b.accumulated_depreciation);
      const nbv = numeric(b.net_book_value);
      const price = numeric(b.sale_price);
      const result = numeric(b.result);
      if (b.ok !== true || typeof b.entry_number !== 'string'
        || accum === null || nbv === null || price === null || result === null) {
        throw new FixedAssetError('unknown', 'disposal_not_confirmed');
      }
      return { entryNumber: b.entry_number, accumulatedDepreciation: accum, netBookValue: nbv, salePrice: price, result };
    },
    onSuccess: async (_data, { assetId }) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: FIXED_ASSETS_KEY }),
        qc.invalidateQueries({ queryKey: fixedAssetDetailKey(assetId) }),
        qc.invalidateQueries({ queryKey: JOURNAL_ENTRIES_KEY }),
      ]);
    },
  });
}
