// packages/domain/src/notifications/decideChannels.ts
// Session 13 — Phase 5.B — Notifications pipeline.
//
// v1 channel decision is intentionally simple : take the template's
// declared channel (email-only MVP per D5), filter by customer opt-out
// flags. The flags struct uses optional booleans so callers can pass
// `{}` for "no preferences captured yet". Future Phase 5.C migration
// adds real `customers.notification_opt_out_*` columns.
//
// Returns the channels actually selected for dispatch — empty array
// means "customer opted out of all viable channels ; don't enqueue".

import type {
  NotificationChannel,
  CustomerNotificationPrefs,
} from './types.js';

const OPT_OUT_BY_CHANNEL: Record<NotificationChannel, keyof CustomerNotificationPrefs> = {
  email: 'optOutEmail',
  sms:   'optOutSms',
  push:  'optOutPush',
  inapp: 'optOutInApp',
};

/**
 * Given a template's declared channel and an optional customer
 * preferences struct, return the list of channels that should actually
 * be used for dispatch.
 *
 * Today v1 contract = single template = single channel. The function
 * returns an array because v2 (Phase 6+) may broadcast across channels
 * for high-priority templates. Empty array = "no channel viable".
 */
export function decideChannels(
  templateChannel: NotificationChannel,
  prefs: CustomerNotificationPrefs = {},
): NotificationChannel[] {
  const optOutKey = OPT_OUT_BY_CHANNEL[templateChannel];
  if (prefs[optOutKey] === true) {
    return [];
  }
  return [templateChannel];
}
