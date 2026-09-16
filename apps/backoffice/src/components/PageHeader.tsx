// Bandeau commun : titre Instrument Sans, sous-titre et actions sur une ligne souple.
// Présentation uniquement ; le titre reste le h1 unique de la page.

import type { ReactNode } from 'react';
import { cn } from '@breakery/ui';

// Le titre de page, EXPORTÉ — six écrans qui n'entrent pas dans le moule du
// bandeau (fiche à statut, page « coming soon », constructeur de combo) en
// recopiaient les classes à la main, cinq d'entre eux en `text-[23px]` : la même
// taille, mais en pixels, donc sourde au réglage de corps du navigateur. La
// recopie diverge toujours ; la constante, non.
export const PAGE_TITLE_CLS =
  'text-2xl font-semibold leading-tight tracking-[-0.025em] text-text-primary';

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
        'bo-page-header flex flex-wrap items-end justify-between gap-x-6 gap-y-3',
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
        <div className="bo-page-header-actions flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </div>
  );
}
