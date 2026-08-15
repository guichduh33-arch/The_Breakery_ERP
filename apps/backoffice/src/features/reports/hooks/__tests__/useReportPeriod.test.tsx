// apps/backoffice/src/features/reports/hooks/__tests__/useReportPeriod.test.tsx
//
// Lot B (campagne Reports 2026-08-15) — la période unifiée : presets résolus
// contre le jour MÉTIER, params URL standardisés, repli sur les anciens noms,
// hydratation sessionStorage, et compareRange dérivée. C'est le contrat qui
// remplace trois contrôles et trois familles de params : il se verrouille.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// Jour métier figé — les presets se calculent contre lui, pas contre le fuseau
// du poste de test.
vi.mock('@breakery/domain', async (importOriginal) => {
  const mod = await importOriginal<Record<string, unknown>>();
  return { ...mod, toLocalDateStr: () => '2026-08-15' };
});

import {
  useReportPeriod, presetRange, derivePreset, monthRange,
} from '../useReportPeriod.js';

function wrapperAt(initialEntry: string) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <MemoryRouter initialEntries={[initialEntry]}>{children}</MemoryRouter>;
  };
}

beforeEach(() => {
  sessionStorage.clear();
});

describe('presetRange / derivePreset (purs)', () => {
  const today = '2026-08-15';

  it('résout les six presets contre le jour métier', () => {
    expect(presetRange('today', today)).toEqual({ start: '2026-08-15', end: '2026-08-15' });
    expect(presetRange('yesterday', today)).toEqual({ start: '2026-08-14', end: '2026-08-14' });
    expect(presetRange('7d', today)).toEqual({ start: '2026-08-09', end: '2026-08-15' });
    expect(presetRange('28d', today)).toEqual({ start: '2026-07-19', end: '2026-08-15' });
    expect(presetRange('mtd', today)).toEqual({ start: '2026-08-01', end: '2026-08-15' });
    expect(presetRange('last-month', today)).toEqual({ start: '2026-07-01', end: '2026-07-31' });
  });

  it('dérive le preset des bornes, custom sinon', () => {
    expect(derivePreset('2026-08-09', '2026-08-15', today)).toBe('7d');
    expect(derivePreset('2026-07-01', '2026-07-31', today)).toBe('last-month');
    expect(derivePreset('2026-06-01', '2026-08-15', today)).toBe('custom');
  });
});

describe('useReportPeriod', () => {
  it('défaut : 28 jours glissants', () => {
    const { result } = renderHook(() => useReportPeriod(), {
      wrapper: wrapperAt('/backoffice/reports/daily-sales'),
    });
    expect(result.current.start).toBe('2026-07-19');
    expect(result.current.end).toBe('2026-08-15');
    expect(result.current.preset).toBe('28d');
    expect(result.current.compare).toBe(false);
  });

  it("l'URL standard fait foi (start/end/cmp)", () => {
    const { result } = renderHook(() => useReportPeriod(), {
      wrapper: wrapperAt('/x?start=2026-08-01&end=2026-08-15&cmp=1'),
    });
    expect(result.current.start).toBe('2026-08-01');
    expect(result.current.preset).toBe('mtd');
    expect(result.current.compare).toBe(true);
  });

  it('replie sur les anciens noms de params (from/to)', () => {
    const { result } = renderHook(
      () => useReportPeriod({ legacyKeys: { start: 'from', end: 'to' } }),
      { wrapper: wrapperAt('/x?from=2026-05-01&to=2026-05-31') },
    );
    expect(result.current.start).toBe('2026-05-01');
    expect(result.current.end).toBe('2026-05-31');
  });

  it('hydrate depuis sessionStorage quand l’URL est vierge, et persiste', () => {
    sessionStorage.setItem(
      'breakery.reports.period.v1',
      JSON.stringify({ start: '2026-08-03', end: '2026-08-10' }),
    );
    const { result } = renderHook(() => useReportPeriod(), {
      wrapper: wrapperAt('/x'),
    });
    expect(result.current.start).toBe('2026-08-03');
    expect(result.current.end).toBe('2026-08-10');

    act(() => result.current.setPreset('7d'));
    expect(result.current.start).toBe('2026-08-09');
    expect(JSON.parse(sessionStorage.getItem('breakery.reports.period.v1') ?? '{}')).toEqual({
      start: '2026-08-09',
      end:   '2026-08-15',
    });
  });

  it('ignore un sessionStorage corrompu', () => {
    sessionStorage.setItem('breakery.reports.period.v1', '{broken');
    const { result } = renderHook(() => useReportPeriod(), {
      wrapper: wrapperAt('/x'),
    });
    expect(result.current.preset).toBe('28d');
  });

  it('compareRange = période précédente symétrique (calendar-aware)', () => {
    const { result } = renderHook(() => useReportPeriod(), {
      wrapper: wrapperAt('/x?start=2026-07-01&end=2026-07-31'),
    });
    // Mois plein → mois précédent plein, pas un décalage de 31 jours.
    expect(result.current.compareRange).toEqual({ start: '2026-06-01', end: '2026-06-30' });
  });
});

