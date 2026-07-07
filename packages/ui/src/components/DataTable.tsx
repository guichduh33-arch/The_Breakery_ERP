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
import type { JSX, ReactNode } from 'react';
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
  columns: ReadonlyArray<DataTableColumn<TRow>>;
  rows: ReadonlyArray<TRow>;
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
  'data-testid': testId,
}: DataTableProps<TRow>): JSX.Element {
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
      className={cn('w-full overflow-hidden rounded-lg border border-border-subtle bg-bg-elevated', className)}
    >
      <table className="w-full border-collapse">
        <thead className="border-b border-border-subtle bg-bg-base/40">
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
                  className={cn(
                    'px-4 py-3',
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.headerClassName,
                  )}
                >
                  {isClickable ? (
                    <button
                      type="button"
                      onClick={() => handleHeaderClick(col)}
                      className={cn(
                        'inline-flex items-center gap-1.5 select-none',
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
                <tr key={`skeleton-${i}`} className="border-t border-border-subtle">
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn('px-4 py-3', col.cellClassName)}
                    >
                      <div className="h-4 w-3/4 rounded bg-surface-4 animate-pulse motion-reduce:animate-none" />
                    </td>
                  ))}
                </tr>
              ))
            : rows.map((row, index) => (
                <tr
                  key={getRowKey(row, index)}
                  onClick={onRowClick !== undefined ? () => onRowClick(row, index) : undefined}
                  className={cn(
                    'border-t border-border-subtle',
                    striped && index % 2 === 1 && 'bg-surface-0',
                    onRowClick !== undefined && 'cursor-pointer hover:bg-surface-4/60 transition-colors duration-fast',
                  )}
                >
                  {columns.map((col) => (
                    <td
                      key={col.id}
                      className={cn(
                        'px-4 py-3 text-sm text-text-primary',
                        col.align === 'right' && 'text-right tabular-nums',
                        col.align === 'center' && 'text-center',
                        col.cellClassName,
                      )}
                    >
                      {col.render(row, index)}
                    </td>
                  ))}
                </tr>
              ))}
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
    </div>
  );
}
