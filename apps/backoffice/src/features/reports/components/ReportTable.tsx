// apps/backoffice/src/features/reports/components/ReportTable.tsx
//
// S3-22 — LA table de rapport, pilotée par une définition de colonnes. Elle
// assemble ce que le module avait déjà : `SortableTh` + `useSortedRows` (tri
// opt-in, ordre serveur à l'état nul), plus une recherche texte CLIENT sur les
// colonnes qui déclarent `searchText`.
//
// Ce qu'elle ne fait PAS, volontairement : paginer, charger, exporter. Les
// lignes arrivent entières de la page ; l'export reste à `ExportMenu`.
//
// Le pied de total se TAIT pendant une recherche qui restreint les lignes : il
// porte le total du jeu complet (servi par la RPC), et sous trois lignes sur
// quatre-vingts il se lirait comme leur somme. Le compteur « n of m » dit alors
// la restriction.

import { useMemo, useState, type JSX, type ReactNode } from 'react';
import { Input, cn } from '@breakery/ui';
import { useUrlState } from '@/hooks/useUrlState.js';
import { SortableTh } from './SortableTh.js';
import { useSortedRows, type SortSpec } from '../hooks/useSortedRows.js';
import { formatCount } from '../utils/reportFigures.js';

export const REPORT_CELL = 'py-2';
export const REPORT_NUM_CELL = 'py-2 text-right font-data tabular-nums';

export interface ReportColumn<T, K extends string> {
  /** Identifiant stable de la colonne (clé React). */
  id:      string;
  header:  string;
  /** Absente = colonne non triable. */
  sortKey?: K;
  /** `right` = colonne numérique (alignement + chiffres tabulaires). */
  align?:  'left' | 'right';
  cell:    (row: T) => ReactNode;
  /** Classe ajoutée à la cellule de corps. */
  className?: string;
  /** Cellule du pied ; omise = cellule vide. */
  footer?: ReactNode;
  /** Texte cherchable de la colonne ; absent = colonne hors recherche. */
  searchText?: (row: T) => string | null;
}

export interface ReportTableSearch {
  /** Libellé accessible du champ. */
  label:        string;
  placeholder?: string;
  /** Nom des lignes au singulier, pour le compteur (« product »). */
  noun:         string;
  /** Clé d'URL : la recherche survit au retour arrière. Absente = état local. */
  urlKey?:      string;
}

export interface ReportTableProps<T, K extends string> {
  rows:      T[];
  columns:   readonly ReportColumn<T, K>[];
  /** Specs de tri — STABLES (niveau module), `useSortedRows` les suit. */
  sortSpecs: Readonly<Record<K, SortSpec<T>>>;
  rowKey:    (row: T) => string;
  caption:   string;
  /** Rend le pied (`footer` des colonnes). */
  showFooter?: boolean;
  search?:   ReportTableSearch;
  /** Texte quand `rows` est vide. */
  emptyText?: string;
  testId?:   string;
}

/** Casse et accents ignorés : « creme » trouve « Crème brûlée ». */
function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}

function plural(noun: string, n: number): string {
  return n === 1 ? noun : `${noun}s`;
}

function useSearchQuery(urlKey: string | undefined): readonly [string, (v: string) => void] {
  // Les deux sources sont montées : un hook ne se choisit pas conditionnellement.
  const [fromUrl, setUrl] = useUrlState(urlKey ?? '__report_table_q', '');
  const [local, setLocal] = useState('');
  return urlKey !== undefined ? [fromUrl, setUrl] : [local, setLocal];
}

export function ReportTable<T, K extends string>({
  rows, columns, sortSpecs, rowKey, caption, showFooter = false, search,
  emptyText = 'No rows.', testId = 'report-table',
}: ReportTableProps<T, K>): JSX.Element {
  const [query, setQuery] = useSearchQuery(search?.urlKey);
  const needle = normalize(query.trim());

  const searchable = useMemo(
    () => columns.flatMap((c) => (c.searchText !== undefined ? [c.searchText] : [])),
    [columns],
  );

  // Un booléen en dépendance, pas l'objet `search` : la page le passe souvent
  // en littéral, une identité neuve à chaque rendu retrierait sans fin.
  const hasSearch = search !== undefined;
  const filtered = useMemo(() => {
    if (!hasSearch || needle === '' || searchable.length === 0) return rows;
    return rows.filter((r) => searchable.some((fn) => normalize(fn(r) ?? '').includes(needle)));
  }, [rows, needle, searchable, hasSearch]);

  const sorted = useSortedRows<T, K>(filtered, sortSpecs);
  const narrowed = filtered.length !== rows.length;

  return (
    <div className="space-y-2" data-testid={testId}>
      {search !== undefined && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={`${testId}-search`} className="sr-only">{search.label}</label>
          <Input
            id={`${testId}-search`}
            type="search"
            value={query}
            onChange={(e) => { setQuery(e.target.value); }}
            placeholder={search.placeholder}
            maxLength={80}
            className="h-9 w-64"
            data-testid={`${testId}-search`}
          />
          <span
            role="status"
            className="font-data text-xs tabular-nums text-text-muted"
            data-testid={`${testId}-count`}
          >
            {needle !== ''
              ? `${formatCount(filtered.length)} of ${formatCount(rows.length)} ${plural(search.noun, rows.length)}`
              : ''}
          </span>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-border-subtle text-text-secondary">
              {columns.map((c) => (
                <SortableTh
                  key={c.id}
                  label={c.header}
                  {...(c.sortKey !== undefined ? { sortKey: c.sortKey } : {})}
                  {...(c.align !== undefined ? { align: c.align } : {})}
                  sorted={sorted}
                />
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.rows.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="py-6 text-center text-text-muted">
                  {narrowed && search !== undefined
                    ? `No ${plural(search.noun, 2)} match “${query.trim()}”.`
                    : emptyText}
                </td>
              </tr>
            ) : sorted.rows.map((r) => (
              <tr key={rowKey(r)} className="border-b border-border-subtle">
                {columns.map((c) => (
                  <td
                    key={c.id}
                    className={cn(c.align === 'right' ? REPORT_NUM_CELL : REPORT_CELL, c.className)}
                  >
                    {c.cell(r)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {showFooter && !narrowed && sorted.rows.length > 0 && (
            <tfoot>
              <tr className="border-t border-border-subtle font-semibold" data-testid={`${testId}-footer`}>
                {columns.map((c) => (
                  <td key={c.id} className={c.align === 'right' ? REPORT_NUM_CELL : REPORT_CELL}>
                    {c.footer}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
