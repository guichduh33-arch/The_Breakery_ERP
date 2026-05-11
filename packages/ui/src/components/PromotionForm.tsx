// packages/ui/src/components/PromotionForm.tsx
//
// Dynamic create/edit form for the four promotion types (percentage,
// fixed_amount, bogo, free_product). Three-tab layout: General / Conditions /
// Stacking. Validation is dispatched per-type and mirrors the DB CHECK
// constraints documented in the spec §3.1.
//
// Spec ref: docs/superpowers/specs/2026-05-10-session-9-promotions-spec.md
//   §1 BO1–BO3, §3.1 (DB schema = source of truth for ranges/checks), §4.2

import { useCallback, useMemo, useState, type FormEvent, type JSX } from 'react';
import type { PromotionScope, PromotionType } from '@breakery/domain';
import { Button } from '../primitives/Button.js';
import { Input } from '../primitives/Input.js';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../primitives/Tabs.js';
import { cn } from '../lib/cn.js';
import { PromotionTypeBadge } from './PromotionTypeBadge.js';

export type { PromotionScope };

// ---------------------------------------------------------------------------
// Types (matches `Promotion` in @breakery/domain minus read-only metadata)
// ---------------------------------------------------------------------------

export interface PromotionFormValues {
  id?: string;
  name: string;
  slug: string;
  description: string | null;
  type: PromotionType;
  scope: PromotionScope | null;

  // Percentage / Fixed amount
  discount_value: number | null;
  max_discount_amount: number | null;
  scope_product_ids: string[];
  scope_category_ids: string[];

  // BOGO
  bogo_trigger_product_ids: string[];
  bogo_reward_product_ids: string[];
  bogo_trigger_qty: number | null;
  bogo_reward_qty: number | null;
  bogo_reward_discount_pct: number | null;

  // Free product
  gift_product_id: string | null;
  gift_qty: number;

  // Conditions
  min_items_total: number;
  customer_category_ids: string[];
  customer_tier_ids: string[];
  start_at: string | null;
  end_at: string | null;
  day_of_week_mask: number;
  start_hour: number | null;
  end_hour: number | null;

  // Stacking
  priority: number;
  stackable_with_promo: boolean;
  stackable_with_manual: boolean;

  is_active: boolean;
}

export interface PromotionFormOption {
  id: string;
  label: string;
}

export interface PromotionFormProps {
  mode: 'create' | 'edit';
  initialValues?: PromotionFormValues;
  productOptions: PromotionFormOption[];
  categoryOptions: PromotionFormOption[];
  customerCategoryOptions: PromotionFormOption[];
  customerTierOptions: PromotionFormOption[];
  onSubmit: (values: PromotionFormValues) => Promise<void> | void;
  onCancel: () => void;
}

// ---------------------------------------------------------------------------
// Defaults & validation
// ---------------------------------------------------------------------------

const SLUG_RE = /^[a-z0-9-]+$/;
const PROMOTION_TYPES: readonly PromotionType[] = [
  'percentage',
  'fixed_amount',
  'bogo',
  'free_product',
] as const;
const SCOPES: readonly PromotionScope[] = ['cart', 'product', 'category'] as const;
const DAY_LABELS: readonly string[] = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function emptyPromotionValues(): PromotionFormValues {
  return {
    name: '',
    slug: '',
    description: '',
    type: 'percentage',
    scope: 'cart',
    discount_value: null,
    max_discount_amount: null,
    scope_product_ids: [],
    scope_category_ids: [],
    bogo_trigger_product_ids: [],
    bogo_reward_product_ids: [],
    bogo_trigger_qty: 1,
    bogo_reward_qty: 1,
    bogo_reward_discount_pct: 100,
    gift_product_id: null,
    gift_qty: 1,
    min_items_total: 0,
    customer_category_ids: [],
    customer_tier_ids: [],
    start_at: null,
    end_at: null,
    day_of_week_mask: 127,
    start_hour: null,
    end_hour: null,
    priority: 0,
    stackable_with_promo: false,
    stackable_with_manual: true,
    is_active: true,
  };
}

export type PromotionFormErrors = Partial<Record<keyof PromotionFormValues | '_form', string>>;

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

  if (v.min_items_total < 0) errors.min_items_total = 'Min total cannot be negative.';

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

// ---------------------------------------------------------------------------
// Small reusable bits (kept inline to keep file under 500 lines)
// ---------------------------------------------------------------------------

interface FieldProps {
  label: string;
  htmlFor?: string;
  error?: string | undefined;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}

function Field({ label, htmlFor, error, hint, children, className }: FieldProps): JSX.Element {
  return (
    <div className={cn('space-y-1', className)}>
      <label htmlFor={htmlFor} className="text-xs uppercase tracking-widest text-text-secondary">
        {label}
      </label>
      {children}
      {hint !== undefined && !error ? (
        <p className="text-xs text-text-secondary">{hint}</p>
      ) : null}
      {error !== undefined ? <p className="text-xs text-red">{error}</p> : null}
    </div>
  );
}

interface MultiSelectProps {
  id: string;
  options: PromotionFormOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}

