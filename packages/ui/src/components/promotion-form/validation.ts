// packages/ui/src/components/promotion-form/validation.ts
//
// Per-type validation for the promotion form. Mirrors the DB CHECK constraints
// documented in the spec §3.1 (schema = source of truth for ranges/checks).

import {
  thresholdDiscountMode,
  type PromotionFormErrors,
  type PromotionFormValues,
} from './types.js';

const SLUG_RE = /^[a-z0-9-]+$/;

export function validatePromotion(v: PromotionFormValues): PromotionFormErrors {
  const errors: PromotionFormErrors = {};

  if (v.name.trim().length < 3) errors.name = 'Name must be at least 3 characters.';
  if (!SLUG_RE.test(v.slug)) errors.slug = 'Slug must use lowercase letters, digits, and hyphens.';

  if (v.type === 'percentage' || v.type === 'fixed_amount') {
    if (v.scope === null) errors.scope = 'Scope is required.';
    if (v.discount_value === null || Number.isNaN(v.discount_value)) {
      errors.discount_value = 'Discount value is required.';
    } else if (v.discount_value <= 0) {
      errors.discount_value = 'Discount value must be greater than 0.';
    } else if (v.type === 'percentage' && v.discount_value > 100) {
      errors.discount_value = 'Percentage cannot exceed 100.';
    }
    if (v.scope === 'product' && v.scope_product_ids.length === 0) {
      errors.scope_product_ids = 'Pick at least one product.';
    }
    if (v.scope === 'category' && v.scope_category_ids.length === 0) {
      errors.scope_category_ids = 'Pick at least one category.';
    }
  }

  if (v.type === 'bogo') {
    if (v.bogo_trigger_product_ids.length === 0) {
      errors.bogo_trigger_product_ids = 'At least one trigger product.';
    }
    if (v.bogo_reward_product_ids.length === 0) {
      errors.bogo_reward_product_ids = 'At least one reward product.';
    }
    if (v.bogo_trigger_qty === null || v.bogo_trigger_qty < 1) {
      errors.bogo_trigger_qty = 'Trigger qty must be ≥ 1.';
    }
    if (v.bogo_reward_qty === null || v.bogo_reward_qty < 1) {
      errors.bogo_reward_qty = 'Reward qty must be ≥ 1.';
    }
    if (
      v.bogo_reward_discount_pct === null
      || v.bogo_reward_discount_pct < 0
      || v.bogo_reward_discount_pct > 100
    ) {
      errors.bogo_reward_discount_pct = 'Reward discount must be between 0 and 100.';
    }
  }

  if (v.type === 'free_product') {
    if (v.gift_product_id === null) errors.gift_product_id = 'Pick a gift product.';
    if (v.gift_qty < 1) errors.gift_qty = 'Gift qty must be ≥ 1.';
  }

  // S3-11 — palier : CHECK `chk_promotion_type_fields` (threshold_amount,
  // threshold_type, discount_value NOT NULL) + CHECK de colonne
  // threshold_amount ≥ 0 et threshold_type ∈ {subtotal, quantity}. En
  // pourcentage, le plafond est obligatoire : c'est lui qui dit « pourcentage »
  // au serveur (voir ThresholdBundleFields.tsx).
  if (v.type === 'threshold') {
    if (v.threshold_type !== 'subtotal' && v.threshold_type !== 'quantity') {
      errors.threshold_type = 'Pick what the threshold applies to.';
    }
    if (v.threshold_amount === null || Number.isNaN(v.threshold_amount)) {
      errors.threshold_amount = 'Threshold is required.';
    } else if (v.threshold_amount < 0) {
      errors.threshold_amount = 'Threshold cannot be negative.';
    } else if (v.threshold_type === 'quantity' && !Number.isInteger(v.threshold_amount)) {
      errors.threshold_amount = 'Item count must be a whole number.';
    }
    const mode = thresholdDiscountMode(v);
    if (v.discount_value === null || Number.isNaN(v.discount_value)) {
      errors.discount_value = 'Discount value is required.';
    } else if (v.discount_value <= 0) {
      errors.discount_value = 'Discount value must be greater than 0.';
    } else if (mode === 'percent' && v.discount_value > 100) {
      errors.discount_value = 'Percentage cannot exceed 100.';
    }
    if (mode === 'percent') {
      if (v.max_discount_amount === null || Number.isNaN(v.max_discount_amount)) {
        errors.max_discount_amount = 'A percentage threshold needs a maximum discount amount.';
      } else if (v.max_discount_amount <= 0) {
        errors.max_discount_amount = 'Maximum discount must be greater than 0.';
      }
    }
  }

  // S3-11 — formule : CHECK `chk_promotion_type_fields` (au moins 2 produits,
  // bundle_price NOT NULL) + CHECK de colonne bundle_price ≥ 0.
  if (v.type === 'bundle') {
    const ids = new Set(v.bundle_product_ids ?? []);
    if (ids.size < 2) errors.bundle_product_ids = 'Pick at least 2 different products.';
    if (v.bundle_price === null || Number.isNaN(v.bundle_price)) {
      errors.bundle_price = 'Bundle price is required.';
    } else if (v.bundle_price < 0) {
      errors.bundle_price = 'Bundle price cannot be negative.';
    }
  }

  if (v.min_items_total < 0) errors.min_items_total = 'Min total cannot be negative.';

  // Usage caps (Session 57) — NULL = unlimited, otherwise strictly > 0 (mirrors
  // the DB CHECK on promotions.max_uses / max_uses_per_customer).
  if (v.max_uses !== null && (Number.isNaN(v.max_uses) || v.max_uses <= 0)) {
    errors.max_uses = 'Max uses must be greater than 0, or empty for unlimited.';
  }
  if (
    v.max_uses_per_customer !== null
    && (Number.isNaN(v.max_uses_per_customer) || v.max_uses_per_customer <= 0)
  ) {
    errors.max_uses_per_customer =
      'Max uses per customer must be greater than 0, or empty for unlimited.';
  }

  if (v.start_at !== null && v.end_at !== null && v.start_at >= v.end_at) {
    errors.end_at = 'End must be after start.';
  }
  if (v.start_hour !== null && v.end_hour === null) errors.end_hour = 'End hour is required.';
  if (v.end_hour !== null && v.start_hour === null) errors.start_hour = 'Start hour is required.';
  if (v.start_hour !== null && v.end_hour !== null && v.start_hour >= v.end_hour) {
    errors.end_hour = 'End hour must be after start hour.';
  }
  if (v.day_of_week_mask < 0 || v.day_of_week_mask > 127) {
    errors.day_of_week_mask = 'Day mask must be between 0 and 127.';
  }

  return errors;
}

/**
 * S3-11 — Valeurs remises à `onSubmit`, rendues cohérentes avec ce que le
 * serveur lit pour le type choisi :
 * - palier en montant fixe → `max_discount_amount` à NULL (sinon le serveur
 *   le lirait comme un pourcentage plafonné) ; palier en pourcentage → le
 *   plafond saisi est conservé ;
 * - palier et formule n'ont pas de portée (`scope` NULL, comme bogo / cadeau) ;
 * - formule → identifiants dédoublonnés.
 * Le champ `threshold_discount_mode` reste un état de formulaire : le
 * convertisseur de ligne du back-office ne l'écrit pas.
 */
export function normalizePromotionValues(v: PromotionFormValues): PromotionFormValues {
  if (v.type === 'threshold') {
    const mode = thresholdDiscountMode(v);
    return {
      ...v,
      scope: null,
      threshold_discount_mode: mode,
      max_discount_amount: mode === 'fixed' ? null : v.max_discount_amount,
    };
  }
  if (v.type === 'bundle') {
    return {
      ...v,
      scope: null,
      bundle_product_ids: Array.from(new Set(v.bundle_product_ids ?? [])),
    };
  }
  return v;
}
