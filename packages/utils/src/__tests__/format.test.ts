import { describe, expect, it } from 'vitest';
import { formatCurrency, formatPercent, formatQuantity } from '../format.js';

// Les littéraux attendus utilisent U+00A0 ? Non : Intl id-ID en style
// 'decimal' sépare les milliers par « . » (U+002E) et n'insère pas d'espace
// insécable — c'est précisément pourquoi formatCurrency préfixe `Rp ` à la
// main plutôt que d'utiliser style 'currency'.

describe('formatCurrency', () => {
  it('formate en id-ID avec préfixe Rp et sans décimale', () => {
    expect(formatCurrency(2100000)).toBe('Rp 2.100.000');
    expect(formatCurrency(0)).toBe('Rp 0');
    expect(formatCurrency(5000)).toBe('Rp 5.000');
  });

  it('arrondit les fractions au rupiah entier', () => {
    expect(formatCurrency(1234.56)).toBe('Rp 1.235');
  });

  it('place le signe avant Rp pour les négatifs', () => {
    expect(formatCurrency(-35000)).toBe('-Rp 35.000');
  });

  it('mode compact id-ID (jt/rb), 2 décimales max', () => {
    expect(formatCurrency(1260000, { compact: true })).toBe('Rp 1,26 jt');
    expect(formatCurrency(320000, { compact: true })).toBe('Rp 320 rb');
  });

  it('tolère les strings numériques de PostgREST', () => {
    expect(formatCurrency('9175100')).toBe('Rp 9.175.100');
  });

  it('rend un tiret sur null/undefined/non-numérique', () => {
    expect(formatCurrency(null)).toBe('—');
    expect(formatCurrency(undefined)).toBe('—');
    expect(formatCurrency('abc')).toBe('—');
    expect(formatCurrency(Number.NaN)).toBe('—');
  });
});

describe('formatQuantity', () => {
  it('entier strict pour les unités de comptage', () => {
    expect(formatQuantity(5, 'pcs')).toBe('5 pcs');
    expect(formatQuantity(5.0, 'pcs')).toBe('5 pcs');
    expect(formatQuantity(1000000, 'pcs')).toBe('1.000.000 pcs');
    expect(formatQuantity(3, 'ROLL')).toBe('3 ROLL');
  });

  it('trois décimales max pour masse et volume', () => {
    expect(formatQuantity(0.035, 'lt')).toBe('0,035 lt');
    expect(formatQuantity(1.5, 'kg')).toBe('1,5 kg');
    expect(formatQuantity(999990, 'gr')).toBe('999.990 gr');
    expect(formatQuantity(2, 'kg')).toBe('2 kg');
  });

  it('la casse de l’unité ne change pas la règle, l’affichage garde le code fourni', () => {
    expect(formatQuantity(0.25, 'KG')).toBe('0,25 KG');
    expect(formatQuantity(4.7, 'roll')).toBe('5 roll');
  });

  it('unité inconnue ou absente : décimales préservées (max 3), jamais d’arrondi inventé', () => {
    expect(formatQuantity(12.5, null)).toBe('12,5');
    expect(formatQuantity(12, '')).toBe('12');
    expect(formatQuantity(1.25, 'portion')).toBe('1,25 portion');
  });

  it('rend un tiret sur null/non-numérique', () => {
    expect(formatQuantity(null, 'pcs')).toBe('—');
    expect(formatQuantity('abc', 'kg')).toBe('—');
  });

  it('tolère les strings numériques', () => {
    expect(formatQuantity('5.000', 'pcs')).toBe('5 pcs');
  });
});

describe('formatPercent', () => {
  // LA RÈGLE QUE CES TESTS PROTÈGENT : la décimale d'un pourcentage est une
  // VIRGULE, comme celle d'un montant. `toFixed()` rendait un point, et le
  // point est déjà le séparateur de MILLIERS en id-ID — « Rp 3.257.500 » à côté
  // de « -99.90% » donnait deux sens au même caractère sur le même écran.
  it('rend la décimale en virgule, comme les montants', () => {
    expect(formatPercent(12.5)).toBe('12,5%');
    expect(formatPercent(-99.9)).toBe('-99,9%');
    expect(formatPercent(0)).toBe('0,0%');
  });

  it('une décimale par défaut, zéro ou deux sur demande', () => {
    expect(formatPercent(33.333)).toBe('33,3%');
    expect(formatPercent(33.333, { digits: 0 })).toBe('33%');
    expect(formatPercent(33.333, { digits: 2 })).toBe('33,33%');
  });

  it('le signe + ne se pose que sur un positif STRICT', () => {
    expect(formatPercent(4.2, { signed: true })).toBe('+4,2%');
    expect(formatPercent(-4.2, { signed: true })).toBe('-4,2%');
    // Zéro n'a pas de signe : « +0,0% » affirmait une hausse qui n'a pas eu lieu.
    expect(formatPercent(0, { signed: true })).toBe('0,0%');
  });

  it('sépare les milliers comme un montant au-delà de 1000 %', () => {
    expect(formatPercent(1250.5)).toBe('1.250,5%');
  });

  it('rend un tiret sur null, undefined ou non-numérique', () => {
    expect(formatPercent(null)).toBe('—');
    expect(formatPercent(undefined)).toBe('—');
    expect(formatPercent('abc')).toBe('—');
    expect(formatPercent(Number.NaN)).toBe('—');
  });

  it('tolère les strings numériques de PostgREST', () => {
    expect(formatPercent('12.5')).toBe('12,5%');
  });
});
