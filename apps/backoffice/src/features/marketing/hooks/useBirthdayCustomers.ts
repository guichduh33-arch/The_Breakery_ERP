// apps/backoffice/src/features/marketing/hooks/useBirthdayCustomers.ts
//
// Lists customers with birthdays in the next N days (default 30), and a
// recent log of birthday notifications sent. Server-side filter on
// `birth_date IS NOT NULL`.
//
// Session 13 / Phase 6.B.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface BirthdayCustomer {
  id:                  string;
  name:                string;
  email:               string | null;
  birth_date:          string;     // ISO date
  days_until_birthday: number;
  marketing_consent:   boolean;
}

export interface BirthdayLogRow {
  id:           string;
  recipient:    string;
  status:       string;
  scheduled_for: string;
  sent_at:      string | null;
}

export const BIRTHDAY_QUERY_KEY = ['marketing', 'birthday'] as const;

/**
 * Upcoming birthday customers — next `daysAhead` days (incl. today).
 * Computed client-side from `birth_date` ; server returns all customers
 * with a non-null birth_date and we filter for the next-N-days window.
 */
export function useUpcomingBirthdays(daysAhead = 30) {
  return useQuery<BirthdayCustomer[]>({
    queryKey: [...BIRTHDAY_QUERY_KEY, 'upcoming', daysAhead] as const,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('customers')
        .select('id, name, email, birth_date, marketing_consent')
        .not('birth_date', 'is', null)
        .is('deleted_at', null)
        .order('name', { ascending: true });
      if (error) throw error;

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const year = today.getUTCFullYear();

      return ((data ?? []) as Array<{
        id: string;
        name: string;
        email: string | null;
        birth_date: string;
        marketing_consent: boolean;
      }>)
        .map((c) => {
          const bd = new Date(c.birth_date);
          // Compute next occurrence of birthday in this year (or next).
          let next = new Date(Date.UTC(year, bd.getUTCMonth(), bd.getUTCDate()));
          if (next < today) {
            next = new Date(Date.UTC(year + 1, bd.getUTCMonth(), bd.getUTCDate()));
          }
          const diff = Math.floor((next.getTime() - today.getTime()) / 86_400_000);
          return {
            ...c,
            days_until_birthday: diff,
          };
        })
        .filter((c) => c.days_until_birthday <= daysAhead)
        .sort((a, b) => a.days_until_birthday - b.days_until_birthday);
    },
  });
}

/**
 * Recent birthday notification log — pulls last 50 rows from outbox
 * with `template_code = 'customer_birthday'`.
 */
export function useBirthdayNotificationLog(limit = 50) {
  return useQuery<BirthdayLogRow[]>({
    queryKey: [...BIRTHDAY_QUERY_KEY, 'log', limit] as const,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_outbox')
        .select('id, recipient, status, scheduled_for, sent_at')
        .eq('template_code', 'customer_birthday')
        .order('scheduled_for', { ascending: false })
        .limit(limit);
      if (error) throw error;
      return ((data ?? []) as BirthdayLogRow[]);
    },
  });
}
