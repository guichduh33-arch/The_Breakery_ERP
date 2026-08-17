// packages/ui/src/components/DataTable.tsx
//
// DataTable — generic, themed data table used across the backoffice.
//
// Session 14 / Phase 1.A — establishes the canonical table chrome:
//   - Header cells use SectionLabel (uppercase tracking-widest text-muted)
//   - Optional zebra striping (every other row tinted with surface-3)
//   - Sort indicator (chevron) when a column is sortable + onSortChange
//   - Empty state slot renders EmptyState when rows.length === 0
//   - Loading skeleton row stub for async data
//
// Generic over the row type so callers keep their domain types intact.
// Columns expose `render(row) -> ReactNode` for full control of cell content.
//
// Pure presentational — sorting / pagination are caller-owned. The table
// reports user intent (onSortChange) and renders the controlled state.

import { ChevronDown, ChevronUp, ChevronsUpDown, Inbox } from 'lucide-react';
import { Fragment, type JSX, type ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { EmptyState } from '../primitives/EmptyState.js';
import { SectionLabel } from './SectionLabel.js';

export type SortDirection = 'asc' | 'desc';

export interface DataTableSort {
  /** Currently sorted column id. */
  columnId: string;
  direction: SortDirection;
}

export interface DataTableColumn<TRow> {
  /** Stable identifier — used in sort state. */
  id: string;
  /** Header label — rendered inside SectionLabel uppercase tracking-widest. */
  header: ReactNode;
  /** Cell renderer. */
  render: (row: TRow, rowIndex: number) => ReactNode;
  /** When set, the header is clickable + shows sort chevron. */
  sortable?: boolean;
  /** Right-align numeric columns. */
  align?: 'left' | 'right' | 'center';
  /** Optional fixed width (CSS string e.g. "120px" or "1fr"). */
  width?: string;
  /** Optional cell class merge. */
  cellClassName?: string;
  /** Optional header class merge. */
  headerClassName?: string;
}

export interface DataTableProps<TRow> {
  columns: readonly DataTableColumn<TRow>[];
  rows: readonly TRow[];
  /** Row id extractor (used as React key). */
  getRowKey: (row: TRow, index: number) => string | number;
  /** When set, zebra-stripes alternating rows. Default true. */
  striped?: boolean;
  /** Current sort state — pass through from caller. */
  sort?: DataTableSort | null;
  /** Sort change handler. Required when any column is sortable. */
  onSortChange?: (next: DataTableSort) => void;
  /** Loading state — renders skeleton rows. */
  isLoading?: boolean;
  /** Number of skeleton rows when loading. Default 5. */
  loadingRowCount?: number;
  /** Empty state title — defaults to "No data". */
  emptyTitle?: string;
  /** Empty state description. */
  emptyDescription?: string;
  /** Override the empty state entirely. */
  emptyState?: ReactNode;
  /** Row click handler. */
  onRowClick?: (row: TRow, rowIndex: number) => void;
  className?: string;
  /**
   * Densité des cellules. `compact` resserre à 14/10 px — la densité des écrans
   * de travail (catalogue, listes longues), où trois lignes de plus à l'écran
   * valent mieux que de l'air. Défaut inchangé pour toutes les tables
   * existantes.
   */
  density?: 'default' | 'compact';
  /**
   * Pied de table, sous un filet, sur le remplissage inerte : sélection,
   * actions groupées, pagination. Rendu même quand la table est vide — le
   * compteur « 0 sur 318 » est une information, pas un vide.
   */
  footer?: ReactNode;
  /** Classe additionnelle par ligne — surlignage d'une ligne sélectionnée. */
  rowClassName?: (row: TRow, rowIndex: number) => string | undefined;
  /**
   * Détail dépliable sous une ligne. Rendu dans une seconde `<tr>` qui couvre
   * toute la largeur, uniquement pour les lignes dont la clé est dans
   * `expandedKeys`.
   *
   * L'ouverture est possédée par l'APPELANT : la table ne décide pas ce qui est
   * ouvert, elle le rend. C'est ce qui permet d'ouvrir une ligne depuis
   * l'extérieur (une URL, un résultat de recherche) sans dupliquer l'état.
   */
  renderExpanded?: (row: TRow, rowIndex: number) => ReactNode;
  /** Clés des lignes actuellement dépliées — même valeur que `getRowKey`. */
  expandedKeys?: ReadonlySet<string | number>;
  /** Test ID propagated to the outer element. */
  'data-testid'?: string;
}

function HeaderSortIcon({
  isSorted,
  direction,
}: {
  isSorted: boolean;
  direction: SortDirection | undefined;
}): JSX.Element {
  if (!isSorted) return <ChevronsUpDown className="h-3 w-3 text-text-subtle" aria-hidden />;
  return direction === 'asc' ? (
    <ChevronUp className="h-3 w-3 text-gold" aria-hidden />
  ) : (
    <ChevronDown className="h-3 w-3 text-gold" aria-hidden />
  );
}

export function DataTable<TRow>({
  columns,
  rows,
  getRowKey,
  striped = true,
  sort = null,
  onSortChange,
  isLoading,
  loadingRowCount = 5,
  emptyTitle = 'No data',
  emptyDescription,
  emptyState,
  onRowClick,
  className,
  density = 'default',
  footer,
  rowClassName,
  renderExpanded,
  expandedKeys,
  'data-testid': testId,
}: DataTableProps<TRow>): JSX.Element {
  const cellPad = density === 'compact' ? 'px-3.5 py-2.5' : 'px-4 py-3';
  const handleHeaderClick = (col: DataTableColumn<TRow>): void => {
    if (col.sortable !== true || onSortChange === undefined) return;
    if (sort?.columnId !== col.id) {
      onSortChange({ columnId: col.id, direction: 'asc' });
      return;
    }
    onSortChange({
      columnId: col.id,
      direction: sort.direction === 'asc' ? 'desc' : 'asc',
    });
  };

  const showEmpty = !isLoading && rows.length === 0;

  return (
    <div
      data-testid={testId}
      // Harden — `overflow-hidden` (posé pour découper les coins arrondis)
      // AMPUTAIT la table sans le dire dès que ses colonnes dépassaient le
      // conteneur : mesuré à 1024 px sur le catalogue produits, 1212 px de table
      // dans 963 px utiles, soit 249 px perdus — les colonnes Actions et Status
      // entières — sans barre de défilement et sans que la page défile
      // horizontalement. `overflow-x-auto` révèle le dépassement au lieu de le
      // masquer ; `overflow-y-hidden` conserve le découpage des coins.
      className={cn('w-full overflow-x-auto overflow-y-hidden rounded-lg border border-border-subtle bg-bg-elevated', className)}
    >
      <table className="w-full border-collapse">
        <thead className="border-b border-border-subtle bg-surface-inert">
          <tr>
            {columns.map((col) => {
              const isSorted = sort?.columnId === col.id;
              const isClickable = col.sortable === true && onSortChange !== undefined;
              return (
                <th
                  key={col.id}
                  scope="col"
                  style={col.width !== undefined ? { width: col.width } : undefined}
                  aria-sort={
                    isSorted
                      ? sort?.direction === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : col.sortable === true
                        ? 'none'
                        : undefined
                  }
                  // `font-data` est posé sur la CELLULE, pas sur SectionLabel :
                  // la famille s'hérite, donc l'unique déclaration couvre les
                  // deux branches de rendu (en-tête triable en <button> et
                  // en-tête inerte) sans toucher SectionLabel, qui est partagé
                  // avec la caisse. Sans elle, l'en-tête de colonne — l'élément
                  // le plus répété du back-office — rendait en Instrument Sans,
                  // à rebours de la règle Mono-Carries-Data et de la section
                  // Tableaux de DESIGN.md (« libellés en label mono capitales »).
                  className={cn(
                    cellPad,
                    'font-data',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.headerClassName,
                  )}
                >
                  {isClickable ? (
                    <button
                      type="button"
                      onClick={() => handleHeaderClick(col)}
                      // L'anneau de focus canonique du design system, écrit avec
                      // le même vocabulaire que Button / Input / Badge / Tabs.
                      // Sans lui, trier au clavier retombait sur l'anneau natif
                      // du navigateur — mesuré entre 2,09:1 et 2,40:1 sur le
                      // remplissage inerte de l'en-tête, sous le seuil de 3:1
                      // des objets graphiques (WCAG 1.4.11). `outline` + offset
                      // 2 px déborde de 4 px : moins que les 10 px de padding
                      // vertical de la cellule la plus dense, donc rien n'est
                      // rogné par l'`overflow-x-auto` / `overflow-y-hidden` du
                      // conteneur. `:focus-visible` et non `:focus` — le survol
                      // souris n'allume pas l'anneau.
                      className={cn(
                        'inline-flex items-center gap-1.5 select-none',
                        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold',
                        col.align === 'right' && 'ml-auto',
                      )}
                    >
                      <SectionLabel as="span" size="xs">{col.header}</SectionLabel>
                      <HeaderSortIcon isSorted={isSorted} direction={sort?.direction} />
                    </button>
                  ) : (
                    <SectionLabel as="span" size="xs">{col.header}</SectionLabel>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {isLoading
            ? Array.from({ length: loadingRowCount }).map((_, i) => (
                <tr key={`skeleton-${i}`} className="border-t border-border-row">
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(cellPad, col.cellClassName)}
                    >
                      <div className="h-4 w-3/4 rounded bg-surface-4 animate-pulse motion-reduce:animate-none" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => {
                const key = getRowKey(row, index);
                const isExpanded = expandedKeys?.has(key) === true;
                return (
                  <Fragment key={key}>
                    <tr
                      onClick={onRowClick !== undefined ? () => onRowClick(row, index) : undefined}
                      aria-expanded={renderExpanded === undefined ? undefined : isExpanded}
                      className={cn(
                        'border-t border-border-row',
                        striped && index % 2 === 1 && 'bg-surface-0',
                        // `surface-4` est le cran « survol / pressé » des DEUX
                        // thèmes (POS #2e2924, Backoffice #e9e7e2) : c'est le
                        // token vivant le plus proche de l'intention de
                        // l'ancien `/60`, que Tailwind supprimait en silence.
                        onRowClick !== undefined && 'cursor-pointer hover:bg-surface-4 transition-colors duration-fast',
                        // Une ligne dépliée et son détail forment un seul bloc :
                        // la ligne perd donc sa zébrure, qui les couperait en deux.
                        isExpanded && 'bg-surface-4',
                        rowClassName?.(row, index),
                      )}
                    >
                      {columns.map((col) => (
                        <td
                          key={col.id}
                          className={cn(
                            cellPad,
                            'text-sm text-text-primary',
                            col.align === 'right' && 'text-right tabular-nums',
                            col.align === 'center' && 'text-center',
                            col.cellClassName,
                          )}
                        >
                          {col.render(row, index)}
                        </td>
                      ))}
                    </tr>
                    {isExpanded && renderExpanded !== undefined && (
                      <tr className="border-t border-border-row bg-surface-inert">
                        <td colSpan={columns.length} className="p-0">
                          {renderExpanded(row, index)}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
        </tbody>
      </table>
      {showEmpty && (
        <div className="border-t border-border-subtle">
          {emptyState ?? (
            emptyDescription !== undefined ? (
              <EmptyState
                icon={Inbox}
                title={emptyTitle}
                description={emptyDescription}
                size="md"
              />
            ) : (
              <EmptyState
                icon={Inbox}
                title={emptyTitle}
                size="md"
              />
            )
          )}
        </div>
      )}
      {footer !== undefined && (
        <div className="border-t border-border-subtle bg-surface-inert px-3.5 py-2.5">
          {footer}
        </div>
      )}
    </div>
  );
}
