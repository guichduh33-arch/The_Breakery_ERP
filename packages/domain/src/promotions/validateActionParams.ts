// packages/domain/src/promotions/validateActionParams.ts
import type { PromotionActionType } from './types.js';

export type ValidationResult = { ok: true } | { ok: false; reason: string };

export function validateActionParams(
  type: PromotionActionType,
  params: Record<string, unknown>,
): ValidationResult {
  if (type === 'percentage_off') {
    return validatePercentageOff(params);
  }
  if (type === 'fixed_off') {
    return validateFixedOff(params);
  }
  if (type === 'bogo') {
    return validateBogo(params);
  }
  return validateFreeProduct(params);
}

function validatePercentageOff(params: Record<string, unknown>): ValidationResult {
  const pct = Number(params.percentage);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { ok: false, reason: 'percentage out of (0, 100]' };
  const target = params.target;
  if (target !== 'cart' && target !== 'category' && target !== 'product') return { ok: false, reason: 'invalid target' };
  if ((target === 'category' || target === 'product') && !params.target_id) return { ok: false, reason: 'target_id required' };
  return { ok: true };
}

function validateFixedOff(params: Record<string, unknown>): ValidationResult {
  if (params.target !== 'cart') return { ok: false, reason: 'fixed_off only supports cart target v1' };
  if (!Number.isFinite(Number(params.amount)) || Number(params.amount) <= 0) return { ok: false, reason: 'amount must be > 0' };
  return { ok: true };
}

function validateBogo(params: Record<string, unknown>): ValidationResult {
  if (!params.buy_product_id) return { ok: false, reason: 'buy_product_id required' };
  if (!Number.isFinite(Number(params.buy_qty)) || Number(params.buy_qty) < 1) return { ok: false, reason: 'buy_qty >= 1' };
  if (!Number.isFinite(Number(params.get_qty)) || Number(params.get_qty) < 1) return { ok: false, reason: 'get_qty >= 1' };
  const pct = Number(params.get_discount_pct);
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return { ok: false, reason: 'get_discount_pct out of (0, 100]' };
  return { ok: true };
}

function validateFreeProduct(params: Record<string, unknown>): ValidationResult {
  if (!params.product_id) return { ok: false, reason: 'product_id required' };
  if (!Number.isFinite(Number(params.qty)) || Number(params.qty) < 1) return { ok: false, reason: 'qty >= 1' };
  return { ok: true };
}
