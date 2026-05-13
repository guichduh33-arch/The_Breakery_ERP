// apps/backoffice/src/features/suppliers/components/SupplierListRow.tsx
import { Pencil, Trash2 } from 'lucide-react';
import { Button } from '@breakery/ui';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

export interface SupplierListRowProps {
  row: SupplierRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: SupplierRow) => void;
  onToggleActive: (row: SupplierRow) => void;
  onDelete: (row: SupplierRow) => void;
}

export function SupplierListRow({ row, canUpdate, canDelete, onEdit, onToggleActive, onDelete }: SupplierListRowProps) {
  return (
    <tr className="border-t border-border-subtle hover:bg-bg-overlay">
      <td className="px-4 py-3 font-mono uppercase text-text-secondary">{row.code}</td>
      <td className="px-4 py-3 font-semibold">{row.name}</td>
      <td className="px-4 py-3 text-text-secondary text-sm">{row.contact_phone ?? '—'}</td>
      <td className="px-4 py-3 text-text-secondary text-sm">{row.contact_email ?? '—'}</td>
      <td className="px-4 py-3 text-right font-mono">{row.payment_terms_days}d</td>
      <td className="px-4 py-3 text-center">
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={row.is_active} disabled={!canUpdate}
            onChange={() => onToggleActive(row)} aria-label={`Toggle ${row.name} active`} />
          <span className={row.is_active ? 'text-green text-xs uppercase' : 'text-text-secondary text-xs uppercase'}>
            {row.is_active ? 'Active' : 'Inactive'}
          </span>
        </label>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="inline-flex gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={!canUpdate} onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>
            <Pencil className="h-4 w-4" aria-hidden /> Edit
          </Button>
          {canDelete && (
            <Button type="button" variant="ghostDestructive" size="sm" onClick={() => onDelete(row)} aria-label={`Delete ${row.name}`}>
              <Trash2 className="h-4 w-4" aria-hidden /> Delete
            </Button>
          )}
        </div>
      </td>
    </tr>
  );
}
