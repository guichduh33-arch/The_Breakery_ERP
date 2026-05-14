// apps/backoffice/src/features/promotions/__tests__/BogoForm.test.tsx
//
// Session 13 / Phase 2.C — smoke tests for BogoForm + ThresholdForm.
// Pure component tests : render → fill required fields → submit → assert
// the `onSubmit` payload carries the correct new-shape fields. No
// network, no QueryClient — these forms are pure UI.

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PromotionFormValues } from '@breakery/ui';
import { BogoForm } from '../components/BogoForm.js';
import { ThresholdForm } from '../components/ThresholdForm.js';

const PRODUCTS = [
  { id: 'p-bag', label: 'Baguette' },
  { id: 'p-cro', label: 'Croissant' },
];

describe('BogoForm', () => {
  it('submits new-shape BOGO with buy/get qty + product', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const onCancel = vi.fn();
    render(
      <BogoForm
        mode="create"
        productOptions={PRODUCTS}
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Buy 2 baguettes/), {
      target: { value: 'Buy 2 Get 1 Baguette' },
    });
    fireEvent.change(screen.getByPlaceholderText(/bogo-2-1-baguette/), {
      target: { value: 'bogo-2-1-bag' },
    });
    // Default buy=2/get=1 from emptyBogoNewValues — just pick product.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'p-bag' } });

    fireEvent.click(screen.getByRole('button', { name: /Create BOGO/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0]![0] as PromotionFormValues;
    expect(submitted.type).toBe('bogo');
    expect(submitted.bogo_buy_quantity).toBe(2);
    expect(submitted.bogo_get_quantity).toBe(1);
    expect(submitted.bogo_get_product_id).toBe('p-bag');
  });

  it('blocks submit when no product picked', async () => {
    const onSubmit = vi.fn();
    render(
      <BogoForm
        mode="create"
        productOptions={PRODUCTS}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByPlaceholderText(/Buy 2 baguettes/), { target: { value: 'BOGO no product' } });
    fireEvent.change(screen.getByPlaceholderText(/bogo-2-1-baguette/), { target: { value: 'bogo-no-product' } });

    fireEvent.click(screen.getByRole('button', { name: /Create BOGO/i }));

    await waitFor(() => {
      expect(screen.getByText(/Pick a reward product/i)).toBeInTheDocument();
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ThresholdForm', () => {
  it('submits subtotal-percent threshold with cap', async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ThresholdForm mode="create" onSubmit={onSubmit} onCancel={() => {}} />,
    );

    fireEvent.change(screen.getByPlaceholderText(/Spend 100k/), { target: { value: 'Spend 100k Get 10' } });
    fireEvent.change(screen.getByPlaceholderText(/threshold-100k-10/), { target: { value: 'thr-100k-10' } });
    const ta = screen.getByLabelText('threshold-amount') as HTMLInputElement;
    fireEvent.change(ta, { target: { value: '100000' } });

    // Submit via the form element, not the button click (jsdom won't
    // dispatch the implicit form-submit from button[type=submit] reliably).
    const form = ta.closest('form')!;
    fireEvent.submit(form);

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0]![0] as PromotionFormValues;
    expect(submitted.type).toBe('threshold');
    expect(submitted.threshold_type).toBe('subtotal');
    expect(submitted.threshold_amount).toBe(100_000);
    expect(submitted.discount_value).toBe(10);
    expect(submitted.max_discount_amount).toBe(100_000);
  });

  it('initialValues with no cap renders as fixed kind', async () => {
    // Verify the discountKind derivation: initialValues with
    // max_discount_amount=null ⇒ kind=fixed ⇒ no cap input rendered.
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <ThresholdForm
        mode="edit"
        initialValues={{
          name: 'Threshold Fixed',
          slug: 'thr-fixed',
          description: null,
          type: 'threshold',
          scope: null,
          discount_value: 5000,
          max_discount_amount: null,
          scope_product_ids: [],
          scope_category_ids: [],
          bogo_trigger_product_ids: [],
          bogo_reward_product_ids: [],
          bogo_trigger_qty: null,
          bogo_reward_qty: null,
          bogo_reward_discount_pct: null,
          bogo_buy_quantity: null,
          bogo_get_quantity: null,
          bogo_get_product_id: null,
          threshold_amount: 50000,
          threshold_type: 'subtotal',
          bundle_product_ids: [],
          bundle_price: null,
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
          priority: 50,
          stackable_with_promo: false,
          stackable_with_manual: true,
          is_active: true,
        }}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );

    // Cap input should be absent.
    expect(screen.queryByLabelText('max-discount-amount')).toBeNull();
    // Fixed radio should be selected.
    expect((screen.getByRole('radio', { name: 'fixed' }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: 'percent' }) as HTMLInputElement).checked).toBe(false);

    // Submitting should preserve max=null.
    const form = screen.getByLabelText('threshold-amount').closest('form')!;
    fireEvent.submit(form);
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const submitted = onSubmit.mock.calls[0]![0] as PromotionFormValues;
    expect(submitted.max_discount_amount).toBeNull();
    expect(submitted.discount_value).toBe(5000);
  });
});
