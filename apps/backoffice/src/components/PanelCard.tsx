// apps/backoffice/src/components/PanelCard.tsx
//
// Le chrome commun d'une carte posée sur le papier : titre en label mono, slot
// droit (marqueur « live », total, période), sous-titre, corps, pied séparé par
// un filet. Promu depuis features/dashboard/components/DashboardCard.tsx (lot B,
// campagne Reports 2026-08-15), dont l'ancien chemin ré-exporte.
//
// Il existe pour une raison précise : la carte porte trois états qui ne sont pas
// des variantes cosmétiques — chargement, RESTREINT (42501, « cette carte ne
// vous est pas destinée ») et erreur. Les factoriser ici garantit qu'une page
// dégrade CARTE PAR CARTE : un rôle sans droit trésorerie perd une carte, pas
// son écran.

import type { JSX, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { Card, cn } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';

export interface PanelCardProps {
  title: string;
  /** Rendu à droite du titre : marqueur live, total, « month to date »… */
  aside?: ReactNode;
  subtitle?: ReactNode;
  /** Pied séparé par un filet — total dérivé, alerte + lien de résolution. */
  footer?: ReactNode;
  isLoading?: boolean;
  /** La RPC a répondu 42501 : on le dit, on ne montre pas une erreur rouge. */
  isRestricted?: boolean;
  error?: Error | null;
  className?: string;
  bodyClassName?: string;
  testId?: string;
  children?: ReactNode;
}

/** Point vert + « live » — le marqueur n'est posé que sur les cartes réellement
 *  abonnées au realtime ; ailleurs il mentirait sur la fraîcheur. */
export function LiveMarker(): JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />
      <span className="text-xs text-text-muted">live</span>
    </span>
  );
}

export function PanelCard({
  title, aside, subtitle, footer,
  isLoading = false, isRestricted = false, error = null,
  className, bodyClassName, testId, children,
}: PanelCardProps): JSX.Element {
  return (
    <Card
      variant="default"
      padding="none"
      className={cn('flex flex-col p-4 shadow-none', className)}
      data-testid={testId}
    >
      <div className="flex items-baseline justify-between gap-3">
        <SectionLabel as="h2" className="font-data text-xs font-semibold text-text-primary">
          {title}
        </SectionLabel>
        {aside}
      </div>
      {subtitle != null && (
        <p className="mt-1 text-xs text-text-muted">{subtitle}</p>
      )}

      <div className={cn('mt-3 flex-1', bodyClassName)}>
        {isRestricted ? (
          <div className="flex items-center gap-2 py-2 text-xs text-text-muted">
            <Lock className="h-3.5 w-3.5" aria-hidden />
            Restricted — your role does not have access to this data.
          </div>
        ) : error !== null ? (
          // Nommer le problème, pas le renvoyer. Le message serveur reste
          // lisible pour le diagnostic, mais il ne porte plus la phrase.
          <div className="py-2 text-xs" role="alert">
            <p className="text-text-primary">This card&apos;s data is unavailable.</p>
            <p className="mt-0.5 text-text-muted">Nothing here is a zero — it is unknown. ({error.message})</p>
          </div>
        ) : isLoading ? (
          <div className="space-y-2" data-testid="card-skeleton">
            {Array.from({ length: 4 }).map((_, i) => (
              <div
                key={i}
                className="h-3.5 animate-pulse rounded bg-surface-4 motion-reduce:animate-none"
              />
            ))}
          </div>
        ) : (
          children
        )}
      </div>

      {footer != null && !isRestricted && error === null && !isLoading && (
        <div className="mt-3 flex items-center gap-2 border-t border-border-muted pt-2.5 text-xs">
          {footer}
        </div>
      )}
    </Card>
  );
}
