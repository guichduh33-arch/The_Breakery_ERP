// apps/backoffice/src/features/reports/utils/__tests__/reportFigures.test.ts
//
// Lot D (campagne Reports 2026-08-15) — les deux règles que ces helpers portent
// pour tout le module, et qui ne doivent pas se réinventer page par page :
//
//  · une comparaison contre une base NULLE n'existe pas → `null`, jamais
//    `Infinity` ni « 0 % » ;
//  · une TRONCATURE D'AFFICHAGE NE TRONQUE PAS LE TOTAL.

import { describe, it, expect } from 'vitest';
import {
  MAX_DAYS, MONTH_NAMES, eachDay, formatCount, formatPct1, longDate, pctChange,
  periodLabel, sharePct, shortDate, topSlice,
} from '../reportFigures.js';

describe('pctChange', () => {
  it('rend la variation relative en %', () => {
    expect(pctChange(150, 100)).toBe(50);
    expect(pctChange(50, 100)).toBe(-50);
    expect(pctChange(100, 100)).toBe(0);
  });

  it('rend `null` quand la comparaison n’existe pas — jamais l’infini', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(100, undefined)).toBeNull();
    expect(pctChange(100, Number.NaN)).toBeNull();
    expect(pctChange(100, Number.POSITIVE_INFINITY)).toBeNull();
  });

  // Lot F — la règle CHANGE ici, et le test d'avant encodait l'ancienne.
  // `pctChange(-50, -100)` rendait `+50` : le dénominateur en valeur absolue
  // faisait lire « +50 % » (vert, « ça monte ») sur une grandeur qui reste un
  // déficit de 50. Et de la perte au profit, aucun pourcentage ne décrit un
  // changement de signe. Base négative → pas de ratio.
  it('rend `null` sur une base NÉGATIVE — un delta signé n’y veut rien dire', () => {
    expect(pctChange(-50, -100)).toBeNull();
    expect(pctChange(50, -100)).toBeNull();
    expect(pctChange(-150, -100)).toBeNull();
  });
});

describe('eachDay', () => {
  it('énumère la fenêtre, bornes comprises', () => {
    expect(eachDay('2026-06-05', '2026-06-08'))
      .toEqual(['2026-06-05', '2026-06-06', '2026-06-07', '2026-06-08']);
    expect(eachDay('2026-06-05', '2026-06-05')).toEqual(['2026-06-05']);
  });

  it('traverse une fin de mois et une fin d’année', () => {
    expect(eachDay('2026-02-27', '2026-03-01'))
      .toEqual(['2026-02-27', '2026-02-28', '2026-03-01']);
    expect(eachDay('2025-12-31', '2026-01-01')).toEqual(['2025-12-31', '2026-01-01']);
  });

  it('rend une liste vide sur une fenêtre inversée ou illisible', () => {
    expect(eachDay('2026-06-08', '2026-06-05')).toEqual([]);
    expect(eachDay('not-a-date', '2026-06-05')).toEqual([]);
  });

  it('plafonne une plage absurde', () => {
    expect(eachDay('2020-01-01', '2030-01-01')).toHaveLength(MAX_DAYS);
  });
});

describe('MONTH_NAMES', () => {
  it('porte les douze mois, janvier en tête', () => {
    expect(MONTH_NAMES).toHaveLength(12);
    expect(MONTH_NAMES[0]).toBe('January');
    expect(MONTH_NAMES[11]).toBe('December');
  });
});

describe('sharePct', () => {
  it('rend la part, et 0 quand la base est nulle', () => {
    expect(sharePct(25, 100)).toBe(25);
    expect(sharePct(25, 0)).toBe(0);
  });
});

describe('topSlice', () => {
  const all = Array.from({ length: 8 }, () => ({ v: 1_000_000 }));

  it('coupe l’AFFICHAGE mais totalise le jeu COMPLET', () => {
    const cut = topSlice(all, (r) => r.v);
    expect(cut.rows).toHaveLength(5);
    expect(cut.total).toBe(8_000_000);
    expect(cut.note).toBe('Top 5 of 8 by revenue.');
  });

  it('pas de note quand rien n’est coupé', () => {
    const cut = topSlice(all.slice(0, 3), (r) => r.v);
    expect(cut.rows).toHaveLength(3);
    expect(cut.total).toBe(3_000_000);
    expect(cut.note).toBeUndefined();
  });

  it('le critère de coupe est nommé dans la note', () => {
    expect(topSlice(all, (r) => r.v, 'discount value', 2).note)
      .toBe('Top 2 of 8 by discount value.');
  });
});

describe('formatteurs de date métier', () => {
  it('formate en UTC — un fuseau navigateur négatif ne recule pas la journée', () => {
    expect(shortDate('2026-06-07')).toBe('7 Jun');
    expect(longDate('2026-06-07')).toBe('Sunday, 7 June 2026');
  });

  it('rend l’entrée telle quelle si elle n’est pas une date', () => {
    expect(shortDate('not-a-date')).toBe('not-a-date');
    expect(longDate('not-a-date')).toBe('not-a-date');
  });

  it('periodLabel : une date seule quand les bornes coïncident', () => {
    expect(periodLabel('2026-06-07', '2026-06-07')).toBe('Sunday, 7 June 2026');
    expect(periodLabel('2026-06-01', '2026-06-07')).toBe('1 Jun – 7 Jun');
  });
});

describe('formatteurs numériques', () => {
  it('comptage et pourcentage en locale métier (id-ID)', () => {
    expect(formatCount(1_234)).toBe('1.234');
    expect(formatPct1(80)).toBe('80,0%');
  });
});
