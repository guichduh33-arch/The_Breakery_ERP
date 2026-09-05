// apps/backoffice/src/features/expenses/__tests__/approval-forecast.test.ts
//
// Lot 8 — la résolution du palier d'approbation est un miroir de celle de
// `submit_expense`. Ces tests figent les quatre points où un miroir approximatif
// mentirait à l'opérateur :
//   · l'intervalle est demi-ouvert, `[min, max)` ;
//   · une règle de catégorie bat la règle générale ;
//   · aucun palier ne veut dire REFUS serveur, pas « pas d'approbation » ;
//   · un montant vide ou nul n'affirme rien.

import { describe, it, expect } from 'vitest';
import { resolveApprovalForecast } from '@/features/expenses/hooks/useApprovalForecast.js';
import type { ExpenseThresholdRow } from '@/features/settings/expense-thresholds/hooks/useExpenseThresholds.js';

const row = (o: Partial<ExpenseThresholdRow> & { id: string }): ExpenseThresholdRow => ({
  category_id: null,
  category_name: null,
  amount_min: 0,
  amount_max: 100_000,
  steps: [],
  created_at: '',
  updated_at: '',
  ...o,
});

// Les trois paliers par défaut, tels que la migration de seed les pose.
const AUTO    = row({ id: 'auto',  amount_min: 0,          amount_max: 100_000 });
const ONE     = row({
  id: 'one',
  amount_min: 100_000,
  amount_max: 1_000_000,
  steps: [{ role_codes: ['MANAGER', 'ADMIN'], label: 'Manager approval' }],
});
const TWO     = row({
  id: 'two',
  amount_min: 1_000_000,
  amount_max: 9_999_999_999,
  steps: [
    { role_codes: ['MANAGER', 'ADMIN'], label: 'Manager approval' },
    { role_codes: ['ADMIN'],            label: 'Owner approval' },
  ],
});
const DEFAULTS = [AUTO, ONE, TWO];

describe('resolveApprovalForecast — montant vide ou nul', () => {
  it('n’affirme rien tant que les paliers ne sont pas chargés', () => {
    const f = resolveApprovalForecast(undefined, { categoryId: 'cat-1', amount: 4_850_000 });
    expect(f.status).toBe('pending');
    expect(f.steps).toEqual([]);
  });

  it('n’affirme rien sur un montant vide (null)', () => {
    expect(resolveApprovalForecast(DEFAULTS, { categoryId: 'cat-1', amount: null }).status)
      .toBe('pending');
  });

  it('n’affirme rien sur zéro ni sur NaN', () => {
    expect(resolveApprovalForecast(DEFAULTS, { categoryId: 'cat-1', amount: 0 }).status)
      .toBe('pending');
    expect(resolveApprovalForecast(DEFAULTS, { categoryId: 'cat-1', amount: Number.NaN }).status)
      .toBe('pending');
  });
});

describe('resolveApprovalForecast — palier trouvé', () => {
  it('résout la chaîne à deux étapes pour 4 850 000', () => {
    const f = resolveApprovalForecast(DEFAULTS, { categoryId: 'cat-1', amount: 4_850_000 });
    expect(f.status).toBe('chain');
    expect(f.matched?.id).toBe('two');
    expect(f.steps.map((s) => s.label)).toEqual(['Manager approval', 'Owner approval']);
    expect(f.caveat).toBeNull();
  });

  it('résout l’auto-approbation quand steps = [] — et ce n’est PAS « aucun palier »', () => {
    const f = resolveApprovalForecast(DEFAULTS, { categoryId: 'cat-1', amount: 50_000 });
    expect(f.status).toBe('auto-approve');
    expect(f.matched?.id).toBe('auto');
  });

  it('applique l’intervalle DEMI-OUVERT : un montant égal à amount_max tombe dans le palier suivant', () => {
    expect(resolveApprovalForecast(DEFAULTS, { categoryId: '', amount: 99_999 }).matched?.id)
      .toBe('auto');
    expect(resolveApprovalForecast(DEFAULTS, { categoryId: '', amount: 100_000 }).matched?.id)
      .toBe('one');
  });

  it('fait gagner la règle de catégorie sur la règle générale et nomme celle qu’elle écarte', () => {
    const CAT = row({
      id: 'cat-rule',
      category_id: 'cat-1',
      category_name: 'Utilities',
      amount_min: 0,
      amount_max: 9_999_999_999,
      steps: [{ role_codes: ['ADMIN'], label: 'Owner approval' }],
    });
    const f = resolveApprovalForecast([...DEFAULTS, CAT], { categoryId: 'cat-1', amount: 4_850_000 });
    expect(f.matched?.id).toBe('cat-rule');
    expect(f.overridden?.id).toBe('two');
    expect(f.steps).toHaveLength(1);
  });

  it('pose une réserve quand aucune catégorie n’est encore choisie', () => {
    const f = resolveApprovalForecast(DEFAULTS, { categoryId: '', amount: 4_850_000 });
    expect(f.matched?.id).toBe('two');
    expect(f.caveat).toMatch(/category rule can still override/i);
  });
});

describe('resolveApprovalForecast — aucun palier', () => {
  it('rend « unconfigured » quand rien ne couvre le montant', () => {
    const f = resolveApprovalForecast([AUTO], { categoryId: 'cat-1', amount: 4_850_000 });
    expect(f.status).toBe('unconfigured');
    expect(f.matched).toBeNull();
    expect(f.steps).toEqual([]);
  });

  it('rend « unconfigured » sur une liste de paliers vide', () => {
    expect(resolveApprovalForecast([], { categoryId: 'cat-1', amount: 1 }).status)
      .toBe('unconfigured');
  });
});
