// packages/ui/src/components/promotion-form/GeneralTab.tsx
//
// "General" tab of the promotion form: name / slug / description, the type
// selector, and the per-type configuration section (percentage & fixed_amount,
// bogo, free_product).

import type { JSX } from 'react';
import type { PromotionType } from '@breakery/domain';
import { Input } from '../../primitives/Input.js';
import { cn } from '../../lib/cn.js';
import { Field, MultiSelect, NumberInput, SingleSelect } from './fields.js';
import {
  PROMOTION_TYPES,
  SCOPES,
  type PromotionFieldErrorFn,
  type PromotionFormOption,
  type PromotionFormUpdate,
  type PromotionFormValues,
} from './types.js';

export interface GeneralTabProps {
  values: PromotionFormValues;
  update: PromotionFormUpdate;
  setType: (next: PromotionType) => void;
  showError: PromotionFieldErrorFn;
  productOptions: PromotionFormOption[];
  categoryOptions: PromotionFormOption[];
}

export function GeneralTab({
  values,
  update,
  setType,
  showError,
  productOptions,
  categoryOptions,
}: GeneralTabProps): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Name" htmlFor="promo-name" error={showError('name')}>
          <Input
            id="promo-name"
            value={values.name}
            onChange={(e) => update('name', e.target.value)}
            placeholder="Happy Hour Beverage"
          />
        </Field>
        <Field
          label="Slug"
          htmlFor="promo-slug"
          error={showError('slug')}
          hint="Lowercase, digits, hyphens"
        >
          <Input
            id="promo-slug"
            value={values.slug}
            onChange={(e) => update('slug', e.target.value)}
            placeholder="happy-hour-bev"
          />
        </Field>
      </div>
      <Field label="Description" htmlFor="promo-desc">
        <textarea
          id="promo-desc"
          value={values.description ?? ''}
          onChange={(e) => update('description', e.target.value === '' ? null : e.target.value)}
          rows={2}
          className="w-full rounded-md bg-bg-input border border-border-subtle text-text-primary placeholder:text-text-muted p-3 text-sm resize-none focus:outline-none focus:border-gold"
          placeholder="Optional, surfaced in audit snapshot"
        />
      </Field>

      <Field label="Type">
        <div role="tablist" className="inline-flex gap-1 rounded-md bg-bg-input p-1">
          {PROMOTION_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={values.type === t}
              onClick={() => setType(t)}
              className={cn(
                'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1.5 text-sm font-medium transition-all',
                values.type === t
                  ? 'bg-gold-soft text-gold border border-gold shadow-sm'
                  : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </Field>

      {(values.type === 'percentage' || values.type === 'fixed_amount') && (
        <div className="space-y-4">
          <Field label="Scope" error={showError('scope')}>
            <div className="flex gap-3">
              {SCOPES.map((s) => (
                <label key={s} className="inline-flex items-center gap-2 text-sm">
                  <input
                    type="radio"
                    name="promo-scope"
                    value={s}
                    checked={values.scope === s}
                    onChange={() => update('scope', s)}
                  />
                  {s}
                </label>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label={values.type === 'percentage' ? 'Discount (%)' : 'Discount (IDR)'}
              htmlFor="promo-disc-value"
              error={showError('discount_value')}
            >
              <NumberInput
                id="promo-disc-value"
                value={values.discount_value}
                onChange={(n) => update('discount_value', n)}
                min={0}
                {...(values.type === 'percentage' ? { max: 100, step: 0.5 } : { step: 1000 })}
              />
            </Field>
            <Field
              label="Max discount amount (IDR)"
              htmlFor="promo-max-disc"
              hint="Optional cap"
            >
              <NumberInput
                id="promo-max-disc"
                value={values.max_discount_amount}
                onChange={(n) => update('max_discount_amount', n)}
                min={0}
                step={1000}
              />
            </Field>
          </div>
          {values.scope === 'product' && (
            <Field
              label="Eligible products"
              htmlFor="promo-scope-products"
              error={showError('scope_product_ids')}
              hint="Cmd/Ctrl-click to multi-select"
            >
              <MultiSelect
                id="promo-scope-products"
                options={productOptions}
                value={values.scope_product_ids}
                onChange={(next) => update('scope_product_ids', next)}
              />
            </Field>
          )}
          {values.scope === 'category' && (
            <Field
              label="Eligible categories"
              htmlFor="promo-scope-categories"
              error={showError('scope_category_ids')}
            >
              <MultiSelect
                id="promo-scope-categories"
                options={categoryOptions}
                value={values.scope_category_ids}
                onChange={(next) => update('scope_category_ids', next)}
              />
            </Field>
          )}
        </div>
      )}

      {values.type === 'bogo' && (
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Trigger products"
            htmlFor="promo-bogo-trigger"
            error={showError('bogo_trigger_product_ids')}
          >
            <MultiSelect
              id="promo-bogo-trigger"
              options={productOptions}
              value={values.bogo_trigger_product_ids}
              onChange={(next) => update('bogo_trigger_product_ids', next)}
            />
          </Field>
          <Field
            label="Reward products"
            htmlFor="promo-bogo-reward"
            error={showError('bogo_reward_product_ids')}
          >
            <MultiSelect
              id="promo-bogo-reward"
              options={productOptions}
              value={values.bogo_reward_product_ids}
              onChange={(next) => update('bogo_reward_product_ids', next)}
            />
          </Field>
          <Field
            label="Trigger qty"
            htmlFor="promo-bogo-trigger-qty"
            error={showError('bogo_trigger_qty')}
          >
            <NumberInput
              id="promo-bogo-trigger-qty"
              value={values.bogo_trigger_qty}
              onChange={(n) => update('bogo_trigger_qty', n)}
              min={1}
              step={1}
            />
          </Field>
          <Field
            label="Reward qty"
            htmlFor="promo-bogo-reward-qty"
            error={showError('bogo_reward_qty')}
          >
            <NumberInput
              id="promo-bogo-reward-qty"
              value={values.bogo_reward_qty}
              onChange={(n) => update('bogo_reward_qty', n)}
              min={1}
              step={1}
            />
          </Field>
          <Field
            label={`Reward discount (${values.bogo_reward_discount_pct ?? 0}%)`}
            htmlFor="promo-bogo-pct"
            error={showError('bogo_reward_discount_pct')}
            hint="0 = full price, 100 = free"
            className="col-span-2"
          >
            <input
              id="promo-bogo-pct"
              type="range"
              min={0}
              max={100}
              step={5}
              value={values.bogo_reward_discount_pct ?? 0}
              onChange={(e) => update('bogo_reward_discount_pct', Number(e.target.value))}
              className="w-full accent-gold"
            />
          </Field>
        </div>
      )}

      {values.type === 'free_product' && (
        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Gift product"
            htmlFor="promo-gift-product"
            error={showError('gift_product_id')}
          >
            <SingleSelect
              id="promo-gift-product"
              options={productOptions}
              value={values.gift_product_id}
              onChange={(next) => update('gift_product_id', next)}
            />
          </Field>
          <Field label="Gift qty" htmlFor="promo-gift-qty" error={showError('gift_qty')}>
            <NumberInput
              id="promo-gift-qty"
              value={values.gift_qty}
              onChange={(n) => update('gift_qty', n ?? 1)}
              min={1}
              step={1}
            />
          </Field>
        </div>
      )}
    </div>
  );
}