// --- Extensions lot E ---------------------------------------------------------

describe('monthRange (pur)', () => {
  it('borne le mois civil, février bissextile compris', () => {
    expect(monthRange(2026, 8)).toEqual({ start: '2026-08-01', end: '2026-08-31' });
    expect(monthRange(2026, 2)).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(monthRange(2024, 2)).toEqual({ start: '2024-02-01', end: '2024-02-29' });
  });
});

describe('useReportPeriod — snapTo: month', () => {
  it('ramène une fenêtre à cheval au mois civil qui contient la FIN', () => {
    const { result } = renderHook(() => useReportPeriod({ snapTo: 'month' }), {
      wrapper: wrapperAt('/x?start=2026-07-19&end=2026-08-15'),
    });
    // Le mois en cours, pas juillet : c'est la borne de fin qui porte le mois.
    expect(result.current.start).toBe('2026-08-01');
    expect(result.current.end).toBe('2026-08-31');
  });

  it('protège le rapport mensuel d’une fenêtre héritée de la session', () => {
    sessionStorage.setItem(
      'breakery.reports.period.v1',
      JSON.stringify({ start: '2026-08-03', end: '2026-08-10' }),
    );
    const { result } = renderHook(() => useReportPeriod({ snapTo: 'month' }), {
      wrapper: wrapperAt('/x'),
    });
    expect(result.current.start).toBe('2026-08-01');
    expect(result.current.end).toBe('2026-08-31');
  });
});

describe('useReportPeriod — legacyResolve', () => {
  /** Repli PB1 : `?month=&year=` ne se renomme pas en bornes, il se calcule. */
  function pb1Legacy(params: URLSearchParams): { start: string; end: string } | null {
    const m = Number(params.get('month'));
    const y = Number(params.get('year'));
    if (!Number.isInteger(m) || m < 1 || m > 12) return null;
    if (!Number.isInteger(y) || y < 2000 || y > 2999) return null;
    return monthRange(y, m);
  }

  it('calcule les bornes depuis des params qui n’en sont pas', () => {
    const { result } = renderHook(
      () => useReportPeriod({ legacyResolve: pb1Legacy, snapTo: 'month' }),
      { wrapper: wrapperAt('/x?month=3&year=2025') },
    );
    expect(result.current.start).toBe('2025-03-01');
    expect(result.current.end).toBe('2025-03-31');
  });

  it('rend la main au défaut quand il ne reconnaît rien', () => {
    const { result } = renderHook(
      () => useReportPeriod({ legacyResolve: pb1Legacy, snapTo: 'month' }),
      { wrapper: wrapperAt('/x?month=13&year=2025') },
    );
    expect(result.current.start).toBe('2026-08-01');
    expect(result.current.end).toBe('2026-08-31');
  });
});

describe('useReportPeriod — sharedSession', () => {
  const STORAGE_KEY = 'breakery.reports.period.v1';
  /** Une fenêtre laissée par un AUTRE rapport dans la même session. */
  function seedSession(): void {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ start: '2026-07-01', end: '2026-07-31' }),
    );
  }

  it('`false` : défaut DÉTERMINISTE malgré une clé de session posée', () => {
    seedSession();
    const { result } = renderHook(
      () => useReportPeriod({ defaultPreset: 'today', sharedSession: false }),
      { wrapper: wrapperAt('/backoffice/reports/balance-sheet') },
    );
    // Aujourd'hui, pas le mois de juillet hérité du rapport précédent.
    expect(result.current.start).toBe('2026-08-15');
    expect(result.current.end).toBe('2026-08-15');
  });

  it('`false` : n’écrit RIEN dans la clé partagée, même après un changement', () => {
    seedSession();
    const { result } = renderHook(
      () => useReportPeriod({ defaultPreset: 'today', sharedSession: false }),
      { wrapper: wrapperAt('/backoffice/reports/balance-sheet') },
    );
    act(() => result.current.setRange('2026-03-31', '2026-03-31'));
    expect(result.current.end).toBe('2026-03-31');
    // La clé porte toujours la fenêtre du rapport précédent : la photo d'état
    // n'a pas réinjecté sa journée unique.
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      start: '2026-07-01',
      end:   '2026-07-31',
    });
  });

  it('défaut (option absente) : hérite ET écrit, comportement inchangé', () => {
    seedSession();
    const { result } = renderHook(() => useReportPeriod(), {
      wrapper: wrapperAt('/backoffice/reports/daily-sales'),
    });
    expect(result.current.start).toBe('2026-07-01');
    expect(result.current.end).toBe('2026-07-31');

    act(() => result.current.setPreset('7d'));
    expect(JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({
      start: '2026-08-09',
      end:   '2026-08-15',
    });
  });
});
