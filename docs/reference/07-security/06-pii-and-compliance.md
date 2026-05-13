# 06 — PII & Compliance

> **Last verified**: 2026-05-03

## Overview

The Breakery operates in Indonesia (Lombok), serving a small B2C clientele plus B2B partners. There is no strict regulatory regime equivalent to GDPR or CCPA on the operator (Indonesia's UU PDP — Personal Data Protection Law — entered force October 2024 but enforcement against small merchants is light). We nonetheless apply a defensive minimum-PII posture because the database is exposed to a small but non-zero set of insider risks (cashiers, baristas, ex-employees) and Sentry replays could capture customer interactions.

This document inventories the PII surfaces, documents the scrubbing layers, and lists the operational practices.

## PII inventory

| Data | Stored where | Typical fields | Sensitivity |
|---|---|---|---|
| Customer name | `customers.first_name`, `last_name`, `display_name` | full name | medium |
| Customer phone | `customers.phone` | E.164 | medium |
| Customer email | `customers.email` | email | medium |
| Customer address | `customers.address`, `city`, `postal_code` | postal address | medium |
| Customer birthdate | `customers.birthdate` | DATE | medium |
| Loyalty profile | `customers.loyalty_points`, `customers.loyalty_tier_id` | points balance | low |
| Order history | `orders` joined to `customers` | full purchase history per customer | medium |
| Staff PII | `user_profiles.first_name`, `last_name`, `phone`, `email`, `employee_code` | employee identity | high (smaller pool, easier to re-identify) |
| Auth artefacts | `user_profiles.pin_hash`, `user_sessions.session_token_hash` | bcrypt + SHA-256 hashes | hash only — never plaintext |
| B2B contacts | `customers` rows where `customer_type='b2b'` | business name, contact name, phone, email, NPWP (Indonesian tax ID) | medium |
| Supplier contacts | `suppliers.contact_name`, `phone`, `email`, `bank_account` | business identity + payment details | medium-high |
| IP / user-agent | `user_sessions.ip_address`, `user_agent` + `audit_logs.ip_address`, `user_agent` | network forensics | low |

## What is **not** stored

Deliberate omissions to minimise blast radius:

- **No payment card numbers** — POS handles cash + Indonesian e-wallets (QRIS); no card-present terminal integration. PCI-DSS scope: out.
- **No biometrics** — no fingerprint/face PIN.
- **No GPS / location data** — no per-order geolocation.
- **No customer photos** beyond `avatar_url` (rarely populated).
- **No marketing consent flags / cookie tracking** — there is no marketing email flow today.

## RLS as the primary PII gate

All `customers`, `orders`, `user_profiles`, `audit_logs`, `suppliers`, and `b2b_*` tables have RLS enabled with `is_authenticated()` SELECT policies. The unresolved P1-01 finding ([docs/audit/01-architecture-security-audit.md](../../audit/01-architecture-security-audit.md)) notes that 16+ tables historically had `anon SELECT` policies too — these are being narrowed to `authenticated` as the magic-link JWT minted by `auth-verify-pin` propagates. Track the residual surface in [07-known-risks.md](./07-known-risks.md).

There are no purpose-built "PII-redacted" views today. If a future requirement demands a public read surface (e.g., customer-facing loyalty status check), the pattern is: create a `VIEW` that selects only `display_name` and `loyalty_points`, grant `SELECT` on the view to `anon`, and **don't** grant `SELECT` on the underlying table.

## Sentry — error monitoring & session replay

Source: [src/lib/sentry.ts](../../../src/lib/sentry.ts). Active in production only (`IS_PRODUCTION && VITE_SENTRY_DSN`).

### Scrubbing

```ts
beforeSend(event) {
  // Remove any potential PII from breadcrumbs
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((breadcrumb) => {
      if (breadcrumb.category === 'xhr' || breadcrumb.category === 'fetch') {
        // Strip auth headers from request breadcrumbs
        if (breadcrumb.data?.['headers']) {
          delete breadcrumb.data['headers'];
        }
      }
      return breadcrumb;
    });
  }
  return event;
}
```

This strips `Authorization` and `x-session-token` from every captured HTTP breadcrumb so a leaked event does not let a Sentry viewer impersonate the user.

### User context

```ts
Sentry.setUser({
  id: user.id,            // user_profiles.id (UUID, opaque)
  ...(user.role && { role: user.role }),  // role code, not name
  // Email is intentionally omitted
});
```

We send the user UUID and role code only — never email, never display name. The UUID is opaque outside the system, so Sentry cannot re-identify the human without joining against our DB.

### Session replay

```ts
Sentry.replayIntegration({
  maskAllText: true,        // Every text node masked by default
  blockAllMedia: true,      // Images, video, canvas blocked
}),
replaysSessionSampleRate: 0.1,    // 10% of sessions
replaysOnErrorSampleRate: 1.0,    // 100% of sessions where an error fires
```

`maskAllText: true` is critical — without it, every typed PIN, customer name, and order detail would be in the replay. With it, the captured DOM shows boxes-instead-of-text, which is enough to reproduce the click path without exfiltrating data.

`blockAllMedia: true` covers receipt previews, customer avatars, and product images — anything that could re-identify or contain PII.

Limitation: HTML class/id names and route URLs are still captured. We carefully avoid putting customer identifiers in URLs (`/customers/:uuid` not `/customers/:phone`) to keep replays useful but anonymous.

### Ignored errors

```ts
ignoreErrors: [
  'ResizeObserver loop',
  'ResizeObserver loop completed with undelivered notifications',
  'Failed to fetch',
  'NetworkError',
  'Load failed',
  'JWT expired',
  'Auth session missing',
],
```

These are noise filters; they reduce alert fatigue but do not affect PII scrubbing.

## Audit logs — full trail

`audit_logs` records every privileged action (LOGIN, LOGIN_FAILED, LOGOUT, pin_change, CREATE/UPDATE/DELETE on user_profiles, void, refund, settings updates, etc.) with:

- `user_id` (perpetrator)
- `entity_type` + `entity_id` (target)
- `old_values`, `new_values` (JSON snapshots)
- `ip_address`, `user_agent`
- `severity` (`info | warning | critical`)

Note that `old_values` / `new_values` may include PII when the modified table contains PII (e.g., a customer phone number update). Access to `audit_logs` is gated by `admin.audit` permission.

Retention: there is no automated purge job today; rows accumulate indefinitely. Backlog: implement a 24-month rolling window with the older rows archived to cold storage if size becomes a concern (~200 tx/day = ~7k rows/year, manageable).

## Application logging

The shared logger ([src/utils/logger.ts](../../../src/utils/logger.ts)) is used everywhere instead of `console.*` in production builds. It strips arguments in production and only emits warnings/errors. Specifically forbidden patterns:

- Do not `logger.info` a customer name or phone.
- Do not `logger.debug` a PIN, even temporarily.
- Do not include `user_profiles.email` in any log message.

Edge Functions use `console.error` (Deno runtime) for server-side error reporting; the shared CORS module strips sensitive headers from echoed responses. There is no centralised log aggregator beyond Supabase's built-in Functions Logs panel.

## Backups & data lifecycle

- **Supabase managed backups** — daily Point-In-Time-Recovery snapshots are retained 7 days on the Pro plan (current tier). Snapshots include all tables, including PII. Stored in Supabase's infrastructure.
- **Manual backups** — none scheduled; if needed, exported via `pg_dump` to a local encrypted disk.
- **No PII export to third parties** — Sentry receives only scrubbed events; no analytics SDKs (no GA, no Mixpanel, no Hotjar).

When a customer asks to be forgotten:

1. Soft-delete the customer record (`UPDATE customers SET deleted_at = NOW(), email = NULL, phone = NULL, address = NULL WHERE id = ?`). Keep the row so historical orders can still join (FK preserved) but blank the PII columns.
2. Anonymise their `display_name` to `Customer #<short-uuid>`.
3. Log the redaction in `audit_logs` with `severity = 'warning'`.
4. The 7-day backup window will eventually purge the prior PII; for faster eviction the user can request snapshot deletion from Supabase support.

## Indonesian compliance landscape

- **UU PDP (Law 27/2022)** — Personal Data Protection Law, in force since Oct 2024. Requires consent for processing PII, breach notification, and a Data Protection Officer for "controllers" handling large volumes. The Breakery is below the threshold today but should track the implementing regulations.
- **No SAK reporting includes PII** — accounting reports (SAK EMKM) aggregate revenue and tax; no individual customer rows.
- **PB1 (Pajak Restoran)** is reported to the local government as monthly aggregates; no per-customer detail.

## Contractor / staff offboarding

When a staff member leaves:

1. Disable the account: `UPDATE user_profiles SET is_active = FALSE WHERE id = ?`. The auth-verify-pin path rejects inactive users (`Invalid credentials`).
2. End all active sessions: `UPDATE user_sessions SET ended_at = NOW(), end_reason = 'forced' WHERE user_id = ? AND ended_at IS NULL`.
3. Rotate any shared device PINs the staff member knew (e.g., kitchen station PIN).
4. Audit `audit_logs` for the prior 30 days for anomalies.
5. Do **not** delete the row — orders and audit trail need the FK.

The `auth-user-management` Edge Function automates steps 1-2 in the `delete` and `toggle_active` (off) actions ([auth-user-management/index.ts:328-470](../../../supabase/functions/auth-user-management/index.ts)).

## Sentry — sampling implications

`tracesSampleRate: 0.2` and `replaysSessionSampleRate: 0.1` mean we capture 20% of performance traces and 10% of session replays in production. This is intentional:

- **Privacy budget** — even with `maskAllText` and `blockAllMedia`, every replay represents a potential disclosure surface (e.g., new DOM regions added without scrubbing). Sampling 10% reduces the absolute exposure.
- **Storage budget** — Sentry plans charge per replay; the small operator scale (~20 staff, ~200 tx/day) makes 100% impractical.
- **Error capture is 100%** — `replaysOnErrorSampleRate: 1.0` ensures every error fires a replay so we can debug the bug context. Pair this with the breadcrumb header scrubbing above.

Trace propagation is restricted to `localhost` and `https://abjabuniwkqpfsenxljp.supabase.co` via `tracePropagationTargets`. We do **not** propagate Sentry trace headers to Anthropic's API (claude-proxy proxies it server-side) or to external print servers (LAN HTTP).

## When Sentry receives a payload, who can see it?

- The Sentry organisation `the-breakery` has a small viewer list (engineering + ops). Add/remove via Sentry org settings.
- Replays are visible only to logged-in viewers; URLs are not shareable without auth.
- We do not enable "Allow Sharing" or public issue links.
- If a replay must be shared with a third party (e.g., a vendor support ticket), download the JSON, manually re-redact, and share the snippet — never the live URL.

## Cross-references

- [01-auth-flow-pin.md](./01-auth-flow-pin.md) — auth artefact storage (PIN hash, session hash).
- [02-rls-patterns.md](./02-rls-patterns.md) — RLS as primary PII gate.
- [04-edge-function-security.md](./04-edge-function-security.md) — error sanitisation in Edge Functions.
- [07-known-risks.md](./07-known-risks.md) — residual anon SELECT surface, fallback paths.
- [src/lib/sentry.ts](../../../src/lib/sentry.ts) — full Sentry config.
