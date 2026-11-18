// packages/ui/src/components/promotion-form/ThresholdBundleFields.tsx
//
// S3-11 — Sections « palier » (threshold) et « formule » (bundle) de l'onglet
// General. Les deux mécaniques étaient évaluées par le serveur
// (`evaluate_promotions`) sans pouvoir être saisies depuis l'écran.
//
// Palier : le serveur n'a PAS de colonne « pourcentage ou montant ». Il lit
// `max_discount_amount` comme interrupteur : renseigné → `discount_value` est
// un pourcentage du sous-total, plafonné à ce montant ; NULL → `discount_value`
// est un montant fixe en IDR. Un palier en pourcentage SANS plafond est donc
// impossible : le formulaire rend le choix explicite et exige le plafond en
// pourcentage (voir `normalizePromotionValues`, qui remet le plafond à NULL en
// montant fixe).
//
// Formule : remise = Σ du plus petit prix unitaire de chaque produit listé
// présent au panier − prix de la formule, appliquée une fois.

import type { JSX } from 'react';
import type { ThresholdType } from '@breakery/domain';
import { Field, MultiSelect, NumberInput } from './fields.js';
import type {
  PromotionFieldErrorFn,
  PromotionFormOption,
  PromotionFormUpdate,
  PromotionFormValues,
  ThresholdDiscountMode,
} from './types.js';
import { thresholdDiscountMode } from './types.js';

export interface ThresholdBundleFieldsProps {
  values: PromotionFormValues;
  update: PromotionFormUpdate;
  showError: PromotionFieldErrorFn;
  productOptions: PromotionFormOption[];
}

const THRESHOLD_TYPES: readonly { value: ThresholdType; label: string }[] = [
  { value: 'subtotal', label: 'Cart subtotal (IDR)' },
  { value: 'quantity', label: 'Number of items' },
];

const DISCOUNT_MODES: readonly { value: ThresholdDiscountMode; label: string }[] = [
  { value: 'fixed', label: 'Fixed amount (IDR)' },
  { value: 'percent', label: 'Percentage of subtotal' },
];

export function ThresholdFields({
  values,
  update,
  showError,
}: Omit<ThresholdBundleFieldsProps, 'productOptions'>): JSX.Element {
  const mode = thresholdDiscountMode(values);
  const isQuantity = values.threshold_type === 'quantity';
  return (
    <div className="space-y-4" data-testid="promo-threshold-fields">
      <Field label="Trigger on" error={showError('threshold_type')}>
        <div className="flex flex-wrap gap-3">
          {THRESHOLD_TYPES.map((t) => (
            <label key={t.value} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="promo-threshold-type"
                value={t.value}
                checked={values.threshold_type === t.value}
                onChange={() => update('threshold_type', t.value)}
              />
              {t.label}
            </label>
          ))}
        </div>
      </Field>
      <Field
        label={isQuantity ? 'Minimum items in cart' : 'Minimum subtotal (IDR)'}
        htmlFor="promo-threshold-amount"
        error={showError('threshold_amount')}
      >
        <NumberInput
          id="promo-threshold-amount"
          value={values.threshold_amount}
          onChange={(n) => update('threshold_amount', n)}
          min={0}
          step={isQuantity ? 1 : 1000}
        />
      </Field>
      <Field label="Discount kind">
        <div className="flex flex-wrap gap-3">
          {DISCOUNT_MODES.map((m) => (
            <label key={m.value} className="inline-flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="promo-threshold-mode"
                value={m.value}
                checked={mode === m.value}
                onChange={() => update('threshold_discount_mode', m.value)}
              />
              {m.label}
            </label>
          ))}
        </div>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        <Field
          label={mode === 'percent' ? 'Discount (%)' : 'Discount (IDR)'}
          htmlFor="promo-threshold-disc"
          error={showError('discount_value')}
        >
          <NumberInput
            id="promo-threshold-disc"
            value={values.discount_value}
            onChange={(n) => update('discount_value', n)}
            min={0}
            {...(mode === 'percent' ? { max: 100, step: 0.5 } : { step: 1000 })}
          />
        </Field>
        {mode === 'percent' && (
          <Field
            label="Max discount amount (IDR)"
            htmlFor="promo-threshold-cap"
            error={showError('max_discount_amount')}
            hint="Required: a percentage threshold must carry a cap."
          >
            <NumberInput
              id="promo-threshold-cap"
              value={values.max_discount_amount}
              onChange={(n) => update('max_discount_amount', n)}
              min={0}
              step={1000}
            />
          </Field>
        )}
      </div>
      <p className="text-xs text-text-secondary">
        The discount never exceeds the cart subtotal.
      </p>
    </div>
  );
}

export function BundleFields({
  values,
  update,
  showError,
  productOptions,
}: ThresholdBundleFieldsProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 gap-4" data-testid="promo-bundle-fields">
      <Field
        label="Bundle products"
        htmlFor="promo-bundle-products"
        error={showError('bundle_product_ids')}
        hint="At least 2 products. Cmd/Ctrl-click to multi-select."
      >
        <MultiSelect
          id="promo-bundle-products"
          options={productOptions}
          value={values.bundle_product_ids ?? []}
          onChange={(next) => update('bundle_product_ids', next)}
          placeholder="Bundle products"
        />
      </Field>
      <Field
        label="Bundle price (IDR)"
        htmlFor="promo-bundle-price"
        error={showError('bundle_price')}
        hint="Discount = sum of the cheapest unit price of each listed product − this price, applied once. No discount if the price is not below that sum."
      >
        <NumberInput
          id="promo-bundle-price"
          value={values.bundle_price}
          onChange={(n) => update('bundle_price', n)}
          min={0}
          step={1000}
        />
      </Field>
    </div>
  );
}
