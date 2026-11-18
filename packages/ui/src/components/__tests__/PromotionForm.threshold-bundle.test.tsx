// packages/ui/src/components/__tests__/PromotionForm.threshold-bundle.test.tsx
//
// S3-11 — palier (threshold) et formule (bundle) dans le formulaire partagé.
// Validation calquée sur `chk_promotion_type_fields`, normalisation du plafond
// (le serveur lit « pourcentage » quand `max_discount_amount` est renseigné),
// saisie et relecture d'une ligne existante.

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  PromotionForm,
  emptyPromotionValues,
  normalizePromotionValues,
  validatePromotion,
  type PromotionFormOption,
  type PromotionFormValues,
} from '../PromotionForm.js';

const products: PromotionFormOption[] = [
  { id: 'prod-1', label: 'Americano' },
  { id: 'prod-2', label: 'Croissant' },
  { id: 'prod-3', label: 'Pain au chocolat' },
];

function base(over: Partial<PromotionFormValues>): PromotionFormValues {
  return { ...emptyPromotionValues(), name: 'Promo X', slug: 'promo-x', ...over };
}

function renderForm(
  initial: PromotionFormValues,
  mode: 'create' | 'edit' = 'create',
): { onSubmit: ReturnType<typeof vi.fn> } {
  const onSubmit = vi.fn();
  render(
    <PromotionForm
      mode={mode}
      initialValues={initial}
      productOptions={products}
      categoryOptions={[]}
      customerCategoryOptions={[]}
      customerTierOptions={[]}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  );
  return { onSubmit };
}

function selectMany(select: HTMLElement, ids: string[]): void {
  const el = select as HTMLSelectElement;
  for (const opt of Array.from(el.options)) opt.selected = ids.includes(opt.value);
  fireEvent.change(el);
}

describe('validatePromotion — threshold', () => {
  it('accepts a fixed subtotal threshold without cap', () => {
    const errs = validatePromotion(base({
      type: 'threshold', scope: null, threshold_type: 'subtotal', threshold_amount: 200_000,
      threshold_discount_mode: 'fixed', discount_value: 20_000,
    }));
    expect(errs).toEqual({});
  });

  it('requires a cap for a percentage threshold', () => {
    const errs = validatePromotion(base({
      type: 'threshold', scope: null, threshold_type: 'quantity', threshold_amount: 5,
      threshold_discount_mode: 'percent', discount_value: 10, max_discount_amount: null,
    }));
    expect(errs.max_discount_amount).toMatch(/maximum discount/i);
  });

  it('rejects a percentage above 100, a negative threshold and a missing type', () => {
    const errs = validatePromotion(base({
      type: 'threshold', scope: null, threshold_type: null, threshold_amount: -1,
      threshold_discount_mode: 'percent', discount_value: 120, max_discount_amount: 50_000,
    }));
    expect(errs.discount_value).toMatch(/100/);
    expect(errs.threshold_amount).toBeDefined();
    expect(errs.threshold_type).toBeDefined();
  });

  it('derives percent mode from a stored cap when no explicit mode is set', () => {
    const errs = validatePromotion(base({
      type: 'threshold', scope: null, threshold_type: 'subtotal', threshold_amount: 100_000,
      discount_value: 150, max_discount_amount: 30_000,
    }));
    expect(errs.discount_value).toMatch(/100/);
  });
});

describe('validatePromotion — bundle', () => {
  it('rejects a bundle with a single product', () => {
    const errs = validatePromotion(base({
      type: 'bundle', scope: null, bundle_product_ids: ['prod-1'], bundle_price: 30_000,
    }));
    expect(errs.bundle_product_ids).toMatch(/at least 2/i);
  });

  it('counts duplicated ids once', () => {
    const errs = validatePromotion(base({
      type: 'bundle', scope: null, bundle_product_ids: ['prod-1', 'prod-1'], bundle_price: 30_000,
    }));
    expect(errs.bundle_product_ids).toBeDefined();
  });

  it('requires a non-negative bundle price', () => {
    expect(validatePromotion(base({
      type: 'bundle', scope: null, bundle_product_ids: ['prod-1', 'prod-2'], bundle_price: null,
    })).bundle_price).toBeDefined();
    expect(validatePromotion(base({
      type: 'bundle', scope: null, bundle_product_ids: ['prod-1', 'prod-2'], bundle_price: -5,
    })).bundle_price).toBeDefined();
    expect(validatePromotion(base({
      type: 'bundle', scope: null, bundle_product_ids: ['prod-1', 'prod-2'], bundle_price: 0,
    }))).toEqual({});
  });
});

