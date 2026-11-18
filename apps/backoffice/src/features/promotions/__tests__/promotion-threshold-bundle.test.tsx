// apps/backoffice/src/features/promotions/__tests__/promotion-threshold-bundle.test.tsx
//
// S3-11 — palier et formule de bout en bout côté back-office : la modale
// réelle, le formulaire partagé, `toRow`, puis la ligne envoyée à PostgREST.
// La ligne doit satisfaire `chk_promotion_type_fields` (migration
// 20260714000165) et les CHECK de colonne (20260517000081), recopiés ici en
// JS. Le serveur lit « pourcentage » quand `max_discount_amount` est renseigné
// (`evaluate_promotions`) : un palier fixe doit donc partir avec un plafond NULL.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PromotionFormModal } from '../components/PromotionFormModal.js';
import { toRow, type PromotionUpdate } from '../hooks/promotionRowMappers.js';
import type { PromotionListRow } from '../hooks/usePromotionsList.js';
import { emptyPromotionValues } from '@breakery/ui';

const sent = vi.hoisted(() => ({
  inserts: [] as unknown[],
  updates: [] as unknown[],
}));

vi.mock('@/lib/supabase.js', () => {
  function chain(result: unknown): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.single = () => Promise.resolve({ data: result, error: null });
    return c;
  }
  return {
    supabase: {
      from: () => ({
        insert: (row: unknown) => { sent.inserts.push(row); return chain(row); },
        update: (row: unknown) => { sent.updates.push(row); return chain(row); },
      }),
    },
  };
});

vi.mock('../hooks/usePromotionReferenceData.js', () => ({
  usePromotionReferenceData: () => ({
    isLoading: false,
    error: null,
    data: {
      products: [
        { id: '11111111-1111-1111-1111-111111111111', label: 'Croissant' },
        { id: '22222222-2222-2222-2222-222222222222', label: 'Americano' },
      ],
      categories: [],
      customerCategories: [],
      customerTiers: [],
    },
  }),
}));

/** Recopie JS de `chk_promotion_type_fields` + CHECK de colonne, pour les deux types ouverts. */
function satisfiesCheck(row: PromotionUpdate): boolean {
  if (row.type === 'threshold') {
    return row.threshold_amount !== null && row.threshold_amount !== undefined && row.threshold_amount >= 0
      && (row.threshold_type === 'subtotal' || row.threshold_type === 'quantity')
      && row.discount_value !== null && row.discount_value !== undefined && row.discount_value >= 0;
  }
  if (row.type === 'bundle') {
    return Array.isArray(row.bundle_product_ids) && row.bundle_product_ids.length >= 2
      && row.bundle_price !== null && row.bundle_price !== undefined && row.bundle_price >= 0;
  }
  return false;
}

function renderModal(mode: 'create' | 'edit', initialRow?: PromotionListRow): ReturnType<typeof vi.fn> {
  const onClose = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <PromotionFormModal open mode={mode} {...(initialRow ? { initialRow } : {})} onClose={onClose} />
    </QueryClientProvider>,
  );
  return onClose;
}

function fillIdentity(): void {
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Big basket' } });
  fireEvent.change(screen.getByLabelText(/^Slug/), { target: { value: 'big-basket' } });
}

beforeEach(() => {
  sent.inserts = [];
  sent.updates = [];
});

