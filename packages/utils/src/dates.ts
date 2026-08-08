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

export function formatTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'HH:mm');
}

export function formatDateLong(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return format(date, 'MMMM d, yyyy');
}

export function todayIsoDate(): string {
  return formatInTimeZone(new Date(), TIMEZONE, 'yyyy-MM-dd');
}
