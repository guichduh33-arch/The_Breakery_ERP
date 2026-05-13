// packages/domain/src/notifications/types.ts
// Session 13 — Phase 5.B — Notifications pipeline domain types.

export type NotificationChannel = 'email' | 'sms' | 'push' | 'inapp';

/**
 * Pure shape of a notification template. Mirrors the DB row but stays
 * IO-free so the domain layer can compose messages without touching
 * Supabase. The DB enforces `channel IN ('email','sms','push','inapp')`
 * via CHECK constraint.
 */
export interface NotificationTemplate {
  code: string;
  channel: NotificationChannel;
  subject_template: string | null;
  body_template: string;
  variables: string[];
  is_active: boolean;
}

/**
 * Customer-side opt-out flags. v1 only emits flags ; future Phase 5.C
 * migration adds the actual columns on `customers`. Caller passes `{}`
 * for "no preferences captured yet" — all channels allowed.
 */
export interface CustomerNotificationPrefs {
  optOutEmail?: boolean;
  optOutSms?: boolean;
  optOutPush?: boolean;
  optOutInApp?: boolean;
}

export interface ComposeResult {
  subject: string;
  body: string;
  missingVars: string[];
}
