// apps/backoffice/src/components/SectionLabel.tsx
//
// Le libellé de section du back-office — le primitif partagé, plus la famille.
//
// Le `SectionLabel` de `@breakery/ui` pose la graisse, les capitales et
// l'interlettrage, mais AUCUNE famille de police : il rend dans celle de son
// parent. Sous ce thème, c'est Instrument Sans presque partout — et DESIGN.md
// § Typography assigne le rôle Label à JetBrains Mono (600, 12 px, 0,14 em).
// Mesuré le 2026-09-04 : sur le journal comptable, les libellés de filtres
// rendaient en sans à trente pixels des en-têtes de colonnes en mono ; même
// rôle, même corps, deux polices. Le primitif est partagé avec la caisse et
// ne se retouche pas ici (arbitrage) : la famille se pose dans ce wrapper, une
// fois, et chaque appelant du back-office l'importe d'ici, jamais du paquet.
//
// La graisse passe de 700 à 600 au passage : c'est celle de `KPI_LABEL`, et
// l'écart 700/600 entre le primitif et les tuiles est nommé dans DESIGN.md
// comme un écart réel, pas une tolérance.

import type { JSX } from 'react';
import { SectionLabel as UiSectionLabel, type SectionLabelProps } from '@breakery/ui';
import { cn } from '@breakery/ui';

export type { SectionLabelProps };

export function SectionLabel({ className, ...props }: SectionLabelProps): JSX.Element {
  return <UiSectionLabel {...props} className={cn('font-data font-semibold', className)} />;
}
