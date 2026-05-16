// apps/backoffice/src/features/inventory-production/components/RecipeVersionHistory.tsx
//
// Session 15 — Phase 2.B — read-only timeline of `recipe_versions` for a
// product. Each entry shows version number, created_at (id-ID formatted),
// created_by name, change_note and a per-ingredient diff vs the previous
// version: green (added), red (removed), amber (qty/unit changed).

import { useMemo, type JSX } from 'react';
import { useRecipeVersions, type RecipeVersionRow, type RecipeVersionSnapshotRow } from '../hooks/useRecipeVersions.js';

export interface RecipeVersionHistoryProps {
  productId: string;
}

type DiffKind = 'added' | 'removed' | 'changed' | 'unchanged';

interface MaterialDiff {
  material_id:   string;
  material_name: string;
  kind:          DiffKind;
  quantity:      number;
  unit:          string;
  prev_quantity?: number;
  prev_unit?:     string;
}

const DATE_FMT = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

function indexByMaterialId(rows: RecipeVersionSnapshotRow[]): Record<string, RecipeVersionSnapshotRow> {
  const out: Record<string, RecipeVersionSnapshotRow> = {};
  for (const r of rows) out[r.material_id] = r;
  return out;
}

function diffVersions(
  current: RecipeVersionSnapshotRow[],
  previous: RecipeVersionSnapshotRow[] | null,
): MaterialDiff[] {
  if (previous === null) {
    return current.map((r) => ({
      material_id:   r.material_id,
      material_name: r.material_name,
      kind:          'added',
      quantity:      Number(r.quantity),
      unit:          r.unit,
    }));
  }
  const prevByMat = indexByMaterialId(previous);
  const currByMat = indexByMaterialId(current);

  const result: MaterialDiff[] = [];
  // Iterate current ; emit added/changed/unchanged.
  for (const c of current) {
    const p = prevByMat[c.material_id];
    if (p === undefined) {
      result.push({
        material_id:   c.material_id,
        material_name: c.material_name,
        kind:          'added',
        quantity:      Number(c.quantity),
        unit:          c.unit,
      });
    } else if (Number(p.quantity) !== Number(c.quantity) || p.unit !== c.unit) {
      result.push({
        material_id:   c.material_id,
        material_name: c.material_name,
        kind:          'changed',
        quantity:      Number(c.quantity),
        unit:          c.unit,
        prev_quantity: Number(p.quantity),
        prev_unit:     p.unit,
      });
    } else {
      result.push({
        material_id:   c.material_id,
        material_name: c.material_name,
        kind:          'unchanged',
        quantity:      Number(c.quantity),
        unit:          c.unit,
      });
    }
  }
  // Anything in previous but not in current is removed.
  for (const p of previous) {
    if (currByMat[p.material_id] === undefined) {
      result.push({
        material_id:   p.material_id,
        material_name: p.material_name,
        kind:          'removed',
        quantity:      Number(p.quantity),
        unit:          p.unit,
      });
    }
  }
  return result;
}

function kindTone(k: DiffKind): string {
  switch (k) {
    case 'added':     return 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30';
    case 'removed':   return 'text-red-600 bg-red-50 dark:bg-red-950/30 line-through';
    case 'changed':   return 'text-amber-600 bg-amber-50 dark:bg-amber-950/30';
    case 'unchanged': return 'text-text-secondary';
  }
}

function kindLabel(k: DiffKind): string {
  switch (k) {
    case 'added':     return 'added';
    case 'removed':   return 'removed';
    case 'changed':   return 'changed';
    case 'unchanged': return '';
  }
}

function VersionEntry({ row, previous }: { row: RecipeVersionRow; previous: RecipeVersionRow | null }): JSX.Element {
  const diffs = useMemo(
    () => diffVersions(row.snapshot, previous?.snapshot ?? null),
    [row.snapshot, previous?.snapshot],
  );
  const createdAt = (() => {
    try { return DATE_FMT.format(new Date(row.created_at)); }
    catch { return row.created_at; }
  })();

  return (
    <article
      className="border border-border-subtle rounded-lg p-4 space-y-3"
      aria-label={`Recipe version ${row.version_number}`}
    >
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">
            Version {row.version_number}
          </h3>
          <p className="text-xs text-text-secondary">
            {createdAt}
            {row.created_by_name !== undefined && (
              <> &middot; by {row.created_by_name}</>
            )}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {row.productCostAtVersion !== undefined ? (
            <span
              className="text-xs font-mono text-text-secondary"
              data-testid={`version-cost-${row.version_number}`}
            >
              cost {row.productCostAtVersion.toLocaleString('en-US', {
                minimumFractionDigits: 2, maximumFractionDigits: 2,
              })}
            </span>
          ) : (
            <span
              className="text-xs text-text-muted"
              title="Cost data added 2026-05-16"
              data-testid={`version-cost-${row.version_number}-legacy`}
            >
              cost —
            </span>
          )}
          {previous === null && (
            <span className="text-[10px] uppercase tracking-widest text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 rounded px-2 py-0.5">
              Initial
            </span>
          )}
        </div>
      </header>

      {row.change_note !== null && row.change_note !== '' && (
        <p className="text-xs italic text-text-secondary border-l-2 border-border-subtle pl-2">
          {row.change_note}
        </p>
      )}

      {diffs.length === 0 ? (
        <p className="text-xs text-text-muted">No ingredients in this version.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {diffs.map((d) => {
            const matSubtotal = (() => {
              const r = row.snapshot.find((s) => s.material_id === d.material_id);
              if (r?.material_cost_price === undefined) return null;
              return Number(r.quantity) * Number(r.material_cost_price);
            })();
            return (
              <li
                key={`${row.id}-${d.material_id}`}
                className={`flex items-center justify-between gap-2 rounded px-2 py-1 ${kindTone(d.kind)}`}
              >
                <span className="truncate">
                  {d.material_name}
                  {kindLabel(d.kind) !== '' && (
                    <span className="ml-2 text-[10px] uppercase tracking-widest opacity-70">
                      {kindLabel(d.kind)}
                    </span>
                  )}
                </span>
                <span className="font-mono text-xs whitespace-nowrap flex items-center gap-2">
                  {d.kind === 'changed' && d.prev_quantity !== undefined && (
                    <span className="text-text-secondary line-through">
                      {d.prev_quantity.toLocaleString()} {d.prev_unit}
                    </span>
                  )}
                  <span>
                    {d.quantity.toLocaleString()} {d.unit}
                  </span>
                  {matSubtotal !== null && (
                    <span className="text-text-muted">
                      = {matSubtotal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}

export function RecipeVersionHistory({ productId }: RecipeVersionHistoryProps): JSX.Element {
  const versions = useRecipeVersions(productId);

  if (versions.isLoading) {
    return <p className="text-sm text-text-secondary">Loading history…</p>;
  }
  if (versions.error) {
    return (
      <p role="alert" className="text-sm text-red-500">
        Failed to load version history.
      </p>
    );
  }
  const rows = versions.data ?? [];
  if (rows.length === 0) {
    return <p className="text-sm text-text-muted">No version history yet.</p>;
  }

  // Rows are DESC by version_number. The "previous" version for diff
  // purposes is the next item in the list (older).
  return (
    <div className="space-y-3">
      {rows.map((row, idx) => (
        <VersionEntry
          key={row.id}
          row={row}
          previous={rows[idx + 1] ?? null}
        />
      ))}
    </div>
  );
}

export default RecipeVersionHistory;
