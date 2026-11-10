// apps/backoffice/src/features/reports/hooks/useReportFilters.ts
//
// S3-22 — l'état des filtres d'un rapport, piloté par une liste DÉCLARATIVE de
// définitions et persisté dans l'URL, une clé par filtre (même convention que
// la période : l'URL est la source de vérité, partageable, et survit au retour
// arrière).
//
// Deux règles :
//  · TOUTE écriture passe par UNE navigation. Deux `setSearchParams` successifs
//    se recouvrent (l'updater part des params du dernier rendu) : « Clear
//    filters » perdrait toutes les clés sauf une.
//  · Une liste `strict` (valeurs d'enum Postgres) ignore une valeur d'URL hors
//    de ses options : un lien bricolé ne part pas au serveur et n'affiche pas
//    un filtre « actif » invisible. Une liste chargée à la volée (catégories)
//    n'est pas stricte — ses options arrivent après le premier rendu.

import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface ReportFilterOption {
  value: string;
  label: string;
}

interface ReportFilterBase<K extends string> {
  /** Clé d'URL ET clé de l'objet des valeurs. */
  key:   K;
  /** Libellé visible du contrôle. */
  label: string;
  /** Classe de largeur du contrôle (ex. `w-40`). */
  width?: string;
}

export interface ReportSelectFilter<K extends string> extends ReportFilterBase<K> {
  kind:     'select';
  /** Libellé de l'option vide (« All … »). */
  allLabel: string;
  options:  readonly ReportFilterOption[];
  /** Valeur d'URL hors options = filtre inactif. */
  strict?:  boolean;
}

export interface ReportTextFilter<K extends string> extends ReportFilterBase<K> {
  kind:         'text';
  placeholder?: string;
  maxLength?:   number;
}

export type ReportFilterDef<K extends string> = ReportSelectFilter<K> | ReportTextFilter<K>;

export interface ReportFiltersState<K extends string> {
  /** Toutes les clés, '' quand le filtre est inactif. */
  values:    Readonly<Record<K, string>>;
  /** Seulement les filtres actifs — l'objet à transmettre au serveur. */
  active:    Readonly<Partial<Record<K, string>>>;
  /** Un filtre déclaré OU une clé `extraKeys` est actif. */
  hasActive: boolean;
  setValue:  (key: K, next: string) => void;
  /** Efface tous les filtres déclarés, en une navigation. */
  clear:     () => void;
}

function readValue<K extends string>(def: ReportFilterDef<K>, params: URLSearchParams): string {
  const raw = (params.get(def.key) ?? '').trim();
  if (raw === '') return '';
  if (def.kind === 'select' && def.strict === true
    && !def.options.some((o) => o.value === raw)) return '';
  return raw;
}

export interface UseReportFiltersOptions {
  /**
   * Clés d'URL d'autres restrictions de la page (ex. la recherche `q` de
   * `ReportTable`) : « Clear filters » les retire dans la MÊME navigation, et
   * leur seule présence suffit à montrer le bouton. Sans elles, un tableau
   * resterait restreint après l'effacement, sans filtre visible.
   * Passer un tableau STABLE (niveau module).
   */
  extraKeys?: readonly string[];
}

const NO_EXTRA_KEYS: readonly string[] = [];

export function useReportFilters<K extends string>(
  defs: readonly ReportFilterDef<K>[],
  { extraKeys = NO_EXTRA_KEYS }: UseReportFiltersOptions = {},
): ReportFiltersState<K> {
  const [params, setParams] = useSearchParams();
  const extraActive = extraKeys.some((k) => (params.get(k) ?? '').trim() !== '');

  const { values, active } = useMemo(() => {
    const all: Partial<Record<K, string>> = {};
    const on:  Partial<Record<K, string>> = {};
    for (const def of defs) {
      const v = readValue(def, params);
      all[def.key] = v;
      if (v !== '') on[def.key] = v;
    }
    return { values: all as Record<K, string>, active: on };
  }, [defs, params]);

  const setValue = useCallback((key: K, next: string) => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        const v = next.trim();
        if (v === '') p.delete(key); else p.set(key, v);
        return p;
      },
      { replace: true },
    );
  }, [setParams]);

  const clear = useCallback(() => {
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        for (const def of defs) p.delete(def.key);
        for (const k of extraKeys) p.delete(k);
        return p;
      },
      { replace: true },
    );
  }, [defs, extraKeys, setParams]);

  return {
    values, active, hasActive: Object.keys(active).length > 0 || extraActive, setValue, clear,
  };
}
