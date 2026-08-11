// apps/pos/src/features/settings/hooks/__tests__/parseShowcaseProductIds.test.ts
//
// ADR-023 — la sélection de vitrine vit dans une colonne `jsonb`, donc typée
// `Json` côté TS : sa forme n'est garantie par aucun type-check. Un id abîmé
// qui partirait dans un `.in('id', …)` ferait échouer la requête et vider la
// vitrine entière — on le jette ici plutôt qu'en base.

import { describe, it, expect } from 'vitest';

import {
  parseShowcaseProductIds,
  SHOWCASE_MAX_PRODUCTS,
} from '../useOrgDisplaySettings';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

describe('parseShowcaseProductIds', () => {
  it('conserve l’ordre de la sélection', () => {
    expect(parseShowcaseProductIds([B, A])).toEqual([B, A]);
  });

  it('écarte ce qui n’est pas un uuid, sans jeter le reste', () => {
    expect(parseShowcaseProductIds([A, 'pas-un-uuid', 42, null, B])).toEqual([A, B]);
  });

  it('dédoublonne', () => {
    expect(parseShowcaseProductIds([A, A.toUpperCase(), B])).toEqual([A, B]);
  });

  it('borne la sélection au plafond de la colonne', () => {
    const many = Array.from({ length: 20 }, (_, i) =>
      `${String(i).padStart(8, '0')}-1111-4111-8111-111111111111`,
    );
    expect(parseShowcaseProductIds(many)).toHaveLength(SHOWCASE_MAX_PRODUCTS);
  });

  it('rend une liste vide pour tout ce qui n’est pas un tableau', () => {
    expect(parseShowcaseProductIds(null)).toEqual([]);
    expect(parseShowcaseProductIds(undefined)).toEqual([]);
    expect(parseShowcaseProductIds({ ids: [A] })).toEqual([]);
    expect(parseShowcaseProductIds('[]')).toEqual([]);
  });
});
