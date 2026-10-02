import type { QueryKey } from '@tanstack/react-query';
import { DISPATCH_STATIONS } from '@breakery/domain';
import { ALL_PAYMENT_METHODS } from '@/features/settings/hooks/useEnabledPaymentMethods';

type Row = Record<string, unknown>;
const row = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value);
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const text = (value: unknown): value is string => typeof value === 'string' && value.length > 0;
const bool = (value: unknown): value is boolean => typeof value === 'boolean';
const list = (value: unknown, validate: (item: unknown) => boolean): boolean => Array.isArray(value) && value.every(validate);

function modifiers(value: unknown): boolean {
  return list(value, (group) => row(group) && text(group.group_name) && number(group.group_sort_order)
    && bool(group.group_required) && ['single_select', 'multi_select'].includes(String(group.group_type))
    && list(group.options, (option) => row(option) && text(option.option_label)
      && number(option.option_sort_order) && number(option.price_adjustment) && bool(option.is_default)
      && (option.option_icon === undefined || typeof option.option_icon === 'string'))
    && (!group.group_required || (group.options as unknown[]).length > 0));
}
function product(value: unknown): boolean {
  return row(value) && text(value.id) && text(value.name) && typeof value.sku === 'string'
    && text(value.category_id) && number(value.retail_price) && value.retail_price >= 0
    && (value.wholesale_price === null || number(value.wholesale_price))
    && ['finished', 'combo'].includes(String(value.product_type)) && number(value.current_stock)
    && bool(value.is_active) && bool(value.is_favorite) && bool(value.has_variants)
    && bool(value.is_sellable) && bool(value.track_inventory)
    && (value.image_url === null || typeof value.image_url === 'string')
    && ['kitchen', 'barista', 'display', 'none'].includes(String(value.dispatch_station));
}
function variant(value: unknown): boolean {
  return row(value) && text(value.id) && text(value.name) && number(value.retail_price) && value.retail_price >= 0
    && text(value.variant_label) && ['flavor', 'size', 'format'].includes(String(value.variant_axis))
    && number(value.variant_sort_order) && bool(value.is_active) && bool(value.deduct_stock)
    && (value.current_stock === null || number(value.current_stock));
}
function combo(value: unknown, id: unknown): boolean {
  return row(value) && value.combo_product_id === id && text(value.name) && number(value.base_price) && value.base_price >= 0
    && list(value.groups, (group) => row(group) && text(group.id) && text(group.name)
      && ['single', 'multi'].includes(String(group.group_type)) && bool(group.is_required)
      && number(group.min_select) && number(group.max_select) && group.min_select >= 0 && group.max_select >= group.min_select
      && number(group.sort_order) && list(group.options, (option) => row(option) && text(option.id)
        && text(option.component_product_id) && text(option.label) && number(option.surcharge)
        && bool(option.is_default) && number(option.sort_order)
        && (option.component_modifier_groups === undefined || modifiers(option.component_modifier_groups))));
}
function promotion(value: unknown): boolean {
  if (!row(value) || !['id', 'name', 'slug', 'created_at'].every((key) => text(value[key]))) return false;
  if (!['percentage', 'fixed_amount', 'bogo', 'free_product', 'threshold', 'bundle'].includes(String(value.type))) return false;
  if (value.scope !== null && !(typeof value.scope === 'string' && ['cart', 'product', 'category'].includes(value.scope))) return false;
  const arrays = ['scope_product_ids', 'scope_category_ids', 'bogo_trigger_product_ids', 'bogo_reward_product_ids',
    'customer_category_ids', 'customer_tier_ids'];
  if (!arrays.every((key) => list(value[key], text))) return false;
  if (value.bundle_product_ids !== undefined && value.bundle_product_ids !== null && !list(value.bundle_product_ids, text)) return false;
  const nullableNumbers = ['discount_value', 'max_discount_amount', 'bogo_trigger_qty', 'bogo_reward_qty',
    'bogo_reward_discount_pct', 'gift_qty', 'min_items_total', 'start_hour', 'end_hour'];
  if (!nullableNumbers.every((key) => value[key] === null || number(value[key]))) return false;
  const optionalNumbers = ['bogo_buy_quantity', 'bogo_get_quantity', 'threshold_amount', 'bundle_price'];
  if (!optionalNumbers.every((key) => value[key] === undefined || value[key] === null || number(value[key]))) return false;
  if (!['description', 'gift_product_id', 'start_at', 'end_at'].every((key) => value[key] === null || typeof value[key] === 'string')) return false;
  if (value.bogo_get_product_id !== undefined && value.bogo_get_product_id !== null && !text(value.bogo_get_product_id)) return false;
  if (value.threshold_type !== undefined && value.threshold_type !== null
    && !(typeof value.threshold_type === 'string' && ['subtotal', 'quantity'].includes(value.threshold_type))) return false;
  return number(value.day_of_week_mask) && number(value.priority) && bool(value.is_active)
    && bool(value.stackable_with_promo) && bool(value.stackable_with_manual);
}

/** Valider les formes réellement consommées, jamais assimiler null à une liste vide. */
export function validSaleData(key: QueryKey, data: unknown): boolean {
  switch (key[0]) {
    case 'station-map': return key.length === 1 && row(data) && Object.entries(data).every(([id, stations]) =>
      text(id) && list(stations, (station) => DISPATCH_STATIONS.some((known) => station === known)));
    case 'promotions': return key.length === 2 && key[1] === 'active' && list(data, promotion);
    case 'products': return key.length === 1 && list(data, product);
    case 'categories': return key.length === 1 && list(data, (value) => row(value) && text(value.id)
      && text(value.name) && text(value.slug) && number(value.sort_order) && bool(value.is_active));
    case 'product-modifiers': return key.length === 3 && text(key[1]) && modifiers(data);
    case 'pos-product-variants': return key.length === 2 && text(key[1]) && list(data, variant);
    case 'combo-config': return key.length === 2 && text(key[1]) && combo(data, key[1]);
    case 'business-config':
      if (key.length !== 2) return false;
      if (key[1] === 'offline-network') return row(data) && bool(data.offlinePaymentsEnabled);
      if (key[1] === 'tax-config') return row(data) && number(data.taxRate) && data.taxRate >= 0 && bool(data.taxInclusive);
      if (key[1] === 'enabled-payment-methods') return Array.isArray(data) && data.length > 0
        && data.every((value) => ALL_PAYMENT_METHODS.some((method) => value === method));
      return false;
    default: return false;
  }
}
