// apps/backoffice/src/pages/reports/recentReports.ts
//
// Historique « Recently viewed » du hub Reports — per-poste, localStorage.
//
// Le hub tient plusieurs familles de rapports ; en pratique un utilisateur en
// ouvre trois ou quatre, toujours les mêmes. La bande des récents met ceux-là
// au-dessus de la ligne de flottaison pour que le geste habituel ne coûte plus
// un balayage de toutes les familles.
//
// On ne stocke QUE la cible (`to`) de la tuile, jamais son libellé : le libellé
// et le blurb restent la propriété de la table des sections, et une entrée dont
// la route disparaît se résout à rien — donc s'efface d'elle-même à l'affichage
// sans migration de données.
//
// Aucun tracking de navigation : l'enregistrement se fait au CLIC sur une
// tuile du hub, et nulle part ailleurs.

import { useCallback, useState } from 'react';

/** Clé localStorage — préfixe `bo:` comme le reste de l'état par poste. */
export const RECENT_REPORTS_KEY = 'bo:reports:recent';

/** Taille de la bande. Au-delà, ce n'est plus un raccourci, c'est le hub. */
export const MAX_RECENT_REPORTS = 5;

/**
 * Lit l'historique. Toute anomalie (mode privé, quota, JSON corrompu, forme
 * inattendue) rend une liste vide : la bande disparaît, la page reste entière.
 */
export function readRecentReports(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_REPORTS_KEY);
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((v): v is string => typeof v === 'string' && v !== '')
      .slice(0, MAX_RECENT_REPORTS);
  } catch {
    return [];
  }
}

/**
 * Place `to` en tête, dédoublonne, tronque, persiste. Rend la nouvelle liste
 * même si l'écriture a échoué — l'affichage de la session en cours reste juste.
 */
export function pushRecentReport(to: string): string[] {
  const next = [to, ...readRecentReports().filter((v) => v !== to)].slice(
    0,
    MAX_RECENT_REPORTS,
  );
  try {
    localStorage.setItem(RECENT_REPORTS_KEY, JSON.stringify(next));
  } catch {
    /* mode privé / quota — l'historique est un confort, jamais une donnée */
  }
  return next;
}

export interface UseRecentReports {
  /** Cibles des derniers rapports ouverts, du plus récent au plus ancien. */
  recent: string[];
  /** À appeler au clic sur une tuile. */
  record: (to: string) => void;
}

/** État React de la bande des récents, initialisé depuis le stockage du poste. */
export function useRecentReports(): UseRecentReports {
  const [recent, setRecent] = useState<string[]>(() => readRecentReports());

  const record = useCallback((to: string) => {
    setRecent(pushRecentReport(to));
  }, []);

  return { recent, record };
}
