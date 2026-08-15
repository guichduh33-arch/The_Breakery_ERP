// apps/backoffice/src/features/reports/hooks/useReportPeriod.ts
//
// Lot B (campagne Reports 2026-08-15) — LA période des rapports, unifiée.
//
// Avant ce hook, le module portait trois contrôles de comparaison, trois
// familles de noms de params URL (`start`/`end`, `from`/`to`, `date`), et trois
// fenêtres par défaut (29 j / 6 j / 89 j) : naviguer d'un rapport à l'autre
// perdait la période. Ici :
//
//   · params URL standardisés `start` / `end` / `cmp` (l'URL reste la source de
//     vérité, partageable — convention S57) ;
//   · presets nommés (today, 7d, 28d, mtd, last-month…), défaut unique 28 j ;
//   · quand l'URL est vierge, hydratation depuis sessionStorage : la période
//     SUIT la navigation inter-rapports dans la session, sans surprendre au
//     lendemain avec une fenêtre périmée (d'où session- et non localStorage) ;
//   · `compareRange` dérivée par `previousPeriod` (@breakery/domain,
//     calendar-aware : mois plein → mois précédent, sinon n-day shift).
//
// Les dates sont des dates MÉTIER (Asia/Makassar) : « aujourd'hui » se résout
// par `toLocalDateStr`, jamais par le fuseau du navigateur.

import { useCallback, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { previousPeriod, toLocalDateStr } from '@breakery/domain';
import { useUrlBoolean, useUrlState } from '@/hooks/useUrlState.js';

export type PeriodPreset =
  | 'today' | 'yesterday' | '7d' | '28d' | 'mtd' | 'last-month' | 'custom';

export const PRESET_LABELS: Record<Exclude<PeriodPreset, 'custom'>, string> = {
  'today':      'Today',
  'yesterday':  'Yesterday',
  '7d':         'Last 7 days',
  '28d':        'Last 28 days',
  'mtd':        'Month to date',
  'last-month': 'Last month',
};

const STORAGE_KEY = 'breakery.reports.period.v1';

/** Décale une date métier (YYYY-MM-DD) de `days` jours, en UTC pur. */
function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Bornes d'un preset, résolues contre le jour métier courant. */
export function presetRange(
  preset: Exclude<PeriodPreset, 'custom'>,
  today: string,
): { start: string; end: string } {
  switch (preset) {
    case 'today':     return { start: today, end: today };
    case 'yesterday': {
      const y = shiftDays(today, -1);
      return { start: y, end: y };
    }
    case '7d':  return { start: shiftDays(today, -6),  end: today };
    case '28d': return { start: shiftDays(today, -27), end: today };
    case 'mtd': return { start: `${today.slice(0, 8)}01`, end: today };
    case 'last-month': {
      const firstOfThis = new Date(`${today.slice(0, 8)}01T00:00:00Z`);
      const lastOfPrev  = new Date(firstOfThis.getTime() - 86_400_000);
      const prevIso     = lastOfPrev.toISOString().slice(0, 10);
      return { start: `${prevIso.slice(0, 8)}01`, end: prevIso };
    }
  }
}

/** Le preset dont les bornes correspondent exactement, sinon `custom`. */
export function derivePreset(start: string, end: string, today: string): PeriodPreset {
  for (const p of Object.keys(PRESET_LABELS) as Exclude<PeriodPreset, 'custom'>[]) {
    const r = presetRange(p, today);
    if (r.start === start && r.end === end) return p;
  }
  return 'custom';
}

function readStored(): { start: string; end: string } | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.start !== 'string' || typeof o.end !== 'string') return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(o.start) || !/^\d{4}-\d{2}-\d{2}$/.test(o.end)) return null;
    return { start: o.start, end: o.end };
  } catch {
    return null;
  }
}

export interface UseReportPeriodOptions {
  /** Fenêtre servie quand ni l'URL ni la session n'en portent une. */
  defaultPreset?: Exclude<PeriodPreset, 'custom'>;
  /**
   * Anciens noms de params lus en repli (une release), pour ne pas casser les
   * liens copiés avant l'unification — ex. `{ start: 'from', end: 'to' }`.
   */
  legacyKeys?: { start?: string; end?: string };
  /**
   * Extension lot E — repli legacy NON HOMOMORPHE. `legacyKeys` ne sait que
   * renommer un param en un autre ; PB1 portait `?month=5&year=2026`, deux
   * params qui ne SONT pas des bornes et doivent être calculés. Le résolveur
   * reçoit les params bruts et rend les bornes, ou `null` s'il ne reconnaît
   * rien. Le passer STABLE (défini au niveau module) : il entre en dépendance
   * du défaut, une identité neuve à chaque rendu le recalculerait sans fin.
   */
  legacyResolve?: (params: URLSearchParams) => { start: string; end: string } | null;
  /**
   * Extension lot E — le rapport n'existe qu'au MOIS (PB1, une déclaration
   * mensuelle au Bapenda). Toute borne résolue — URL, legacy, session, défaut —
   * est ramenée au mois civil qui contient `end`. Sans ça, une fenêtre de 28 j
   * héritée d'un autre rapport dans la même session ferait afficher « 19 Jul –
   * 15 Aug » au-dessus d'un rapport qui couvre, lui, un mois entier.
   */
  snapTo?: 'month';
  /**
   * Extension lot E — participation à la période PARTAGÉE de la session.
   *
   * Par défaut (`true`), la fenêtre consultée devient le défaut du prochain
   * rapport ouvert : c'est ce qui fait qu'on ne reperd pas sa période en
   * naviguant d'un rapport à l'autre. Ça n'a de sens qu'entre rapports qui
   * lisent une FENÊTRE.
   *
   * Une PHOTO D'ÉTAT (le bilan) n'en est pas une, et le partage y casse dans
   * les deux sens : elle héritait d'une date passée que personne n'avait
   * demandée, et elle réinjectait `start = end` dans la clé — le rapport
   * suivant s'ouvrait alors sur une seule journée. Posé à `false` : le défaut
   * est le `defaultPreset`, déterministe, et rien n'est écrit dans la clé.
   */
  sharedSession?: boolean;
}

