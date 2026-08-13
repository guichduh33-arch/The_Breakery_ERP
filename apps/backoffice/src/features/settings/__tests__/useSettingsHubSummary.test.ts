// apps/backoffice/src/features/settings/__tests__/useSettingsHubSummary.test.ts
// Lot 5 chantier 1 — les formatteurs de valeur de tuile (purs, sans réseau).

import { describe, it, expect } from 'vitest';
import { compressBusinessHours, summaryLineFor } from '../hooks/useSettingsHubSummary.js';

describe('compressBusinessHours', () => {
  it('groupe les jours consécutifs identiques et nomme les fermés', () => {
    const hours = {
      mon: { open: '07:00', close: '21:00' },
      tue: { open: '07:00', close: '21:00' },
      wed: { open: '07:00', close: '21:00' },
      thu: { open: '07:00', close: '21:00' },
      fri: { open: '07:00', close: '21:00' },
      sat: { open: '07:00', close: '21:00' },
      sun: null,
    };
    expect(compressBusinessHours(hours)).toBe('Mon–Sat 07:00–21:00 · Sun closed');
  });

  it('ne fusionne pas des horaires différents', () => {
    const hours = {
      mon: { open: '07:00', close: '21:00' },
      tue: { open: '07:00', close: '21:00' },
      wed: { open: '08:00', close: '20:00' },
      thu: null, fri: null, sat: null, sun: null,
    };
    expect(compressBusinessHours(hours)).toBe(
      'Mon–Tue 07:00–21:00 · Wed 08:00–20:00 · Thu–Sun closed',
    );
  });

  it('rend null quand rien n’est configuré (objet vide = tout fermé)', () => {
    expect(compressBusinessHours({})).toBeNull();
    expect(compressBusinessHours(undefined)).toBeNull();
  });
});

describe('summaryLineFor', () => {
  it('undefined pour une tuile sans concept de valeur (le blurb reste)', () => {
    expect(summaryLineFor('/backoffice/settings/history', {})).toBeUndefined();
    expect(summaryLineFor(undefined, {})).toBeUndefined();
  });

  it('null pour une section gatée absente du payload (tiret honnête)', () => {
    expect(summaryLineFor('/backoffice/lan-devices', {})).toBeNull();
    expect(summaryLineFor('/backoffice/settings/security', {})).toBeNull();
  });

  it('formate les sections présentes', () => {
    expect(summaryLineFor('/backoffice/settings/general', {
      company: { name: 'The Breakery', currency: 'IDR', tax_inclusive: true, tax_rate: 10 },
    })).toBe('The Breakery · IDR · tax 10% incl.');
    expect(summaryLineFor('/backoffice/lan-devices', {
      lan_devices: { active: 3, total: 4 },
    })).toBe('3/4 active');
    expect(summaryLineFor('/backoffice/settings/accounting', {
      accounting: { open_period_start: null },
    })).toBe('No open period');
  });
});