describe('normalizePromotionValues', () => {
  it('drops a stale cap on a fixed threshold', () => {
    const out = normalizePromotionValues(base({
      type: 'threshold', scope: 'cart', threshold_type: 'subtotal', threshold_amount: 1,
      threshold_discount_mode: 'fixed', discount_value: 5_000, max_discount_amount: 99_000,
    }));
    expect(out.max_discount_amount).toBeNull();
    expect(out.scope).toBeNull();
  });

  it('keeps the cap on a percentage threshold and dedupes bundle ids', () => {
    expect(normalizePromotionValues(base({
      type: 'threshold', threshold_type: 'subtotal', threshold_amount: 1,
      threshold_discount_mode: 'percent', discount_value: 10, max_discount_amount: 40_000,
    })).max_discount_amount).toBe(40_000);
    expect(normalizePromotionValues(base({
      type: 'bundle', bundle_product_ids: ['a', 'b', 'a'], bundle_price: 1,
    })).bundle_product_ids).toEqual(['a', 'b']);
  });
});

describe('PromotionForm — threshold and bundle', () => {
  it('offers the six promotion types', () => {
    renderForm(base({}));
    for (const t of ['percentage', 'fixed_amount', 'bogo', 'free_product', 'threshold', 'bundle']) {
      expect(screen.getByRole('tab', { name: t })).toBeInTheDocument();
    }
  });

  it('creates a fixed subtotal threshold with no cap', async () => {
    const { onSubmit } = renderForm(base({ type: 'percentage', scope: 'cart', max_discount_amount: 50_000 }));
    fireEvent.click(screen.getByRole('tab', { name: 'threshold' }));
    fireEvent.change(screen.getByLabelText(/Minimum subtotal/i), { target: { value: '250000' } });
    fireEvent.click(screen.getByLabelText(/Fixed amount \(IDR\)/i));
    fireEvent.change(screen.getByLabelText(/^Discount \(IDR\)/i), { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const v = onSubmit.mock.calls[0]?.[0] as PromotionFormValues;
    expect(v).toMatchObject({
      type: 'threshold', scope: null, threshold_type: 'subtotal', threshold_amount: 250_000,
      discount_value: 25_000, max_discount_amount: null, threshold_discount_mode: 'fixed',
    });
  });

  it('blocks a percentage threshold until a cap is entered', async () => {
    const { onSubmit } = renderForm(base({}));
    fireEvent.click(screen.getByRole('tab', { name: 'threshold' }));
    fireEvent.click(screen.getByLabelText(/Number of items/i));
    fireEvent.change(screen.getByLabelText(/Minimum items in cart/i), { target: { value: '6' } });
    fireEvent.click(screen.getByLabelText(/Percentage of subtotal/i));
    fireEvent.change(screen.getByLabelText(/^Discount \(%\)/i), { target: { value: '15' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));
    expect(await screen.findByText(/needs a maximum discount amount/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Max discount amount/i), { target: { value: '60000' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      type: 'threshold', threshold_type: 'quantity', threshold_amount: 6,
      discount_value: 15, max_discount_amount: 60_000, threshold_discount_mode: 'percent',
    });
  });

  it('creates a bundle of two products and rejects a single one', async () => {
    const { onSubmit } = renderForm(base({}));
    fireEvent.click(screen.getByRole('tab', { name: 'bundle' }));
    const picker = screen.getByLabelText('Bundle products');
    selectMany(picker, ['prod-1']);
    fireEvent.change(screen.getByLabelText(/Bundle price/i), { target: { value: '45000' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));
    expect(await screen.findByText(/at least 2 different products/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();

    selectMany(picker, ['prod-1', 'prod-2']);
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({
      type: 'bundle', scope: null, bundle_product_ids: ['prod-1', 'prod-2'], bundle_price: 45_000,
    });
  });

  it('loads an existing percentage threshold back into the form', () => {
    renderForm(base({
      id: 'promo-9', type: 'threshold', scope: null, threshold_type: 'quantity',
      threshold_amount: 4, discount_value: 12, max_discount_amount: 35_000,
    }), 'edit');
    expect(screen.getByLabelText(/Number of items/i)).toBeChecked();
    expect(screen.getByLabelText(/Minimum items in cart/i)).toHaveValue(4);
    expect(screen.getByLabelText(/Percentage of subtotal/i)).toBeChecked();
    expect(screen.getByLabelText(/^Discount \(%\)/i)).toHaveValue(12);
    expect(screen.getByLabelText(/Max discount amount/i)).toHaveValue(35_000);
  });

  it('loads an existing bundle back into the form', () => {
    renderForm(base({
      id: 'promo-10', type: 'bundle', scope: null, bundle_product_ids: ['prod-2', 'prod-3'], bundle_price: 38_000,
    }), 'edit');
    const picker = screen.getByLabelText<HTMLSelectElement>('Bundle products');
    expect(Array.from(picker.selectedOptions, (o) => o.value)).toEqual(['prod-2', 'prod-3']);
    expect(screen.getByLabelText(/Bundle price/i)).toHaveValue(38_000);
  });
});
