// apps/backoffice/src/features/dashboard/hooks/useTodayHours.ts
//
// Écran 1c — les horaires d'ouverture du JOUR, pour le sous-titre du bandeau.
//
// « Rp 8,42 jt » ne veut pas la même chose à 09:42 d'une journée qui ferme à
// 18:00 qu'à 17:50. Sans l'amplitude, le lecteur ne sait pas s'il regarde un
// quart de journée ou une journée entière, et compare donc des chiffres qui ne
// se comparent pas.
//
// La source est `business_config.business_hours`, la même que l'écran de
// réglage — il n'y a pas de seconde définition des heures d'ouverture. La
// lecture est gatée `settings.read` côté serveur : un rôle qui ne l'a pas rend
// simplement `null` et le bandeau se contente de la dernière synchro. Un
// dashboard ne tombe pas parce qu'un sous-titre est interdit.

import { useSettings } from '@/features/settings/hooks/useSettings.js';

/** Clés de jour telles que persistées côté serveur, indexées par `getDay()`. */
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

const HHMM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;

export interface TodayHours {
  open: string;
  close: string;
}

/**
 * Horaires du jour, ou `null` quand ils sont inconnus, illisibles, ou que
 * l'établissement est fermé aujourd'hui. On ne renvoie JAMAIS un horaire par
 * défaut : afficher « ouvre à 07:00 » sur une base absente inventerait une
 * information que personne n'a saisie.
 */
export function useTodayHours(enabled = true): TodayHours | null {
  const business = useSettings('business');
  if (!enabled || business.data === undefined) return null;

  const raw = business.data.settings.business_hours;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const key = DAY_KEYS[new Date().getDay()] ?? 'mon';
  const day = (raw as Record<string, unknown>)[key];
  if (day === null || typeof day !== 'object' || Array.isArray(day)) return null;

  const d = day as Record<string, unknown>;
  const open  = typeof d.open  === 'string' ? d.open  : null;
  const close = typeof d.close === 'string' ? d.close : null;
  if (open === null || close === null) return null;
  if (!HHMM.test(open) || !HHMM.test(close)) return null;

  return { open, close };
}
