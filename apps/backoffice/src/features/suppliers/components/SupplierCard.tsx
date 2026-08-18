// apps/backoffice/src/features/suppliers/components/SupplierCard.tsx
//
// Session 14 — Phase 5.A — Compact supplier card mirroring the
// 15-suppliers-list.jpg screenshot: building icon + name (+ contact_person if
// present in notes) on top, contact phone/email on bottom, hover actions on
// the right (view / toggle active / edit / delete). La carte entière est une
// surface de clic, mais la cible clavier est le NOM seul : voir le lien tendu
// ci-dessous. Cette ligne annonçait des actions qui « stop propagation » —
// il n'y a plus rien à arrêter depuis le 2026-08-18.

import type { JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, CheckCircle2, Eye, Mail, Pencil, Phone, Trash2, XCircle } from 'lucide-react';
import { Button, Card } from '@breakery/ui';
import type { SupplierRow } from '../hooks/useSuppliersList.js';

// Même idiome que `ComboCard`, et pour la même raison. La carte portait
// `role="button"` + `tabIndex` + quatre `<Button>` DEDANS : `button` est un rôle
// à ENFANTS PRÉSENTATIONNELS (ARIA 1.2 § 5.2.7), donc le nom, les coordonnées
// et les quatre actions disparaissaient toutes derrière un seul nœud — et un
// bouton imbriqué dans un bouton n'est de toute façon pas un DOM valide.
// Le lien tendu résout les deux : le nom du fournisseur devient la cible
// clavier et le nom accessible, son pseudo-élément garde la surface de clic de
// la carte entière, et les actions restent des contrôles à part entière.
const TITLE_LINK =
  "after:absolute after:inset-0 after:content-[''] hover:text-gold focus-visible:outline-none";

// L'anneau vit sur la CARTE, pas sur le texte du titre : c'est l'objet entier
// qui est désigné comme cible.
const CARD =
  'group relative flex flex-col gap-3 transition-colors hover:border-border-gold hover:bg-surface-4 ' +
  'focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-gold';

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
  const detailPath = `/backoffice/suppliers/${row.id}`;
  function open(): void {
    void navigate(detailPath);
  }
  return (
    <Card
      variant="default"
      padding="md"
      className={CARD}
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
            <div className="text-text-primary leading-tight">
              <Link to={detailPath} className={TITLE_LINK}>{row.name}</Link>
            </div>
            {row.notes !== null && row.notes !== '' && (
              <div className="text-text-secondary text-xs mt-0.5 truncate" title={row.notes}>
                {row.notes}
              </div>
            )}
          </div>
        </div>

        {/* `relative` : les actions se peignent AU-DESSUS du pseudo-élément
            tendu du lien, qui couvre sinon toute la carte. Le
            `stopPropagation` qu'elles portaient est mort avec le `onClick` de
            la carte — plus rien ne remonte.
            `group-focus-within:opacity-100` : les quatre actions n'étaient
            révélées qu'au SURVOL. Atteintes au clavier elles restaient à
            `opacity-0` — un contrôle focalisé et invisible (WCAG 2.4.7). */}
        <div className="relative flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
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
