// apps/backoffice/src/features/suppliers/components/SupplierCard.tsx
//
// Session 14 — Phase 5.A — Compact supplier card mirroring the
// 15-suppliers-list.jpg screenshot: building icon + name (+ contact_person if
// present in notes) on top, contact phone/email on bottom, hover actions on
// the right (view / toggle active / edit / delete). The whole card is a
// link target — inline action buttons stop propagation so they don't navigate.

import type { JSX, MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2, Eye, Mail, Pencil, Phone, Trash2, XCircle } from 'lucide-react';
import { Button, Card } from '@breakery/ui';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

export interface SupplierCardProps {
  row: SupplierRow;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: (row: SupplierRow) => void;
  onToggleActive: (row: SupplierRow) => void;
  onDelete: (row: SupplierRow) => void;
}

export function SupplierCard({
  row,
  canUpdate,
  canDelete,
  onEdit,
  onToggleActive,
  onDelete,
}: SupplierCardProps): JSX.Element {
  const navigate = useNavigate();
  function open(): void {
    navigate(`/backoffice/suppliers/${row.id}`);
  }
  function stop(e: MouseEvent): void {
    e.stopPropagation();
  }
  return (
    <Card
      variant="default"
      padding="md"
      className="group flex cursor-pointer flex-col gap-3 transition-colors hover:border-gold/40 hover:bg-bg-overlay/40"
      onClick={open}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          open();
        }
      }}
      data-testid={`supplier-card-${row.code}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            aria-hidden
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gold-soft text-gold"
          >
            <Building2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="font-display text-text-primary leading-tight">{row.name}</div>
            {row.notes !== null && row.notes !== '' && (
              <div className="text-text-secondary text-xs mt-0.5 truncate" title={row.notes}>
                {row.notes}
              </div>
            )}
          </div>
        </div>

        <div
          className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100"
          onClick={stop}
        >
          <Button variant="ghost" size="sm" onClick={open} aria-label={`View ${row.name}`}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
          </Button>
          {canUpdate && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onToggleActive(row)}
              aria-label={`Toggle ${row.name} active`}
            >
              {row.is_active ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-success" aria-hidden />
              ) : (
                <XCircle className="h-3.5 w-3.5 text-text-muted" aria-hidden />
              )}
            </Button>
          )}
          {canUpdate && (
            <Button variant="ghost" size="sm" onClick={() => onEdit(row)} aria-label={`Edit ${row.name}`}>
              <Pencil className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
          {canDelete && (
            <Button
              variant="ghostDestructive"
              size="sm"
              onClick={() => onDelete(row)}
              aria-label={`Delete ${row.name}`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      <div className="border-t border-border-subtle pt-2 text-xs text-text-secondary space-y-1 min-h-[1.5rem]">
        {row.contact_phone !== null && row.contact_phone !== '' && (
          <div className="flex items-center gap-1.5">
            <Phone className="h-3 w-3" aria-hidden />
            <span>{row.contact_phone}</span>
          </div>
        )}
        {row.contact_email !== null && row.contact_email !== '' && (
          <div className="flex items-center gap-1.5">
            <Mail className="h-3 w-3" aria-hidden />
            <span className="truncate">{row.contact_email}</span>
          </div>
        )}
      </div>
    </Card>
  );
}