describe('PromotionFormModal — threshold & bundle (S3-11)', () => {
  it('threshold on subtotal, fixed amount → row passes the CHECK with no cap', async () => {
    const onClose = renderModal('create');
    fillIdentity();
    fireEvent.click(screen.getByRole('tab', { name: 'threshold' }));
    fireEvent.change(screen.getByLabelText(/Minimum subtotal/i), { target: { value: '300000' } });
    fireEvent.change(screen.getByLabelText(/^Discount \(IDR\)/i), { target: { value: '30000' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const row = sent.inserts[0] as PromotionUpdate;
    expect(row).toMatchObject({
      type: 'threshold', scope: null, threshold_type: 'subtotal', threshold_amount: 300_000,
      discount_value: 30_000, max_discount_amount: null,
    });
    expect(row).not.toHaveProperty('threshold_discount_mode');
    expect(satisfiesCheck(row)).toBe(true);
  });

  it('threshold on quantity, percent → row carries the cap the server reads as percent', async () => {
    const onClose = renderModal('create');
    fillIdentity();
    fireEvent.click(screen.getByRole('tab', { name: 'threshold' }));
    fireEvent.click(screen.getByLabelText(/Number of items/i));
    fireEvent.change(screen.getByLabelText(/Minimum items in cart/i), { target: { value: '5' } });
    fireEvent.click(screen.getByLabelText(/Percentage of subtotal/i));
    fireEvent.change(screen.getByLabelText(/^Discount \(%\)/i), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText(/Max discount amount/i), { target: { value: '50000' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const row = sent.inserts[0] as PromotionUpdate;
    expect(row).toMatchObject({
      type: 'threshold', threshold_type: 'quantity', threshold_amount: 5,
      discount_value: 10, max_discount_amount: 50_000,
    });
    expect(satisfiesCheck(row)).toBe(true);
  });

  it('bundle with 2 products → row passes the CHECK', async () => {
    const onClose = renderModal('create');
    fillIdentity();
    fireEvent.click(screen.getByRole('tab', { name: 'bundle' }));
    const picker = screen.getByLabelText<HTMLSelectElement>('Bundle products');
    for (const opt of Array.from(picker.options)) opt.selected = true;
    fireEvent.change(picker);
    fireEvent.change(screen.getByLabelText(/Bundle price/i), { target: { value: '40000' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const row = sent.inserts[0] as PromotionUpdate;
    expect(row).toMatchObject({
      type: 'bundle', scope: null, bundle_price: 40_000,
      bundle_product_ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
    });
    expect(satisfiesCheck(row)).toBe(true);
  });

  it('bundle with 1 product is rejected before any write', async () => {
    renderModal('create');
    fillIdentity();
    fireEvent.click(screen.getByRole('tab', { name: 'bundle' }));
    const picker = screen.getByLabelText<HTMLSelectElement>('Bundle products');
    const first = picker.options[0];
    if (first !== undefined) first.selected = true;
    fireEvent.change(picker);
    fireEvent.change(screen.getByLabelText(/Bundle price/i), { target: { value: '40000' } });
    fireEvent.click(screen.getByRole('button', { name: /Create promotion/i }));

    expect(await screen.findByText(/at least 2 different products/i)).toBeInTheDocument();
    expect(sent.inserts).toHaveLength(0);
  });

  it('editing a stored percent threshold loads its values and switching to fixed clears the cap', async () => {
    const stored: PromotionListRow = {
      ...emptyPromotionValues(),
      id: 'promo-1', created_at: '2026-11-01T00:00:00Z',
      name: 'Weekend basket', slug: 'weekend-basket',
      type: 'threshold', scope: null, threshold_type: 'subtotal', threshold_amount: 500_000,
      discount_value: 8, max_discount_amount: 75_000,
    };
    const onClose = renderModal('edit', stored);
    expect(screen.getByLabelText(/Minimum subtotal/i)).toHaveValue(500_000);
    expect(screen.getByLabelText(/Percentage of subtotal/i)).toBeChecked();
    expect(screen.getByLabelText(/Max discount amount/i)).toHaveValue(75_000);

    fireEvent.click(screen.getByLabelText(/Fixed amount \(IDR\)/i));
    fireEvent.change(screen.getByLabelText(/^Discount \(IDR\)/i), { target: { value: '40000' } });
    fireEvent.click(screen.getByRole('button', { name: /Save changes/i }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const row = sent.updates[0] as PromotionUpdate;
    expect(row).toMatchObject({ type: 'threshold', discount_value: 40_000, max_discount_amount: null });
    expect(satisfiesCheck(row)).toBe(true);
  });

  it('editing a stored bundle loads its products and price', () => {
    const stored: PromotionListRow = {
      ...emptyPromotionValues(),
      id: 'promo-2', created_at: '2026-11-01T00:00:00Z',
      name: 'Breakfast set', slug: 'breakfast-set', type: 'bundle', scope: null,
      bundle_product_ids: ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'],
      bundle_price: 42_000,
    };
    renderModal('edit', stored);
    const picker = screen.getByLabelText<HTMLSelectElement>('Bundle products');
    expect(picker.selectedOptions).toHaveLength(2);
    expect(screen.getByLabelText(/Bundle price/i)).toHaveValue(42_000);
  });
});

describe('toRow — threshold guard', () => {
  it('never writes a cap for a fixed threshold, even when one is passed', () => {
    const row = toRow({ type: 'threshold', threshold_discount_mode: 'fixed', max_discount_amount: 10_000 });
    expect(row.max_discount_amount).toBeNull();
    expect(row).not.toHaveProperty('threshold_discount_mode');
  });
});