function MultiSelect({
  id,
  options,
  value,
  onChange,
  placeholder,
}: MultiSelectProps): JSX.Element {
  // Native multi-select keeps the bundle small and avoids new deps.
  // Cmd/Ctrl-click (or Shift-click) toggles entries.
  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const next = Array.from(e.target.selectedOptions, (o) => o.value);
      onChange(next);
    },
    [onChange],
  );
  return (
    <select
      id={id}
      multiple
      value={value}
      onChange={handleChange}
      className="w-full min-h-[7rem] rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      aria-label={placeholder ?? 'Multi-select'}
    >
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

interface SingleSelectProps {
  id: string;
  options: PromotionFormOption[];
  value: string | null;
  onChange: (next: string | null) => void;
  placeholder?: string;
}

function SingleSelect({ id, options, value, onChange, placeholder }: SingleSelectProps): JSX.Element {
  return (
    <select
      id={id}
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      className="h-touch-min w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
    >
      <option value="">{placeholder ?? '— Select —'}</option>
      {options.map((opt) => (
        <option key={opt.id} value={opt.id}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

function NumberInput({
  id,
  value,
  onChange,
  min,
  max,
  step,
  placeholder,
}: {
  id: string;
  value: number | null;
  onChange: (next: number | null) => void;
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
}): JSX.Element {
  const props: React.InputHTMLAttributes<HTMLInputElement> = {
    id,
    type: 'number',
    value: value ?? '',
    placeholder,
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      onChange(raw === '' ? null : Number(raw));
    },
  };
  if (min !== undefined) props.min = min;
  if (max !== undefined) props.max = max;
  if (step !== undefined) props.step = step;
  return <Input {...props} />;
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function PromotionForm({
  mode,
  initialValues,
  productOptions,
  categoryOptions,
  customerCategoryOptions,
  customerTierOptions,
  onSubmit,
  onCancel,
}: PromotionFormProps): JSX.Element {
  const [values, setValues] = useState<PromotionFormValues>(() =>
    initialValues ?? emptyPromotionValues(),
  );
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const errors = useMemo(() => validatePromotion(values), [values]);
  const hasErrors = Object.keys(errors).length > 0;

  const update = useCallback(<K extends keyof PromotionFormValues>(
    key: K,
    next: PromotionFormValues[K],
  ) => {
    setValues((prev) => ({ ...prev, [key]: next }));
  }, []);

  const setType = useCallback((nextType: PromotionType) => {
    setValues((prev) => ({
      ...prev,
      type: nextType,
      // Reset scope: NULL for bogo/free_product per spec P2
      scope: nextType === 'bogo' || nextType === 'free_product' ? null : (prev.scope ?? 'cart'),
    }));
  }, []);

  const handleSubmit = useCallback(
    async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setSubmitted(true);
      if (hasErrors) return;
      setSubmitting(true);
      setServerError(null);
      try {
        await onSubmit(values);
      } catch (err) {
        setServerError(err instanceof Error ? err.message : 'Failed to save promotion');
      } finally {
        setSubmitting(false);
      }
    },
    [hasErrors, onSubmit, values],
  );

  const showError = (key: keyof PromotionFormValues): string | undefined =>
    submitted ? errors[key] : undefined;

  return (
    <form onSubmit={(e) => { void handleSubmit(e); }} className="flex flex-col gap-4" noValidate>
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-2xl text-text-primary">
            {mode === 'create' ? 'New promotion' : 'Edit promotion'}
          </h2>
          <PromotionTypeBadge type={values.type} />
        </div>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={values.is_active}
            onChange={(e) => update('is_active', e.target.checked)}
          />
          Active
        </label>
      </header>

      <Tabs defaultValue="general" className="flex-1">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="conditions">Conditions</TabsTrigger>
          <TabsTrigger value="stacking">Stacking</TabsTrigger>
        </TabsList>

        {/* ============================ GENERAL ============================ */}
        <TabsContent value="general" className="space-y-4">
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
        </TabsContent>

        {/* ============================ CONDITIONS ============================ */}
        <TabsContent value="conditions" className="space-y-4">
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
        </TabsContent>

        {/* ============================ STACKING ============================ */}
        <TabsContent value="stacking" className="space-y-4">
          <Field label="Priority" htmlFor="promo-priority" hint="Higher applied first">
            <NumberInput
              id="promo-priority"
              value={values.priority}
              onChange={(n) => update('priority', n ?? 0)}
              step={1}
            />
          </Field>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.stackable_with_promo}
              onChange={(e) => update('stackable_with_promo', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-text-primary">Stackable with other promotions</span>
              <span className="block text-xs text-text-secondary">
                Both promos must opt-in for stacking to apply.
              </span>
            </span>
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={values.stackable_with_manual}
              onChange={(e) => update('stackable_with_manual', e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <span className="text-text-primary">Stackable with manual cashier discount</span>
              <span className="block text-xs text-text-secondary">
                Defaults to true — typical behaviour.
              </span>
            </span>
          </label>
        </TabsContent>
      </Tabs>

      {serverError !== null && (
        <p className="text-sm text-red" role="alert">
          {serverError}
        </p>
      )}
      {submitted && hasErrors && (
        <p className="text-sm text-red" role="alert">
          Please fix the errors above before saving.
        </p>
      )}

      <footer className="flex justify-end gap-3 pt-2 border-t border-border-subtle">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={submitting}>
          {submitting ? 'Saving…' : mode === 'create' ? 'Create promotion' : 'Save changes'}
        </Button>
      </footer>
    </form>
  );
}
