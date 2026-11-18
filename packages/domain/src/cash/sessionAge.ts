// packages/domain/src/cash/sessionAge.ts
//
// S3-04 — Âge d'une session de caisse. Une session ouverte depuis plus de
// 24 heures doit être SIGNALÉE (arbitrage §2bis lot 2) ; elle n'est jamais
// clôturée automatiquement. Prédicat pur, sans IO : l'horloge est injectée.

/** Seuil d'alerte par défaut : 24 heures. */
export const STALE_SESSION_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * Vrai si la session est ouverte depuis STRICTEMENT plus que `thresholdMs`.
 * Une date illisible rend `false` : on n'alerte pas sur une donnée inconnue.
 */
export function isSessionStale(
  openedAtIso: string,
  nowMs: number,
  thresholdMs: number = STALE_SESSION_THRESHOLD_MS,
): boolean {
  const openedMs = Date.parse(openedAtIso);
  if (Number.isNaN(openedMs)) return false;
  return nowMs - openedMs > thresholdMs;
}
