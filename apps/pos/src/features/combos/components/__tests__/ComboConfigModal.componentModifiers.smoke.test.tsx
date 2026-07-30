// apps/pos/src/features/combos/components/__tests__/ComboConfigModal.componentModifiers.smoke.test.tsx
//
// ADR-017 — un composant retenu dans un combo se configure dans la MÊME modale,
// sous l'option qui l'a amené.
//
// Ce que ces tests tiennent :
//   T1 les groupes du composant n'apparaissent QUE si l'option est retenue ;
//   T2 rien n'est pré-coché — sinon le blocage de la décision 2 ne se
//      déclencherait jamais ;
//   T3 Confirm reste désactivé tant qu'un groupe requis est sans réponse ;
//   T4 le total affiché suit l'ajustement choisi ;
//   T5 Confirm émet les réponses SUR LE COMPOSANT, pas à plat sur la ligne.

/// <reference types="@testing-library/jest-dom" />
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ComboDefinition } from '@breakery/domain';

// Combo à 50 000 : « plate » (Omelette, défaut) et « drink » (Capuccino, +5 000)
// dont le composant porte HOT/ICED (requis) et Milk (requis, Oat +10 000).
const MOCK_DEF: ComboDefinition = {
  combo_product_id: 'p-combo',
  name: 'test',
  base_price: 50_000,
  groups: [
    {
      id: 'g-plate',
      name: 'plate',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 0,
      options: [
        { id: 'p-omelette', component_product_id: 'p-omelette', label: 'Omelette', surcharge: 0, is_default: true, sort_order: 0 },
      ],
    },
    {
      id: 'g-drink',
      name: 'drink',
      group_type: 'single',
      is_required: true,
      min_select: 1,
      max_select: 1,
      sort_order: 1,
      options: [
        { id: 'p-affogato', component_product_id: 'p-affogato', label: 'Affogato', surcharge: 0, is_default: true, sort_order: 0 },
        {
          id: 'p-capuccino',
          component_product_id: 'p-capuccino',
          label: 'Capuccino',
          surcharge: 5_000,
          is_default: false,
          sort_order: 1,
          component_modifier_groups: [
            {
              group_name: 'HOT/ICED',
              group_sort_order: 0,
              group_required: true,
              group_type: 'single_select',
              options: [
                { option_label: 'Hot', option_sort_order: 0, price_adjustment: 0, is_default: true },
                { option_label: 'Iced', option_sort_order: 1, price_adjustment: 0, is_default: false },
              ],
            },
            {
              group_name: 'Milk',
              group_sort_order: 1,
              group_required: true,
              group_type: 'single_select',
              options: [
                { option_label: 'Fresh', option_sort_order: 0, price_adjustment: 0, is_default: true },
                { option_label: 'Oat', option_sort_order: 1, price_adjustment: 10_000, is_default: false },
              ],
            },
          ],
        },
      ],
    },
  ],
};

vi.mock('@/features/combos/hooks/useComboConfig', () => ({
  useComboConfig: () => ({ data: MOCK_DEF, isLoading: false }),
}));

const { ComboConfigModal } = await import('../ComboConfigModal');

function renderModal(onConfirm = vi.fn()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ComboConfigModal
        open
        product={{ id: 'p-combo', name: 'test' }}
        onConfirm={onConfirm}
        onClose={vi.fn()}
      />
    </QueryClientProvider>,
  );
  return onConfirm;
}

/** Retenir Capuccino à la place du défaut Affogato. */
function pickCapuccino() {
  fireEvent.click(screen.getByLabelText('Capuccino'));
}

const confirmBtn = () => screen.getByRole('button', { name: /confirm/i });

describe('ComboConfigModal — modificateurs des composants (ADR-017)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('T1 n’affiche les groupes du composant que si son option est retenue', () => {
    renderModal();
    expect(screen.queryByTestId('component-modifiers-p-capuccino')).toBeNull();
    pickCapuccino();
    expect(screen.getByTestId('component-modifiers-p-capuccino')).toBeInTheDocument();
  });

  it('T2 ne pré-coche aucun groupe requis du composant', () => {
    renderModal();
    pickCapuccino();
    // « Hot » est is_default côté produit, mais rien ne doit être pré-répondu ici.
    expect(screen.getByLabelText('Capuccino HOT/ICED Hot')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByLabelText('Capuccino Milk Fresh')).toHaveAttribute('aria-pressed', 'false');
  });

  it('T3 garde Confirm désactivé tant qu’un groupe requis est sans réponse', () => {
    renderModal();
    pickCapuccino();
    expect(confirmBtn()).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Capuccino HOT/ICED Hot'));
    expect(confirmBtn()).toBeDisabled(); // Milk manque encore

    fireEvent.click(screen.getByLabelText('Capuccino Milk Fresh'));
    expect(confirmBtn()).toBeEnabled();
  });

  it('T3b re-taper la réponse courante la retire et bloque de nouveau', () => {
    renderModal();
    pickCapuccino();
    fireEvent.click(screen.getByLabelText('Capuccino HOT/ICED Hot'));
    fireEvent.click(screen.getByLabelText('Capuccino Milk Fresh'));
    expect(confirmBtn()).toBeEnabled();

    fireEvent.click(screen.getByLabelText('Capuccino Milk Fresh'));
    expect(confirmBtn()).toBeDisabled();
  });

  it('T4 le total suit l’ajustement du modificateur choisi', () => {
    renderModal();
    pickCapuccino();
    fireEvent.click(screen.getByLabelText('Capuccino HOT/ICED Iced'));
    fireEvent.click(screen.getByLabelText('Capuccino Milk Oat'));
    // 50 000 base + 5 000 surcharge d'option + 10 000 Oat
    expect(screen.getByText(/65[.,]000/)).toBeInTheDocument();
  });

  it('T5 Confirm émet les réponses SUR le composant', () => {
    const onConfirm = renderModal();
    pickCapuccino();
    fireEvent.click(screen.getByLabelText('Capuccino HOT/ICED Iced'));
    fireEvent.click(screen.getByLabelText('Capuccino Milk Oat'));
    fireEvent.click(confirmBtn());

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const arg = onConfirm.mock.calls[0]![0] as {
      components: { product_id: string; quantity: number; modifiers?: unknown[] }[];
      unitPrice: number;
    };

    const capu = arg.components.find((c) => c.product_id === 'p-capuccino');
    expect(capu?.modifiers).toEqual([
      { group_name: 'HOT/ICED', option_label: 'Iced', price_adjustment: 0 },
      { group_name: 'Milk', option_label: 'Oat', price_adjustment: 10_000 },
    ]);

    // Le composant sans modificateur n'invente pas de clé vide.
    const plate = arg.components.find((c) => c.product_id === 'p-omelette');
    expect(plate).toEqual({ product_id: 'p-omelette', quantity: 1 });

    // Le prix reste base_price : le serveur re-résout tout depuis components.
    expect(arg.unitPrice).toBe(50_000);
  });
});
