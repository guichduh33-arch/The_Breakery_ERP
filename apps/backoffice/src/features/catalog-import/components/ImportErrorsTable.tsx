// apps/backoffice/src/features/catalog-import/components/ImportErrorsTable.tsx
// S41 — unified errors table for both structure errors (from the parser) and
// semantic errors (from the import_catalog_v1 report).
// Both props are optional; the component normalises them to a common row shape.

import type { JSX } from 'react';
import type { ImportError } from '../hooks/useImportCatalog.js';
import type { StructureError } from '../parseCatalogWorkbook.js';

interface NormalisedRow {
  sheet: string;
  row: number | null;
  sku: string | null;
  code: string | null;
  message: string;
}

interface Props {
  errors?: ImportError[];
  structureErrors?: StructureError[];
}

function normaliseImportErrors(errors: ImportError[]): NormalisedRow[] {
  return errors.map((e) => ({
    sheet: e.sheet,
    row: e.row,
    sku: e.sku,
    code: e.code,
    message: e.message,
  }));
}

function normaliseStructureErrors(errors: StructureError[]): NormalisedRow[] {
  return errors.map((e) => ({
    sheet: e.sheet,
    row: e.row > 0 ? e.row : null,
    sku: null,
    code: e.column ?? null,
    message: e.message,
  }));
}

export function ImportErrorsTable({ errors, structureErrors }: Props): JSX.Element | null {
  const rows: NormalisedRow[] = [
    ...(structureErrors !== undefined ? normaliseStructureErrors(structureErrors) : []),
    ...(errors !== undefined ? normaliseImportErrors(errors) : []),
  ];

  if (rows.length === 0) return null;

  return (
    <div className="overflow-x-auto rounded-lg border border-danger-soft" data-testid="import-errors-table">
      <table className="w-full text-sm">
        <thead className="bg-danger-soft text-danger">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Sheet</th>
            <th className="px-3 py-2 text-left font-semibold">Row</th>
            <th className="px-3 py-2 text-left font-semibold">SKU / Column</th>
            <th className="px-3 py-2 text-left font-semibold">Code</th>
            <th className="px-3 py-2 text-left font-semibold">Message</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-danger-soft odd:bg-bg-base even:bg-bg-elevated">
              <td className="px-3 py-1.5 font-medium">{row.sheet}</td>
              <td className="px-3 py-1.5 text-text-muted">{row.row ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-xs">{row.sku ?? row.code ?? '—'}</td>
              <td className="px-3 py-1.5 font-mono text-xs text-warning">{row.code ?? '—'}</td>
              <td className="px-3 py-1.5 text-text-secondary">{row.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
