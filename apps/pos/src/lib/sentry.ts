// apps/pos/src/lib/sentry.ts
import * as Sentry from '@sentry/react';
import { sanitizeSentryEvent, sentryPrivacyOptions } from '@breakery/utils';

export function initSentry(): void {
  const dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN_POS as string | undefined;
  if (!dsn) return;
  Sentry.init({
    dsn,
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
