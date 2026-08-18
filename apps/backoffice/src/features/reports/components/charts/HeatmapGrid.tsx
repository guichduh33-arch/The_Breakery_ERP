// apps/backoffice/src/features/reports/components/charts/HeatmapGrid.tsx
//
// Lot B (campagne Reports 2026-08-15) — la matrice teintée (« recurring
// shortfall on Tuesdays »). Pas de Recharts : c'est un VRAI tableau — la
// sémantique de lignes/colonnes est l'accessibilité de la matrice — dont les
// cellules prennent le fond du barème `varianceScale`. La légende est
// OBLIGATOIRE : poser une `VarianceLegend` à côté, avec des libellés qui
// nomment les seuils.

import type { JSX, ReactNode } from 'react';
import { cn } from '@breakery/ui';
import { VARIANCE_TONE_CELL, type VarianceTone } from '../../utils/varianceScale.js';

export interface HeatmapRow {
  key:   string;
  label: ReactNode;
  cells: (number | null)[];
}

export interface HeatmapGridProps {
  /** En-têtes de colonnes (« Sun » … « Sat »). */
  columns: string[];
  rows: HeatmapRow[];
  /** Barème — typiquement une fermeture sur varianceToneSigned/Abs. */
  tone: (v: number | null) => VarianceTone;
  /** Rendu d'une valeur non nulle (IDR, %, compte…). */
  format: (v: number) => string;
  /** Libellé de la colonne de lignes (« Cashier »). */
  rowHeader: string;
  className?: string;
}

export function HeatmapGrid({
  columns, rows, tone, format, rowHeader, className,
}: HeatmapGridProps): JSX.Element {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-subtle text-text-secondary">
            <th className="py-2 text-left">{rowHeader}</th>
            {columns.map((c) => (
              <th key={c} className="py-2 text-right font-data text-xs font-semibold uppercase tracking-widest">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className="border-b border-border-row">
              <td className="py-1.5 pr-2">{row.label}</td>
              {row.cells.map((v, i) => {
                const t = v === null ? 'neutral' : tone(v);
                return (
                  <td key={i} className="p-0.5 text-right">
                    <span
                      className={cn(
                        'block rounded-sm px-1.5 py-1 font-data text-xs tabular-nums',
                        v === null ? 'text-text-subtle' : VARIANCE_TONE_CELL[t],
                      )}
                    >
                      {v === null ? '·' : format(v)}
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
