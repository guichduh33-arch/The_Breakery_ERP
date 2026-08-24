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
    integrations: [Sentry.browserTracingIntegration()],
  });
  // Re-audit 2026-08-24 (perf P1) — replayIntegration référencé statiquement
  // embarquait rrweb (~100 kB gzip) dans le bundle critique, payé avant le
  // premier paint par 100 % des sessions pour un replay échantillonné à 10 %.
  // lazyLoadIntegration le charge hors bundle, après l'init ; sans réseau le
  // replay est simplement absent — la capture d'erreurs, elle, reste locale.
  Sentry.lazyLoadIntegration('replayIntegration')
    .then((replayIntegration) => {
      Sentry.addIntegration(replayIntegration());
    })
    .catch(() => {
      // Réseau de boutique coupé : pas de replay pour cette session.
    });
  setBreadcrumbHook((level, message, data) => {
    const breadcrumb: Sentry.Breadcrumb = { level: level as Sentry.SeverityLevel, message };
    if (data !== undefined) breadcrumb.data = data;
    Sentry.addBreadcrumb(breadcrumb);
  });
}
