// apps/backoffice/src/lib/sentry.ts
import * as Sentry from '@sentry/react';
import { parseAppEnv } from '@breakery/utils';

const env = parseAppEnv(import.meta.env);

export function initSentry(): void {
  if (!env.VITE_SENTRY_DSN_BACKOFFICE) return;
  Sentry.init({
    dsn: env.VITE_SENTRY_DSN_BACKOFFICE,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0.1,
  });
}
