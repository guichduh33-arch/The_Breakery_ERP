// apps/backoffice/src/features/dashboard/components/Delta.tsx
//
// Écran 1c — la ligne de variation sous une valeur.
//
// Deux points qui ne sont pas cosmétiques :
//
//  1. `invert`. Sur un CA, monter est bon ; sur un COÛT, monter est mauvais. La
//     couleur suit donc le SENS MÉTIER, pas le signe. Sans ce drapeau, la carte
//     « COGS & expenses » peindrait en vert une dérive de coût.
//  2. Le glyphe ▲/▼ est décoratif (`aria-hidden`) et doublé d'un libellé lu par
//     le lecteur d'écran : une flèche seule n'est pas une information.

import type { JSX } from 'react';
import { cn } from '@breakery/ui';
import { deltaView } from '../utils/format.js';

export interface DeltaProps {
  value: number | null | undefined;
  /** `pct` = variation relative ; `pt` = écart en points (marge brute). */
  unit?: 'pct' | 'pt';
  /** Période comparée, rendue en gris à droite : « yest », « D-7 », « MoM ». */
  period?: string;
  /** Vrai quand une HAUSSE est une mauvaise nouvelle (coûts). */
  invert?: boolean;
  /**
   * Posé sur un fond ENCRE (tuile héro). Le vert et le rouge sémantiques sont
   * taillés pour un fond blanc et tombent sous le seuil de lecture sur
   * `#201d19` — on bascule sur leurs équivalents éclaircis.
   */
  onInk?: boolean;
  className?: string;
}

export function Delta({
  value,
  unit = 'pct',
  period,
  invert = false,
  onInk = false,
  className,
}: DeltaProps): JSX.Element {
  const d = deltaView(value, unit);

  const neutral  = onInk ? 'text-ink-fg-sub'  : 'text-text-muted';
  const positive = onInk ? 'text-ink-success' : 'text-success';
  const negative = onInk ? 'text-ink-danger'  : 'text-danger';

  const tone =
    d.direction === 'none' || d.direction === 'flat'
      ? neutral
      : (d.direction === 'up') !== invert
        ? positive
        : negative;

  const spoken =
    d.direction === 'none' ? 'no comparison available'
      : d.direction === 'flat' ? 'unchanged'
        : d.direction === 'up' ? `up ${d.text}`
          : `down ${d.text}`;

  return (
    <span className={cn('inline-flex items-baseline gap-1 font-data text-[11px]', className)}>
      <span className={cn('font-semibold tabular-nums', tone)}>
        <span aria-hidden>{d.glyph}</span>
        <span className="sr-only">{spoken}{period != null ? ` versus ${period}` : ''}</span>
        <span aria-hidden>{d.text}</span>
      </span>
      {period != null && <span className={neutral} aria-hidden>{period}</span>}
    </span>
  );
}
