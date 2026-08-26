// apps/backoffice/src/features/accounting/__tests__/journal-description.test.ts
//
// Critique 2026-08-26 — les descriptions d'écriture exposaient des UUID bruts.
// La substitution se fait au rendu, jamais en base : ces tests bornent le
// découpage pur, la page se contente de peindre les fragments.

import { describe, it, expect } from 'vitest';
import {
  collectUuids,
  segmentDescription,
} from '@/features/accounting/utils/journalDescription.js';

const PRODUCT = '998c9eee-a28e-4a59-9d27-3d14e6d150f3';
const CUSTOMER = '1efa89d3-8bc1-4d54-8c77-1b1db1d4dfed';

describe('collectUuids', () => {
  it('dédoublonne, ignore les descriptions vides et normalise la casse', () => {
    const ids = collectUuids([
      `Stock movement adjustment for product ${PRODUCT}`,
      `Another line about ${PRODUCT.toUpperCase()}`,
      `B2B payment received from customer ${CUSTOMER}`,
      null,
      '',
      'Manual entry with no identifier',
    ]);
    expect(ids.sort()).toEqual([CUSTOMER, PRODUCT].sort());
  });

  it('ne rend rien quand aucune description ne porte d’identifiant', () => {
    expect(collectUuids(['April rent', null])).toEqual([]);
  });
});

describe('segmentDescription', () => {
  const names = new Map([[PRODUCT, 'Croissant au beurre']]);

  it('remplace l’identifiant par le nom et garde l’original sur le fragment', () => {
    const segs = segmentDescription(
      `Stock movement adjustment for product ${PRODUCT}`,
      names,
    );
    expect(segs.map((s) => s.text).join('')).toBe(
      'Stock movement adjustment for product Croissant au beurre',
    );
    const named = segs.filter((s) => s.uuid !== null);
    expect(named).toHaveLength(1);
    expect(named[0]?.uuid).toBe(PRODUCT);
  });

  it('laisse l’identifiant VISIBLE quand il n’est pas résolu', () => {
    const segs = segmentDescription(
      `B2B payment received from customer ${CUSTOMER}`,
      names,
    );
    expect(segs).toHaveLength(1);
    expect(segs[0]?.uuid).toBeNull();
    expect(segs[0]?.text).toContain(CUSTOMER);
  });

  it('traite plusieurs identifiants dans une même phrase', () => {
    const two = new Map([[PRODUCT, 'Croissant'], [CUSTOMER, 'Warung Ibu Sari']]);
    const segs = segmentDescription(`${PRODUCT} paid by ${CUSTOMER}`, two);
    expect(segs.map((s) => s.text).join('')).toBe('Croissant paid by Warung Ibu Sari');
    expect(segs.filter((s) => s.uuid !== null)).toHaveLength(2);
    // Les clés servent de `key` React : elles doivent être distinctes.
    expect(new Set(segs.map((s) => s.key)).size).toBe(segs.length);
  });

  it('rend la description intacte quand elle ne contient aucun identifiant', () => {
    const segs = segmentDescription('April rent', names);
    expect(segs).toEqual([{ key: 0, text: 'April rent', uuid: null }]);
  });
});
