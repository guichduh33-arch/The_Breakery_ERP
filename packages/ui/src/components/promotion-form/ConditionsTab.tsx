// packages/ui/src/components/promotion-form/ConditionsTab.tsx
//
// "Conditions" tab: minimum spend, customer targeting, active window
// (dates / days / hours) and usage caps (Session 57 A-D4/A-D9).

import type { JSX } from 'react';
import { Input } from '../../primitives/Input.js';
import { cn } from '../../lib/cn.js';
import { Field, MultiSelect, NumberInput } from './fields.js';
import {
  DAY_LABELS,
  type PromotionFieldErrorFn,
  type PromotionFormOption,
  type PromotionFormUpdate,
  type PromotionFormValues,
} from './types.js';

export interface ConditionsTabProps {
  values: PromotionFormValues;
  update: PromotionFormUpdate;
  showError: PromotionFieldErrorFn;
  customerCategoryOptions: PromotionFormOption[];
  customerTierOptions: PromotionFormOption[];
}

export function ConditionsTab({
  values,
  update,
  showError,
  customerCategoryOptions,
  customerTierOptions,
}: ConditionsTabProps): JSX.Element {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Min items total (IDR)"
          htmlFor="promo-min-total"
          error={showError('min_items_total')}
        >
          <NumberInput
            id="promo-min-total"
            value={values.min_items_total}
            onChange={(n) => update('min_items_total', n ?? 0)}
            min={0}
            step={1000}
          />
        </Field>
      </div>
      <Field
        label="Customer categories"
        htmlFor="promo-customer-cats"
        hint="Empty = applies to everyone"
      >
        <MultiSelect
          id="promo-customer-cats"
          options={customerCategoryOptions}
          value={values.customer_category_ids}
          onChange={(next) => update('customer_category_ids', next)}
        />
      </Field>
      <Field
        label="Customer tiers"
        htmlFor="promo-customer-tiers"
        hint="Empty = all tiers"
      >
        <MultiSelect
          id="promo-customer-tiers"
          options={customerTierOptions}
          value={values.customer_tier_ids}
          onChange={(next) => update('customer_tier_ids', next)}
        />
      </Field>

      {/* Usage caps — NULL = unlimited (Session 57). */}
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Max total uses"
          htmlFor="promo-max-uses"
          error={showError('max_uses')}
          hint="Empty = unlimited"
        >
          <NumberInput
            id="promo-max-uses"
            value={values.max_uses}
            onChange={(n) => update('max_uses', n)}
            min={1}
            step={1}
            placeholder="Unlimited"
          />
        </Field>
        <Field
          label="Max uses per customer"
          htmlFor="promo-max-uses-per-customer"
          error={showError('max_uses_per_customer')}
          hint="Empty = unlimited · needs a customer on the order"
        >
          <NumberInput
            id="promo-max-uses-per-customer"
            value={values.max_uses_per_customer}
            onChange={(n) => update('max_uses_per_customer', n)}
            min={1}
            step={1}
            placeholder="Unlimited"
          />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Start at" htmlFor="promo-start-at">
          <Input
            id="promo-start-at"
            type="datetime-local"
            value={values.start_at ?? ''}
            onChange={(e) => update('start_at', e.target.value === '' ? null : e.target.value)}
          />
        </Field>
        <Field label="End at" htmlFor="promo-end-at" error={showError('end_at')}>
          <Input
            id="promo-end-at"
            type="datetime-local"
            value={values.end_at ?? ''}
            onChange={(e) => update('end_at', e.target.value === '' ? null : e.target.value)}
          />
        </Field>
      </div>
      <Field label="Days of week" error={showError('day_of_week_mask')}>
        <div className="flex gap-2 flex-wrap">
          {DAY_LABELS.map((label, i) => {
            const bit = 1 << i;
            const active = (values.day_of_week_mask & bit) !== 0;
            return (
              <label
                key={label}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs cursor-pointer',
                  active
                    ? 'bg-gold-soft border-gold text-gold'
                    : 'bg-bg-input border-border-subtle text-text-secondary',
                )}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={active}
                  onChange={() => {
                    const next = active
                      ? values.day_of_week_mask & ~bit
                      : values.day_of_week_mask | bit;
                    update('day_of_week_mask', next);
                  }}
                />
                {label}
              </label>
            );
          })}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label="Start hour (0-23)"
          htmlFor="promo-start-hour"
          error={showError('start_hour')}
        >
          <NumberInput
            id="promo-start-hour"
            value={values.start_hour}
            onChange={(n) => update('start_hour', n)}
            min={0}
            max={23}
            step={1}
          />
        </Field>
        <Field
          label="End hour (0-23)"
          htmlFor="promo-end-hour"
          error={showError('end_hour')}
        >
          <NumberInput
            id="promo-end-hour"
            value={values.end_hour}
            onChange={(n) => update('end_hour', n)}
            min={0}
            max={23}
            step={1}
          />
        </Field>
      </div>
    </div>
  );
}
