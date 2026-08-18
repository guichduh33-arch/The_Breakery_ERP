// apps/backoffice/src/features/products/__tests__/hidden-columns-url.test.ts
//
// Lot E — le choix de colonnes du catalogue rejoint l'URL.
//
// L'enjeu tient dans un seul cas : distinguer « je n'ai rien choisi » de « j'ai
// tout affiché ». Sans cette distinction, l'utilisateur qui rappelle la colonne
// `type` — masquée par défaut faute de budget de largeur — la reperdrait au
// premier retour arrière, le défaut réécrasant son choix. D'où le sentinel
// `none`, que ces tests tiennent.

import { describe, it, expect } from 'vitest';
import {
  PRODUCT_DEFAULT_HIDDEN_COLUMNS,
  PRODUCT_HIDE_NONE,
  parseHiddenColumns,
  serializeHiddenColumns,
  type ProductColumnId,
} from '../types.js';

describe('parseHiddenColumns', () => {
  it('paramètre absent = le défaut, pas « tout afficher »', () => {
    expect([...parseHiddenColumns(null)]).toEqual([...PRODUCT_DEFAULT_HIDDEN_COLUMNS]);
    expect([...parseHiddenColumns('')]).toEqual([...PRODUCT_DEFAULT_HIDDEN_COLUMNS]);
  });

  it('« none » = rien de masqué — un choix explicite que le défaut n’écrase pas', () => {
    expect([...parseHiddenColumns(PRODUCT_HIDE_NONE)]).toEqual([]);
  });

  it('borne la liste sur les colonnes connues', () => {
    expect([...parseHiddenColumns('margin,lol,status')].sort()).toEqual(['margin', 'status']);
  });

  it('une valeur entièrement inconnue retombe sur le défaut, pas sur le vide', () => {
    // Retomber sur « tout afficher » ferait passer une URL bricolée pour un
    // choix que personne n'a fait.
    expect([...parseHiddenColumns('lol,zzz')]).toEqual([...PRODUCT_DEFAULT_HIDDEN_COLUMNS]);
  });
});

describe('serializeHiddenColumns', () => {
  it('le défaut ne s’écrit pas — l’URL d’une page vierge reste propre', () => {
    expect(serializeHiddenColumns(new Set(PRODUCT_DEFAULT_HIDDEN_COLUMNS))).toBeNull();
  });

  it('l’ensemble vide s’écrit « none », jamais une chaîne vide', () => {
    expect(serializeHiddenColumns(new Set())).toBe(PRODUCT_HIDE_NONE);
  });

  it('ordre CANONIQUE : deux clics inverses donnent la même URL', () => {
    const a = new Set<ProductColumnId>(['status', 'type']);
    const b = new Set<ProductColumnId>(['type', 'status']);
    expect(serializeHiddenColumns(a)).toBe('type,status');
    expect(serializeHiddenColumns(a)).toBe(serializeHiddenColumns(b));
  });

  it('aller-retour : ce qu’on écrit se relit à l’identique', () => {
    for (const set of [
      new Set<ProductColumnId>([]),
      new Set<ProductColumnId>(['type']),
      new Set<ProductColumnId>(['cost', 'margin', 'type']),
    ]) {
      expect([...parseHiddenColumns(serializeHiddenColumns(set))].sort())
        .toEqual([...set].sort());
    }
  });
});
