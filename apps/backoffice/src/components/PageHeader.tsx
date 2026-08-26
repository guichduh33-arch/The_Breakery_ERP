// apps/backoffice/src/components/PageHeader.tsx
//
// Shared backoffice page header — the single source of truth for the
// "serif title + muted subtitle + right-aligned actions" band that every
// BO page reinvented on its own (design audit 2026-07-07, finding I3-I5).
//
// Canonical style: Inter 23 px 600, `tracking-[-0.015em]` title + `text-sm
// text-text-secondary` subtitle. Actions bottom-align with the title band
// (`items-end`) so date pickers / export buttons sit on the same baseline.
// Pure presentational — no business logic.
//
// Refonte shell 2026-08-05 — le titre PERD le serif. Playfair Display sur des
// titres de page était le signal « boulangerie artisanale » le plus fort dans
// un outil de gestion ; il ne sert plus qu'au monogramme de marque de la top
// bar. Ce composant étant l'unique source du bandeau de titre, le changement
// porte d'un coup sur toutes les pages qui l'utilisent.

import type { ReactNode } from 'react';
import { cn } from '@breakery/ui';

// Le titre de page, EXPORTÉ — six écrans qui n'entrent pas dans le moule du
// bandeau (fiche à statut, page « coming soon », constructeur de combo) en
// recopiaient les classes à la main, cinq d'entre eux en `text-[23px]` : la même
// taille, mais en pixels, donc sourde au réglage de corps du navigateur. La
// recopie diverge toujours ; la constante, non.
export const PAGE_TITLE_CLS =
  'text-[1.4375rem] font-semibold leading-tight tracking-[-0.015em] text-text-primary';

export interface PageHeaderProps {
  /** Page title, rendered as the single `<h1>` for the view. */
  title: string;
  /** Optional supporting line under the title. String or arbitrary node. */
  subtitle?: ReactNode;
  /** Optional right-aligned slot: filters, export buttons, status chips… */
  actions?: ReactNode;
  /** Extra classes on the outer flex row (e.g. `items-start`). */
  className?: string;
  /** Extra classes on the `<h1>` (e.g. `text-3xl` for a hero page). */
  titleClassName?: string;
}

export function PageHeader({
  title,
  subtitle,
  actions,
  className,
  titleClassName,
}: PageHeaderProps) {
  return (
    <div
      className={cn(
        'flex flex-wrap items-end justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h1 className={cn(PAGE_TITLE_CLS, titleClassName)}>
          {title}
        </h1>
        {subtitle != null &&
          (typeof subtitle === 'string' ? (
            <p className="mt-1 text-sm text-text-secondary">{subtitle}</p>
          ) : (
            <div className="mt-1 text-sm text-text-secondary">{subtitle}</div>
          ))}
      </div>
      {actions != null && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
