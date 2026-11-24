// apps/backoffice/src/features/accounting/components/fixedAssetContract.ts
//
// ADR-047 — contrat des lectures du registre des équipements
// (`get_fixed_assets_v1`, `get_fixed_asset_v1`). Les deux RPC rendent du jsonb,
// typé `Json` par le client : chaque champ est vérifié ici avant d'atteindre
// l'écran, une réponse inattendue lève au lieu de blanchir la page.
//
// Les libellés sont indexés par les enums Postgres (`satisfies Record<…>`) :
// une valeur renommée ou ajoutée côté base casse le build, jamais l'écran.

import type { Database } from '@breakery/supabase';

type Enums = Database['public']['Enums'];
export type FixedAssetType = Enums['fixed_asset_type'];
export type FixedAssetTaxGroup = Enums['fixed_asset_tax_group'];
export type FixedAssetStatus = Enums['fixed_asset_status'];
export type FixedAssetOrigin = Enums['fixed_asset_origin'];
export type FixedAssetDisposalReason = Enums['fixed_asset_disposal_reason'];
export type FixedAssetDepreciationStatus = Enums['fixed_asset_depreciation_status'];

/** L'ordre de déclaration EST l'ordre d'affichage. */
export const FIXED_ASSET_TYPE_LABEL = {
  equipment:          'Equipment & furniture',
  production_machine: 'Production machine',
} as const satisfies Record<FixedAssetType, string>;

/** Groupes fiscaux UU PPh art. 11 ouverts par l'ADR-047 (décision 5). */
export const FIXED_ASSET_TAX_GROUP_LABEL = {
  group_1: 'Group 1 — 4 years',
  group_2: 'Group 2 — 8 years',
} as const satisfies Record<FixedAssetTaxGroup, string>;

export const FIXED_ASSET_STATUS_LABEL = {
  active:   'Active',
  disposed: 'Disposed',
} as const satisfies Record<FixedAssetStatus, string>;

export const FIXED_ASSET_ORIGIN_LABEL = {
  expense: 'Expense',
  opening: 'Registered existing asset',
} as const satisfies Record<FixedAssetOrigin, string>;

export const FIXED_ASSET_DISPOSAL_REASON_LABEL = {
  sale:     'Sale',
  breakage: 'Breakage',
  scrap:    'Scrap',
} as const satisfies Record<FixedAssetDisposalReason, string>;

export const FIXED_ASSET_DEPRECIATION_STATUS_LABEL = {
  posted:  'Posted',
  refused: 'Refused',
} as const satisfies Record<FixedAssetDepreciationStatus, string>;

export const FIXED_ASSET_TYPES = Object.keys(FIXED_ASSET_TYPE_LABEL) as readonly FixedAssetType[];
export const FIXED_ASSET_TAX_GROUPS = Object.keys(FIXED_ASSET_TAX_GROUP_LABEL) as readonly FixedAssetTaxGroup[];
export const FIXED_ASSET_DISPOSAL_REASONS =
  Object.keys(FIXED_ASSET_DISPOSAL_REASON_LABEL) as readonly FixedAssetDisposalReason[];

/** ADR-047 décision 1 : seuil d'un équipement, TTC, PAR ARTICLE. */
export const FIXED_ASSET_THRESHOLD_PER_ITEM = 2_000_000;

export interface FixedAssetRow {
  id: string;
  asset_number: string;
  name: string;
  asset_type: FixedAssetType;
  tax_group: FixedAssetTaxGroup;
  useful_life_months: number;
  account_code: string;
  account_name: string;
  in_service_date: string;
  cost: number;
  monthly_depreciation: number;
  origin: FixedAssetOrigin;
  expense_id: string | null;
  expense_number: string | null;
  accumulated_depreciation: number;
  net_book_value: number;
  months_posted: number;
  last_posted_month: string | null;
  refused_months: number;
  status: FixedAssetStatus;
  disposed_at: string | null;
  disposal_reason: FixedAssetDisposalReason | null;
  created_at: string;
}

export interface FixedAssetDepreciation {
  period_month: string;
  entry_date: string;
  month_index: number;
  amount: number;
  status: FixedAssetDepreciationStatus;
  entry_number: string | null;
  refused_reason: string | null;
  attempts: number;
}

export interface FixedAssetDetail extends FixedAssetRow {
  opening_accumulated: number;
  opening_accumulated_as_of: string | null;
  depreciation_start_month: string;
  disposal_price: number | null;
  disposal_notes: string | null;
  disposal_proceeds_account_code: string | null;
  disposal_entry_number: string | null;
  depreciations: FixedAssetDepreciation[];
}

const INVALID = 'Invalid fixed asset response. Refresh the page.';