/** Bornes du mois civil (1-12) — le dernier jour se déduit par le jour 0 du
 *  mois suivant, qui gère février et les années bissextiles. */
export function monthRange(year: number, month: number): { start: string; end: string } {
  const mm = String(month).padStart(2, '0');
  return {
    start: `${year}-${mm}-01`,
    end:   new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

/** Le mois civil qui contient `date` (YYYY-MM-DD). */
function snapToMonth(date: string): { start: string; end: string } {
  const m = /^(\d{4})-(\d{2})/.exec(date);
  if (m === null) return { start: date, end: date };
  return monthRange(Number(m[1]), Number(m[2]));
}

export interface ReportPeriod {
  start:   string;
  end:     string;
  /** Preset dérivé des bornes courantes (`custom` si aucune correspondance). */
  preset:  PeriodPreset;
  compare: boolean;
  /** Période précédente symétrique — à requêter quand `compare` est actif. */
  compareRange: { start: string; end: string };
  setPreset: (p: Exclude<PeriodPreset, 'custom'>) => void;
  setRange:  (start: string, end: string) => void;
  setCompare: (b: boolean) => void;
}

export function useReportPeriod(options: UseReportPeriodOptions = {}): ReportPeriod {
  const {
    defaultPreset = '28d', legacyKeys, legacyResolve, snapTo, sharedSession = true,
  } = options;
  const today = toLocalDateStr(new Date());

  // Ordre de résolution du défaut : legacy URL > session > preset. `useUrlState`
  // sert ce défaut tant que le param standard est absent de l'URL. Hors période
  // partagée, la session est SAUTÉE : le défaut est alors le seul preset, donc
  // déterministe — un écran d'état ne s'ouvre pas sur une date héritée.
  const [params, setParams] = useSearchParams();
  const defaults = useMemo(() => {
    const legacyStart = legacyKeys?.start !== undefined ? params.get(legacyKeys.start) : null;
    const legacyEnd   = legacyKeys?.end   !== undefined ? params.get(legacyKeys.end)   : null;
    if (legacyStart !== null && legacyEnd !== null) return { start: legacyStart, end: legacyEnd };
    const resolved = legacyResolve?.(params) ?? null;
    if (resolved !== null) return resolved;
    return (sharedSession ? readStored() : null) ?? presetRange(defaultPreset, today);
    // `params` volontairement hors dépendances : le défaut se fige au montage,
    // ensuite l'URL standard fait foi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPreset, today, legacyKeys?.start, legacyKeys?.end, legacyResolve, sharedSession]);

  const [rawStart] = useUrlState('start', defaults.start);
  const [rawEnd]   = useUrlState('end',   defaults.end);
  const [compare, setCompare] = useUrlBoolean('cmp');

  // La borne de FIN porte le mois : une fenêtre à cheval héritée de la session
  // (19 juil. → 15 août) doit donner août, le mois en cours, pas juillet.
  const snapped = snapTo === 'month' ? snapToMonth(rawEnd) : null;
  const start = snapped?.start ?? rawStart;
  const end   = snapped?.end   ?? rawEnd;

  // La période suit la navigation : chaque fenêtre consultée devient le défaut
  // du prochain rapport ouvert dans la même session. Hors période partagée, on
  // n'écrit RIEN : une photo d'état a `start = end`, et la réinjecter ferait
  // s'ouvrir le rapport suivant sur une seule journée.
  useEffect(() => {
    if (!sharedSession) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ start, end }));
    } catch {
      // stockage indisponible (navigation privée…) — l'URL suffit.
    }
  }, [start, end, sharedSession]);

  // Les DEUX bornes en une seule navigation : deux `setSearchParams` successifs
  // se recouvrent (l'updater fonctionnel part des params du dernier RENDU, pas
  // de la navigation en attente) — la seconde écriture perdrait la première.
  const setRange = useCallback((s: string, e: string) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (s === defaults.start || s === '') p.delete('start'); else p.set('start', s);
        if (e === defaults.end   || e === '') p.delete('end');   else p.set('end', e);
        return p;
      },
      { replace: true },
    );
  }, [setParams, defaults.start, defaults.end]);

  const setPreset = useCallback((p: Exclude<PeriodPreset, 'custom'>) => {
    const r = presetRange(p, toLocalDateStr(new Date()));
    setRange(r.start, r.end);
  }, [setRange]);

  const preset = derivePreset(start, end, today);
  const compareRange = useMemo(() => previousPeriod(start, end), [start, end]);

  return { start, end, preset, compare, compareRange, setPreset, setRange, setCompare };
}
