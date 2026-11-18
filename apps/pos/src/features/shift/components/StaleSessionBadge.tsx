// apps/pos/src/features/shift/components/StaleSessionBadge.tsx
// S3-04 — Pastille affichée quand une session est ouverte depuis plus de 24 h.
// Alerte seulement : aucune clôture automatique (arbitrage §2bis lot 2).
// Modèle : VarianceWarningBadge (prédicat pur + rendu null).

import type { JSX } from 'react';
import { isSessionStale } from '@breakery/domain';

export interface StaleSessionBadgeProps {
  openedAt: string;
  /** Horloge injectable pour les tests ; défaut : Date.now(). */
  nowMs?: number;
}

export function StaleSessionBadge({ openedAt, nowMs }: StaleSessionBadgeProps): JSX.Element | null {
  if (!isSessionStale(openedAt, nowMs ?? Date.now())) return null;
  return (
    <span
      role="status"
      data-testid="stale-session-badge"
      className="inline-flex items-center gap-1 rounded-full bg-red-soft text-red-as-text px-2 py-0.5 text-xs uppercase tracking-wide font-medium"
    >
      Open over 24h
    </span>
  );
}