function rec(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error(INVALID);
  return value as Record<string, unknown>;
}
function str(value: unknown): string {
  if (typeof value !== 'string') throw new Error(INVALID);
  return value;
}
function optStr(value: unknown): string | null {
  return value === null || value === undefined ? null : str(value);
}
// numeric(15,2) arrive en nombre JSON ; une chaîne numérique reste admise.
function num(value: unknown): number {
  const n = typeof value === 'string' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new Error(INVALID);
  return n;
}
function optNum(value: unknown): number | null {
  return value === null || value === undefined ? null : num(value);
}
function oneOf<T extends string>(labels: Record<T, string>, value: unknown): T {
  if (typeof value !== 'string' || !Object.prototype.hasOwnProperty.call(labels, value)) throw new Error(INVALID);
  return value as T;
}

export function parseFixedAssetRow(value: unknown): FixedAssetRow {
  const v = rec(value);
  return {
    id: str(v.id),
    asset_number: str(v.asset_number),
    name: str(v.name),
    asset_type: oneOf(FIXED_ASSET_TYPE_LABEL, v.asset_type),
    tax_group: oneOf(FIXED_ASSET_TAX_GROUP_LABEL, v.tax_group),
    useful_life_months: num(v.useful_life_months),
    account_code: str(v.account_code),
    account_name: str(v.account_name),
    in_service_date: str(v.in_service_date),
    cost: num(v.cost),
    monthly_depreciation: num(v.monthly_depreciation),
    origin: oneOf(FIXED_ASSET_ORIGIN_LABEL, v.origin),
    expense_id: optStr(v.expense_id),
    expense_number: optStr(v.expense_number),
    accumulated_depreciation: num(v.accumulated_depreciation),
    net_book_value: num(v.net_book_value),
    months_posted: num(v.months_posted),
    last_posted_month: optStr(v.last_posted_month),
    refused_months: num(v.refused_months),
    status: oneOf(FIXED_ASSET_STATUS_LABEL, v.status),
    disposed_at: optStr(v.disposed_at),
    disposal_reason: v.disposal_reason == null ? null : oneOf(FIXED_ASSET_DISPOSAL_REASON_LABEL, v.disposal_reason),
    created_at: str(v.created_at),
  };
}

export function parseFixedAssets(value: unknown): FixedAssetRow[] {
  if (!Array.isArray(value)) throw new Error(INVALID);
  return value.map(parseFixedAssetRow);
}

function parseDepreciation(value: unknown): FixedAssetDepreciation {
  const d = rec(value);
  return {
    period_month: str(d.period_month),
    entry_date: str(d.entry_date),
    month_index: num(d.month_index),
    amount: num(d.amount),
    status: oneOf(FIXED_ASSET_DEPRECIATION_STATUS_LABEL, d.status),
    entry_number: optStr(d.entry_number),
    refused_reason: optStr(d.refused_reason),
    attempts: num(d.attempts),
  };
}

export function parseFixedAssetDetail(value: unknown): FixedAssetDetail {
  const v = rec(value);
  if (!Array.isArray(v.depreciations)) throw new Error(INVALID);
  return {
    ...parseFixedAssetRow(v),
    opening_accumulated: num(v.opening_accumulated),
    opening_accumulated_as_of: optStr(v.opening_accumulated_as_of),
    depreciation_start_month: str(v.depreciation_start_month),
    disposal_price: optNum(v.disposal_price),
    disposal_notes: optStr(v.disposal_notes),
    disposal_proceeds_account_code: optStr(v.disposal_proceeds_account_code),
    disposal_entry_number: optStr(v.disposal_entry_number),
    depreciations: v.depreciations.map(parseDepreciation),
  };
}

/** Totaux des actifs ACTIFS : un équipement sorti n'est plus au bilan. */
export function activeTotals(rows: readonly FixedAssetRow[]): { cost: number; accumulated: number; net: number; count: number } {
  const active = rows.filter((r) => r.status === 'active');
  // Somme en centimes : l'addition flottante d'IDR à deux décimales dérive.
  const sum = (pick: (r: FixedAssetRow) => number): number =>
    active.reduce((acc, r) => acc + Math.round(pick(r) * 100), 0) / 100;
  return {
    cost: sum((r) => r.cost),
    accumulated: sum((r) => r.accumulated_depreciation),
    net: sum((r) => r.net_book_value),
    count: active.length,
  };
}

/** Montant saisi → nombre positif ou nul à deux décimales au plus, sinon null. */
export function parseIdrAmount(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  // Tolérance : 0.07 × 100 vaut 7.000000000000001 en flottant.
  return Number.isFinite(n) && n >= 0 && Math.abs(Math.round(n * 100) - n * 100) < 1e-6 ? n : null;
}

/** Dernier jour du mois d'une date ISO `YYYY-MM-DD` (le cumul se constate en fin de mois). */
export function isMonthEnd(iso: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (m === null) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  // Jour 0 du mois suivant = dernier jour du mois courant (calcul en UTC, sans fuseau).
  return new Date(Date.UTC(y, mo, 0)).getUTCDate() === d;
}
