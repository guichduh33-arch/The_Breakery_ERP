// apps/pos/src/lib/sentry.ts
import * as Sentry from '@sentry/react';
import { setBreadcrumbHook } from '@breakery/utils';

export function initSentry(): void {
  const dsn: string | undefined = import.meta.env.VITE_SENTRY_DSN_POS as string | undefined;
  if (!dsn) return;
  const environment: string = import.meta.env.MODE;
  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: 0.2,
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
  });
  setBreadcrumbHook((level, message, data) => {
    const breadcrumb: Sentry.Breadcrumb = { level: level as Sentry.SeverityLevel, message };
    if (data !== undefined) breadcrumb.data = data;
    Sentry.addBreadcrumb(breadcrumb);
  });
}
