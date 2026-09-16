// Les titres de section h2 sont en Instrument Sans ; les petits repères restent en mono.
// Les classes explicites de chaque appelant restent prioritaires.

import type { JSX } from 'react';
import { SectionLabel as UiSectionLabel, type SectionLabelProps } from '@breakery/ui';
import { cn } from '@breakery/ui';

export type { SectionLabelProps };

export function SectionLabel({ className, as = 'div', ...props }: SectionLabelProps): JSX.Element {
  return <UiSectionLabel as={as} {...props} className={cn(
    as === 'h2'
      ? 'font-body text-lg font-medium normal-case tracking-tight text-text-primary'
      : 'font-data font-medium',
    className,
  )} />;
}
