// apps/backoffice/src/lib/sentry.ts
import * as Sentry from '@sentry/react';
import { parseAppEnv, sanitizeSentryEvent, sentryPrivacyOptions } from '@breakery/utils';

const env = parseAppEnv(import.meta.env);

export function initSentry(): void {
  if (!env.VITE_SENTRY_DSN_BACKOFFICE) return;
  Sentry.init({
    dsn: env.VITE_SENTRY_DSN_BACKOFFICE,
    environment: import.meta.env.MODE,
    ...sentryPrivacyOptions,
    // Aucune collecte de navigation, de sessions ou de corps HTTP.
    integrations: (defaults) => defaults.filter((integration) =>
      ['InboundFilters', 'FunctionToString', 'BrowserApiErrors', 'GlobalHandlers', 'LinkedErrors', 'Dedupe'].includes(integration.name)),
    beforeSend: (event, hint) => {
      hint.attachments = [];
      return sanitizeSentryEvent(event);
    },
  });
}
