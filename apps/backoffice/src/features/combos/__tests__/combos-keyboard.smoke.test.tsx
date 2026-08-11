// apps/backoffice/src/features/combos/__tests__/combos-keyboard.smoke.test.tsx
//
// Locks the keyboard-access fixes for the Combos surface (audit 2026-08-11):
// the grid used to be mouse-only — the card was a <div> carrying onClick, so
// opening a combo for edit was impossible without a pointer (WCAG 2.1.1, A).
// The picker had no Escape, and closing it dropped focus because it unmounts
// the button that opened it.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComboCard } from '../components/ComboCard.js';
import { ComboProductPicker } from '../components/ComboProductPicker.js';
import { ChoiceGroupCard, type GroupDraft } from '../components/ChoiceGroupCard.js';
import type { Combo } from '../types.js';

const { products } = vi.hoisted(() => ({
  products: {
    current: [
      { id: 'p-1', name: 'Americano', sku: 'BEV-001', retail_price: 35000, variant_label: null },
    ] as { id: string; name: string; sku: string; retail_price: number; variant_label: string | null }[],
  },
}));

vi.mock('../hooks/useFinishedProductsForCombo.js', () => ({
  useFinishedProductsForCombo: () => ({
    data: products.current,
    isLoading: false,
    isError: false,
  }),
}));

const COMBO: Combo = {
  id: 'cb-1',
  name: 'Morning Set',
  sku: 'CMB-001',
  retail_price: 45000,
  value_price: 52000,
  price_min: 45000,
  price_max: 52000,
  is_active: true,
  image_url: null,
  groups: [],
};

const GROUP: GroupDraft = {
  id: 'g-1',
  name: 'Drinks',
  group_type: 'multi',
  is_required: true,
  min_select: 1,
  max_select: 2,
  sort_order: 0,
  options: [],
};

function renderCard(props: Partial<{ onEdit: () => void }> = {}) {
  return render(
    <MemoryRouter>
      <ComboCard combo={COMBO} {...props} />
    </MemoryRouter>,
  );
}

describe('ComboCard — keyboard access', () => {
  it('exposes the combo as a link named by the combo, pointing at its edit route', () => {
    renderCard();
    const link = screen.getByRole('link', { name: 'Morning Set' });
    expect(link).toHaveAttribute('href', '/backoffice/products/combos/cb-1/edit');
  });

  it('does not put the click handler on the card container itself', () => {
    renderCard();
    const card = screen.getByTestId('combo-card-cb-1');
    expect(card.tagName).toBe('DIV');
    expect(card.onclick).toBeNull();
  });

  it('keeps a styled focus ring on the card once the title is focused', () => {
    renderCard();
    // The style half of the ring used to be stripped by tailwind-merge on its
    // way through cn(); without it the browser draws its own ring instead.
    const card = screen.getByTestId('combo-card-cb-1');
    expect(card.className).toContain('focus-within:outline ');
    expect(card.className).toContain('focus-within:outline-2');
    expect(card.className).toContain('focus-within:outline-gold');
  });

  it('falls back to a real button when an onEdit handler is supplied', () => {
    const onEdit = vi.fn();
    renderCard({ onEdit });
    const button = screen.getByRole('button', { name: 'Morning Set' });
    fireEvent.click(button);
    expect(onEdit).toHaveBeenCalledTimes(1);
  });
});

describe('ComboProductPicker — escape et bornage de la liste', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<ComboProductPicker onPick={vi.fn()} onClose={onClose} />);
    fireEvent.keyDown(screen.getByTestId('combo-picker-search'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('borne la liste rendue et annonce ce qui est masqué', () => {
    // Le catalogue réel compte ~375 produits finis. Tout rendre ajoutait autant
    // d'arrêts de tabulation entre la recherche et le contrôle suivant.
    products.current = Array.from({ length: 300 }, (_, i) => ({
      id: `p-${i}`,
      name: `Product ${i}`,
      sku: `SKU-${i}`,
      retail_price: 10000,
      variant_label: null,
    }));

    try {
      render(<ComboProductPicker onPick={vi.fn()} onClose={vi.fn()} />);

      const rows = screen.getAllByTestId(/^combo-picker-row-/);
      expect(rows.length).toBe(25);
      expect(screen.getByRole('listbox', { name: 'Matching products' })).toBeInTheDocument();
      expect(screen.getByTestId('combo-picker-overflow').textContent).toMatch(/25 of\s*300/);
    } finally {
      products.current = [
        { id: 'p-1', name: 'Americano', sku: 'BEV-001', retail_price: 35000, variant_label: null },
      ];
    }
  });
});

describe('ChoiceGroupCard — labels and focus return', () => {
  it('gives the min/max selection inputs an accessible name', () => {
    render(<ChoiceGroupCard group={GROUP} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText('Min')).toBe(screen.getByTestId('group-min-g-1'));
    expect(screen.getByLabelText('Max')).toBe(screen.getByTestId('group-max-g-1'));
  });

  it('returns focus to Add Product when the picker is dismissed', () => {
    render(<ChoiceGroupCard group={GROUP} onChange={vi.fn()} onRemove={vi.fn()} />);

    fireEvent.click(screen.getByTestId('add-option-g-1'));
    expect(screen.getByTestId('combo-product-picker')).toBeInTheDocument();

    fireEvent.keyDown(screen.getByTestId('combo-picker-search'), { key: 'Escape' });

    const addButton = screen.getByTestId('add-option-g-1');
    expect(screen.queryByTestId('combo-product-picker')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(addButton);
  });
});
