// apps/backoffice/sentry.client.config.ts
//
// Session 13 / Phase 6.C — Sentry client config entry-point. The actual
// `Sentry.init()` is invoked from `src/main.tsx → initSentry()`. This file
// re-exports both the init helper and the Sentry SDK so tooling that
// inspects `sentry.client.config.ts` (Sentry CLI sourcemap uploader, future
// Next.js adapter) has a canonical entry point.
//
// Init is intentionally NOT called here — Vite does not auto-load this
// file, calling `Sentry.init()` here would only matter if a tool imports
// it explicitly. Doing so via two paths would double-init the SDK.
//
// See deviation D-W6-6C-01.

export * as Sentry from '@sentry/react';
export { initSentry } from './src/lib/sentry';
