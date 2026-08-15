// apps/backoffice/src/features/reports/hooks/useSortedRows.ts
//
// Lot G (campagne Reports 2026-08-15) — LE tri de colonne du module, unifié.
//
// Les journaux sont des tables denses : sans tri, retrouver « le plus gros
// montant hors horaires » ou « la dernière révocation » demande de lire toutes
// les lignes. Chaque page qui voulait ce geste le réimplantait (StockLedgerTable
// en porte encore sa propre copie, hors module) : trois états locaux, trois
// cycles de clic, trois comparateurs. Ici, une fois.
//
// Trois règles portées par ce hook, et qui ne doivent pas se réinventer :
//
//  · L'ÉTAT NUL EST L'ORDRE SERVEUR. Le tri est OPT-IN : tant que personne n'a
//    cliqué, `rows` est le tableau reçu, inchangé et non recopié. L'ordre
//    d'origine porte souvent un sens (un journal est antichronologique, un
//    grand livre est un solde qui court) ; le remplacer d'office le détruirait.
//    D'où le cycle à TROIS temps — asc → desc → retour à l'ordre serveur.
//
//  · LE TRI EST STABLE. Le comparateur rend 0 sur une égalité, et `Array.sort`
//    est stable depuis ES2019 : à valeur égale, les lignes gardent leur ordre
//    d'origine — donc leur ordre chronologique. Un tri par « Action » laisse
//    ainsi chaque groupe d'actions en antichronologie, gratuitement.
//
//  · UNE VALEUR ABSENTE VA TOUJOURS EN BAS, dans les deux sens. Une colonne à
//    tirets remontée en tête par un tri décroissant n'apprend rien à personne ;
//    et l'inversion mécanique ferait alterner les trous entre le haut et le bas
//    d'un clic à l'autre. Le vide n'est pas une valeur extrême, il est absent.
//
// `specs` entre dans les dépendances du tri : le passer STABLE (défini au
// niveau module, ou mémoïsé), sinon chaque rendu recalculerait le tableau trié.

import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

/** Valeur d'`aria-sort` pour l'en-tête — la seule annonce de l'état au lecteur
 *  d'écran (WAI-ARIA `table` pattern). */
export type SortAria = 'ascending' | 'descending' | 'none';

/** Nature de la colonne — elle choisit le comparateur, pas le rendu. */
export type SortKind = 'number' | 'string' | 'date';

export type SortValue = string | number | null | undefined;

export interface SortSpec<T> {
  kind: SortKind;
  /** Extrait la valeur COMPARABLE de la ligne — pas ce qui est affiché. */
  value: (row: T) => SortValue;
}

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** Ce qu'un en-tête a besoin de connaître — sans le type des lignes, pour que
 *  `SortableTh` reste générique sur la seule clé. */
export interface SortControl<K extends string> {
  /** `null` = ordre serveur. */
  sort: SortState<K> | null;
  /** Un clic sur l'en-tête `key` : asc → desc → ordre serveur. */
  toggle: (key: K) => void;
  /** Retour explicite à l'ordre serveur. */
  reset: () => void;
  ariaSort: (key: K) => SortAria;
}

export interface SortedRows<T, K extends string> extends SortControl<K> {
  /** Les lignes triées, ou le tableau d'origine tel quel si `sort === null`. */
  rows: T[];
}

// Collation métier : « à » et « a » se rangent ensemble, et « Item 10 » suit
// « Item 9 » au lieu de le précéder (tri numérique intégré).
const collator = new Intl.Collator('id-ID', { sensitivity: 'base', numeric: true });

/** Une date comparable en millisecondes, ou `null` si elle n'en est pas une. */
function toEpoch(v: SortValue): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string' || v === '') return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

function isBlank(v: SortValue): boolean {
  return v === null || v === undefined || v === '';
}

/** Comparateur complet, DIRECTION COMPRISE : les vides ne s'inversent pas, ils
 *  ne peuvent donc pas passer par un simple facteur ±1 appliqué au résultat. */
export function compareRows<T>(a: T, b: T, spec: SortSpec<T>, dir: SortDir): number {
  const va = spec.value(a);
  const vb = spec.value(b);

  const ba = isBlank(va);
  const bb = isBlank(vb);
  if (ba && bb) return 0;
  if (ba) return 1;
  if (bb) return -1;

  const factor = dir === 'asc' ? 1 : -1;

  switch (spec.kind) {
    case 'number': {
      const na = Number(va);
      const nb = Number(vb);
      // Une valeur non numérique n'a pas d'ordre : on ne la déplace pas.
      if (Number.isNaN(na) || Number.isNaN(nb)) return 0;
      return factor * (na - nb);
    }
    case 'date': {
      const ta = toEpoch(va);
      const tb = toEpoch(vb);
      if (ta === null || tb === null) return 0;
      return factor * (ta - tb);
    }
    case 'string':
      return factor * collator.compare(String(va), String(vb));
  }
}

export function useSortedRows<T, K extends string>(
  rows: T[],
  specs: Readonly<Record<K, SortSpec<T>>>,
): SortedRows<T, K> {
  const [sort, setSort] = useState<SortState<K> | null>(null);

  const toggle = useCallback((key: K): void => {
    setSort((prev) => {
      if (prev?.key !== key) return { key, dir: 'asc' };
      if (prev.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }, []);

  const reset = useCallback((): void => { setSort(null); }, []);

  const ariaSort = useCallback(
    (key: K): SortAria => {
      if (sort?.key !== key) return 'none';
      return sort.dir === 'asc' ? 'ascending' : 'descending';
    },
    [sort],
  );

  const sorted = useMemo(() => {
    if (sort === null) return rows;
    const spec = specs[sort.key];
    // Clé inconnue (colonne retirée alors qu'un tri était actif) : on rend
    // l'ordre serveur plutôt qu'un tableau vide ou une exception.
    if (spec === undefined) return rows;
    return [...rows].sort((a, b) => compareRows(a, b, spec, sort.dir));
  }, [rows, sort, specs]);

  return { rows: sorted, sort, toggle, reset, ariaSort };
}
