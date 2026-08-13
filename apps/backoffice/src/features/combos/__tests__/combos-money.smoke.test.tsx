// apps/backoffice/src/features/combos/__tests__/combos-money.smoke.test.tsx
//
// Verrouille la règle « un seul formateur monétaire » (audit 2026-08-11).
// ComboCard branchait sur <Currency> quand price_min === price_max et sur
// `toLocaleString('id-ID')` sinon, si bien qu'une même carte pouvait afficher
// « Rp 105.000 » et « Rp 100,000 » — deux séparateurs de milliers pour la même
// devise. PricePreview avait encore un troisième formateur, son propre Intl.
//
// Le format de référence du back-office est celui de `formatCurrency`
// (packages/utils), câblé en `id-ID` : POINT pour les milliers, « Rp 100.000 »
// — audit UX/UI du 2026-08-13, lot 1. Le POS garde `formatIdr` (en-US), d'où
// la prop `format` passée à <Currency> par les composants du BO. Le séparateur
// FAUTIF est donc désormais la virgule, et c'est elle que le test interdit.

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ComboCard } from '../components/ComboCard.js';
import { PricePreview } from '../components/PricePreview.js';
import type { Combo } from '../types.js';
import type { ComboDefinition } from '@breakery/domain';

function combo(overrides: Partial<Combo> = {}): Combo {
  return {
    id: 'cb-1',
    name: 'Morning Set',
    sku: 'CMB-001',
    retail_price: 100000,
    value_price: 105000,
    price_min: 100000,
    price_max: 110000,
    is_active: true,
    image_url: null,
    groups: [],
    ...overrides,
  };
}

function renderCard(c: Combo) {
  return render(
    <MemoryRouter>
      <ComboCard combo={c} />
    </MemoryRouter>,
  );
}

const NO_GROUPS: ComboDefinition = {
  combo_product_id: 'cb-1',
  name: 'Morning Set',
  base_price: 75000,
  groups: [],
};

describe('ComboCard — un seul format monétaire', () => {
  it('rend une fourchette avec le séparateur du helper, jamais le point', () => {
    renderCard(combo());
    const card = screen.getByTestId('combo-card-cb-1');

    expect(card.textContent).toContain('Rp 100.000');
    expect(card.textContent).toContain('Rp 110.000');
    expect(card.textContent).not.toMatch(/Rp\s?\d{1,3},\d{3}/);
  });

  it('rend un prix unique dans le même format que la fourchette', () => {
    renderCard(combo({ price_min: 100000, price_max: 100000 }));
    const card = screen.getByTestId('combo-card-cb-1');

    expect(card.textContent).toContain('Rp 100.000');
    expect(card.textContent).not.toMatch(/Rp\s?\d{1,3},\d{3}/);
  });

  it('rend le Value Price barré dans le même format', () => {
    renderCard(combo());
    expect(screen.getByTestId('combo-card-cb-1').textContent).toContain('Rp 105.000');
  });

  it('ne rend aucun montant en Playfair', () => {
    renderCard(combo());
    const card = screen.getByTestId('combo-card-cb-1');
    expect(card.querySelectorAll('.font-display').length).toBe(0);
  });
});

describe('PricePreview — même formateur, et sa réserve', () => {
  it('utilise le format du helper et non un Intl local', () => {
    render(<PricePreview definition={NO_GROUPS} />);
    const preview = screen.getByTestId('price-preview');

    expect(preview.textContent).toContain('Rp 75.000');
    expect(preview.textContent).not.toContain('75,000');
  });

  it('annonce que la valeur est une estimation arbitrée côté serveur', () => {
    render(<PricePreview definition={NO_GROUPS} />);
    expect(screen.getByTestId('price-preview').textContent).toMatch(/estimate/i);
  });
});
