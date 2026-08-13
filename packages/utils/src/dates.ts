// packages/utils/src/dates.ts
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

// ADR-019 (D5) — CONSTANTE CLIENT UNIQUE du fuseau métier. C'est la seule
// déclaration littérale côté client : `@breakery/domain` la réexporte sous le
// nom DEFAULT_TIMEZONE, les applications l'importent, personne ne la redéclare.
//
// Le client ne lit PAS business_config pour cela (D5) : cette colonne est un
// miroir, et l'autorité réelle est le paramètre de session PostgreSQL, que le
// client ne voit pas. Changer le fuseau est un geste de déploiement — cette
// ligne, la colonne miroir et le paramètre de session bougent dans le même lot.
export const TIMEZONE = 'Asia/Makassar';

export function formatDateTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
}

// Le format de lecture des tables du Backoffice : « 04 Aug 2026, 14:30 ».
// Le mois en lettres retire l'ambiguïté jour/mois d'un `toLocaleString()`
// laissé au navigateur (qui rendait 8/3/2026 pour le 3 août), et les secondes
// sautent — une liste se lit, elle ne s'horodate pas. Pour un horodatage
// exact (audit, export), c'est formatDateTimeWita qu'il faut.
export function formatDateTimeShortWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'dd MMM yyyy, HH:mm');
}

// Audit UX/UI 2026-08-13 (lot 5) — les DEUX formats canoniques de l'app.
// `formatDate` : date seule, jj/MM/aaaa (l'audit a relevé du 06/14/2026 US via
// des toLocaleDateString() sans locale). `formatDateTime` : le format de table
// existant (dd MMM yyyy, HH:mm) sous son nom générique — même fuseau ADR-019.
export function formatDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'dd/MM/yyyy');
}

export function formatDateTime(d: Date | string): string {
  return formatDateTimeShortWita(d);
}

export function formatTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'HH:mm');
}

// Le jour seul, court, pour la seconde ligne d'une cellule de liste
// (« 12 Aug ») — même discipline anti-ambiguïté que le format de table.
export function formatDateShortWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'dd MMM');
}

export function formatDateLong(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return format(date, 'MMMM d, yyyy');
}

export function todayIsoDate(): string {
  return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
}

// Le JOUR MÉTIER d'un instant quelconque — pendant de `todayIsoDate` pour une
// date qui n'est pas maintenant. Sert à comparer deux dates en jours de
// calendrier plutôt qu'en tranches de 24 h : un mouvement d'hier 23 h et un
// d'aujourd'hui 1 h sont à deux heures l'un de l'autre mais appartiennent à
// deux journées de travail différentes, et c'est la journée qui se lit.
export function businessDateIso(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd');
}
