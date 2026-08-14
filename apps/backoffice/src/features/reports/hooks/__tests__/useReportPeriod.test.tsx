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
  useReportPeriod, presetRange, derivePreset,
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
