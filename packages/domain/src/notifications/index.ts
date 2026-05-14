// packages/domain/src/notifications/index.ts
// Session 13 — Phase 5.B — Notifications pipeline barrel.

export type {
  NotificationChannel,
  NotificationTemplate,
  CustomerNotificationPrefs,
  ComposeResult,
} from './types.js';
export { composeMessage, type TemplateVariables } from './composeMessage.js';
export { decideChannels } from './decideChannels.js';
