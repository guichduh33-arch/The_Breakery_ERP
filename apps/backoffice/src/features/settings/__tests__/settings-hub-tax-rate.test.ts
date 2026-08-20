// apps/backoffice/src/features/settings/__tests__/settings-hub-tax-rate.test.ts
//
// FILET ANTI-RÉGRESSION du lot « le hub Réglages dit le vrai taux »
// (2026-08-20). Le défaut fermé : la tuile lisait `business_config.tax_rate`,
// stocké en FRACTION, et l'imprimait brute avec un `%` — elle annonçait
// « tax 0.1% » à une boutique dont le PB1 est à 10 %.
//
// Le test porte sur les DEUX moitiés du défaut, parce que corriger la première
// sans la seconde produit « tax 10.000000000000002% » :
//  1. la conversion fraction → pourcent ;
//  2. l'arrondi qui tue le bruit de virgule flottante.

import { describe, expect, it } from 'vitest';

import { percentFromFraction, summaryLineFor } from '../hooks/useSettingsHubSummary.js';

describe('percentFromFraction', () => {
  it('rend 10 pour le PB1 tel que la base le stocke', () => {
    expect(percentFromFraction(0.1)).toBe(10);
  });

  it('n’introduit pas de bruit de virgule flottante', () => {
    // Le taux d’aujourd’hui tombe juste (0.1 * 100 === 10), donc il ne prouve
    // rien : ce sont les AUTRES taux qui cassent. Vérifié dans node —
    // 0.07 * 100 = 7.000000000000001 et 0.29 * 100 = 28.999999999999996.
    expect(String(percentFromFraction(0.1))).toBe('10');
    expect(String(percentFromFraction(0.07))).toBe('7');
    expect(String(percentFromFraction(0.29))).toBe('29');
    expect(String(percentFromFraction(0.005))).toBe('0.5');
  });

  it('ne multiplie pas une valeur déjà encodée en pourcent', () => {
    expect(percentFromFraction(10)).toBe(10);
    expect(percentFromFraction(11)).toBe(11);
  });

  it('tient les bornes sans rendre NaN', () => {
    expect(percentFromFraction(0)).toBe(0);
    expect(percentFromFraction(1)).toBe(100);
    expect(percentFromFraction(Number.NaN)).toBe(0);
    expect(percentFromFraction(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('tuile General du hub Réglages', () => {
  const summary = {
    company: { name: 'The Breakery', currency: 'IDR', tax_inclusive: true, tax_rate: 0.1 },
  };

  it('annonce le taux que la fiche Réglages affiche, pas la fraction', () => {
    const value = summaryLineFor('/backoffice/settings/general', summary);
    expect(value).toBe('The Breakery · IDR · tax 10% incl.');
    expect(value).not.toContain('0.1%');
  });

  it('dit « excl. » quand la taxe n’est pas incluse', () => {
    const value = summaryLineFor('/backoffice/settings/general', {
      company: { ...summary.company, tax_inclusive: false },
    });
    expect(value).toBe('The Breakery · IDR · tax 10% excl.');
  });

  it('rend un tiret honnête quand la section est absente du payload', () => {
    expect(summaryLineFor('/backoffice/settings/general', {})).toBeNull();
  });
});
