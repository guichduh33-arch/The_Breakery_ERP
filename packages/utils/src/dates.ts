// packages/utils/src/dates.ts
import { format } from 'date-fns';
import { formatInTimeZone } from 'date-fns-tz';

export const TIMEZONE = 'Asia/Makassar';

export function formatDateTimeWita(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return formatInTimeZone(date, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');
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
