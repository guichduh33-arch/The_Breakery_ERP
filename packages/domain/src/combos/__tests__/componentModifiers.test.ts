// packages/domain/src/combos/__tests__/componentModifiers.test.ts
//
// ADR-017 — un composant retenu dans un combo se configure comme s'il était
// vendu seul : ses groupes de modificateurs sont répondus (D2), facturés (D3)
// et, côté serveur, déduits (D4).
//
// Ces tests couvrent les deux règles PURES qui vivent dans le domaine :
//   - le prix ajoute les ajustements des modificateurs de composants ;
//   - un groupe REQUIS d'un composant retenu, sans réponse, bloque la
//     validation — et un groupe non requis ne bloque jamais.
import { describe, it, expect } from 'vitest';
import { configuredPrice } from '../pricing.js';
import { validateSelection } from '../validateSelection.js';
import type { ComboDefinition, ComboSelection } from '../types.js';

/** Combo à 50 000 : « plate » sans modificateur, « drink » dont la boisson
 *  porte HOT/ICED (requis, gratuit) et Milk (requis, Oat à +10 000). */
const def: ComboDefinition = {
  combo_product_id: 'combo',
  name: 'test',
  base_price: 50000,
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
        { id: 'o-plate', component_product_id: 'p-plate', label: 'Omelette', surcharge: 0, is_default: true, sort_order: 0 },
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
        {
          id: 'o-drink',
          component_product_id: 'p-drink',
          label: 'Capuccino',
          surcharge: 5000,
          is_default: false,
          sort_order: 0,
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
                { option_label: 'Oat', option_sort_order: 1, price_adjustment: 10000, is_default: false },
              ],
            },
            {
              group_name: 'Cup',
              group_sort_order: 2,
              group_required: false,
              group_type: 'single_select',
              options: [
                { option_label: 'Large', option_sort_order: 0, price_adjustment: 2000, is_default: false },
              ],
            },
          ],
        },
      ],
    },
  ],
};

const plate: ComboSelection = { group_id: 'g-plate', option_ids: ['o-plate'] };

function drink(mods: { group_name: string; option_label: string; price_adjustment: number }[]): ComboSelection {
  return { group_id: 'g-drink', option_ids: ['o-drink'], option_modifiers: { 'o-drink': mods } };
}

const HOT = { group_name: 'HOT/ICED', option_label: 'Hot', price_adjustment: 0 };
const FRESH = { group_name: 'Milk', option_label: 'Fresh', price_adjustment: 0 };
const OAT = { group_name: 'Milk', option_label: 'Oat', price_adjustment: 10000 };
const LARGE = { group_name: 'Cup', option_label: 'Large', price_adjustment: 2000 };

describe('ADR-017 D3 — le prix intègre les modificateurs des composants', () => {
  it('sans modificateur répondu, le prix reste base + surcharge d’option', () => {
    expect(configuredPrice(def, [plate, { group_id: 'g-drink', option_ids: ['o-drink'] }])).toBe(55000);
  });

  it('des modificateurs à 0 ne changent pas le prix', () => {
    expect(configuredPrice(def, [plate, drink([HOT, FRESH])])).toBe(55000);
  });

  it('un modificateur payant s’ajoute', () => {
    expect(configuredPrice(def, [plate, drink([HOT, OAT])])).toBe(65000);
  });

  it('les ajustements de plusieurs groupes se cumulent', () => {
    expect(configuredPrice(def, [plate, drink([HOT, OAT, LARGE])])).toBe(67000);
  });

  it('n’ajoute rien pour une option qui n’est plus retenue', () => {
    // option_modifiers porte une entrée orpheline : le groupe n'a rien de choisi.
    const orphan: ComboSelection = {
      group_id: 'g-drink',
      option_ids: [],
      option_modifiers: { 'o-drink': [OAT] },
    };
    expect(configuredPrice(def, [plate, orphan])).toBe(50000);
  });
});

describe('ADR-017 D2 — un groupe requis de composant sans réponse bloque', () => {
  it('bloque quand aucun modificateur n’est répondu', () => {
    const r = validateSelection(def, [plate, { group_id: 'g-drink', option_ids: ['o-drink'] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('HOT/ICED'))).toBe(true);
      expect(r.errors.some((e) => e.includes('Milk'))).toBe(true);
    }
  });

  it('bloque encore quand un seul des deux groupes requis est répondu', () => {
    const r = validateSelection(def, [plate, drink([HOT])]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('Milk'))).toBe(true);
      expect(r.errors.some((e) => e.includes('HOT/ICED'))).toBe(false);
    }
  });

  it('passe quand tous les groupes requis sont répondus', () => {
    expect(validateSelection(def, [plate, drink([HOT, FRESH])])).toEqual({ ok: true });
  });

  it('un groupe NON requis laissé vide ne bloque jamais', () => {
    const r = validateSelection(def, [plate, drink([HOT, FRESH])]);
    expect(r.ok).toBe(true);
  });

  it('l’option du composant doit exister dans son groupe', () => {
    const r = validateSelection(def, [
      plate,
      drink([HOT, { group_name: 'Milk', option_label: 'Ghost', price_adjustment: 0 }]),
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.includes('Ghost'))).toBe(true);
  });

  it('ne réclame rien pour une option non retenue', () => {
    // « drink » n'a rien de choisi : c'est le min_select du groupe combo qui
    // parle, pas les modificateurs d'un composant qui n'est pas dans le panier.
    const r = validateSelection(def, [plate, { group_id: 'g-drink', option_ids: [] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors.some((e) => e.includes('HOT/ICED'))).toBe(false);
      expect(r.errors.some((e) => e.includes('drink'))).toBe(true);
    }
  });

  it('un composant sans groupe de modificateurs ne bloque pas', () => {
    expect(validateSelection(def, [plate, drink([HOT, FRESH])])).toEqual({ ok: true });
  });
});
