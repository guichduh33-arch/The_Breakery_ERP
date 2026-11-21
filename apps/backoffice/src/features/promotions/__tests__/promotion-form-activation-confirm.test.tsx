// ADR-045 déc. 4 : activer une promotion depuis le FORMULAIRE se confirme
// aussi (création active, ou édition inactive → active). Une édition qui
// garde l'état actif, ou une promotion inactive, s'enregistre sans détour.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PromotionFormValues } from '@breakery/ui';
import type { PromotionListRow } from '../hooks/usePromotionsList.js';

const mocks = vi.hoisted(() => ({
  create: vi.fn(() => Promise.resolve()),
  update: vi.fn(() => Promise.resolve()),
  submitValues: null as PromotionFormValues | null,
}));

vi.mock('@breakery/ui', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    // Le vrai formulaire est testé dans packages/ui : ici, un bouton soumet des valeurs fixées.
    PromotionForm: ({ onSubmit }: { onSubmit: (v: PromotionFormValues) => Promise<void> }) => (
      <button type="button" onClick={() => { if (mocks.submitValues) void onSubmit(mocks.submitValues); }}>
        Submit form
      </button>
    ),
  };
});
vi.mock('../hooks/useCreatePromotion.js', () => ({
  useCreatePromotion: () => ({ mutateAsync: mocks.create, isPending: false }),
}));
vi.mock('../hooks/useUpdatePromotion.js', () => ({
  useUpdatePromotion: () => ({ mutateAsync: mocks.update, isPending: false }),
}));
vi.mock('../hooks/usePromotionReferenceData.js', () => ({
  usePromotionReferenceData: () => ({
    isLoading: false, error: null,
    data: { products: [], categories: [], customerCategories: [], customerTiers: [] },
  }),
}));

import { emptyPromotionValues } from '@breakery/ui';
import { PromotionFormModal } from '../components/PromotionFormModal.js';

const values = (over: Partial<PromotionFormValues>): PromotionFormValues => ({
  ...emptyPromotionValues(), name: 'Happy Hour', type: 'percentage', discount_value: 15, ...over,
});
const row = (over: Partial<PromotionListRow>): PromotionListRow => ({
  ...values({}), id: 'p1', created_at: '2026-11-01T00:00:00Z', ...over,
});

beforeEach(() => {
  mocks.create.mockClear();
  mocks.update.mockClear();
  mocks.submitValues = null;
});

describe('PromotionFormModal activation', () => {
  it('asks for confirmation before creating an active promotion', async () => {
    const onClose = vi.fn();
    mocks.submitValues = values({ is_active: true });
    render(<PromotionFormModal open mode="create" onClose={onClose} />);
    fireEvent.click(screen.getByText('Submit form'));
    expect(await screen.findByText('Activate Happy Hour?')).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    await waitFor(() => { expect(mocks.create).toHaveBeenCalledTimes(1); });
    expect(onClose).toHaveBeenCalled();
  });

  it('writes nothing and keeps the form open when the activation is cancelled', async () => {
    const onClose = vi.fn();
    mocks.submitValues = values({ is_active: true });
    render(<PromotionFormModal open mode="edit" initialRow={row({ is_active: false })} onClose={onClose} />);
    fireEvent.click(screen.getByText('Submit form'));
    await screen.findByText('Activate Happy Hour?');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => { expect(screen.queryByText('Activate Happy Hour?')).not.toBeInTheDocument(); });
    expect(mocks.update).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('saves directly when the promotion was already active or stays inactive', async () => {
    mocks.submitValues = values({ is_active: true });
    const { unmount } = render(
      <PromotionFormModal open mode="edit" initialRow={row({ is_active: true })} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText('Submit form'));
    await waitFor(() => { expect(mocks.update).toHaveBeenCalledTimes(1); });
    expect(screen.queryByText('Activate Happy Hour?')).not.toBeInTheDocument();
    unmount();

    mocks.submitValues = values({ is_active: false });
    render(<PromotionFormModal open mode="create" onClose={vi.fn()} />);
    fireEvent.click(screen.getByText('Submit form'));
    await waitFor(() => { expect(mocks.create).toHaveBeenCalledTimes(1); });
  });
});
