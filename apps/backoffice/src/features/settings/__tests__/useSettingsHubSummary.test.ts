// apps/backoffice/src/features/settings/__tests__/useSettingsHubSummary.test.ts
// Lot 5 chantier 1 — les formatteurs de valeur de tuile (purs, sans réseau).

import { describe, it, expect } from 'vitest';
import { compressBusinessHours, plural, summaryLineFor } from '../hooks/useSettingsHubSummary.js';

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

describe('plural', () => {
  it('accorde le nom sur le nombre', () => {
    expect(plural(0, 'role')).toBe('0 roles');
    expect(plural(1, 'role')).toBe('1 role');
    expect(plural(2, 'role')).toBe('2 roles');
  });

  it('accepte un pluriel irrégulier explicite', () => {
    expect(plural(1, 'entry', 'entries')).toBe('1 entry');
    expect(plural(3, 'entry', 'entries')).toBe('3 entries');
  });
});

// Critique du 2026-08-26 — SIX tuiles écrivaient « 1 methods enabled », « 1
// active tables », « 1 roles », « 1 approval tiers », « 1 quick amounts · 1
// discount presets », « 1 showcase items ». Le singulier est le seul cas qui
// distinguait le défaut de sa correction : c'est donc lui qu'on épingle, tuile
// par tuile, pour qu'aucune ne puisse repartir seule.
describe('summaryLineFor — accord au singulier', () => {
  it('rend le singulier sur chaque tuile qui compte', () => {
    expect(summaryLineFor('/backoffice/settings/payment-methods', {
      payment_methods: { enabled: 1 },
    })).toBe('1 method enabled');
    expect(summaryLineFor('/backoffice/settings/floor-plan', {
      floor_plan: { active_tables: 1 },
    })).toBe('1 active table');
    expect(summaryLineFor('/backoffice/settings/roles', {
      permissions: { roles: 1 },
    })).toBe('1 role');
    expect(summaryLineFor('/backoffice/settings/expense-thresholds', {
      expense_thresholds: { tiers: 1 },
    })).toBe('1 approval tier');
    expect(summaryLineFor('/backoffice/settings/pos', {
      pos_config: { quick_amounts: 1, opening_presets: 1, discount_presets: 1 },
    })).toBe('1 quick amount · 1 discount preset');
    expect(summaryLineFor('/backoffice/settings/customer-display', {
      customer_display: { slogan_set: true, showcase_count: 1, show_ready_orders: true },
    })).toBe('Slogan set · 1 showcase item');
    expect(summaryLineFor('/backoffice/settings/templates/receipt', {
      receipt_templates: { total: 1, default_name: null },
    })).toBe('1 template');
  });

  it('garde le pluriel au-delà de un', () => {
    expect(summaryLineFor('/backoffice/settings/roles', {
      permissions: { roles: 4 },
    })).toBe('4 roles');
    expect(summaryLineFor('/backoffice/settings/pos', {
      pos_config: { quick_amounts: 6, opening_presets: 2, discount_presets: 3 },
    })).toBe('6 quick amounts · 3 discount presets');
  });
});
