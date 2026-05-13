# 07 — Known Risks & Recommendations

> **Last verified**: 2026-05-03

## Overview

This is the integrated risk register for AppGrav V2. It combines:

- Findings from the 2026-04-09 Architecture & Security Audit ([docs/audit/01-architecture-security-audit.md](../../audit/01-architecture-security-audit.md)).
- Findings from the 2026-02-22 RLS Audit (consolidated into [../03-database/06-rls-policies.md](../03-database/06-rls-policies.md)) — most resolved, residual items called out.
- Operational pitfalls listed in [CLAUDE.md](../../../CLAUDE.md).
- Architectural constraints inherent to the product.

Findings are tagged P0 (immediate), P1 (high — fix in next sprint), P2 (medium — backlog), P3 (low — track only). The 2026-04-09 overall scoring: Architecture 8/10, Security 7.5/10, no open P0.

## P0 — Critical (open: 0)

None open. Historical P0 issues now closed:

- **service_role key in git history** (closed pre-2026-03-15) — rotated, history rewritten.
- **Plaintext PIN storage in `pin_code` column** (closed 2026-02-10 by [migration](../../../supabase/migrations/20260210100000_remove_plaintext_pin.sql)) — column nulled out, only `pin_hash` (bcrypt) used.
- **Anon INSERT/UPDATE on `orders` and `order_items`** (closed 2026-04-13 by [migration](../../../supabase/migrations/20260413100000_security_remove_anon_write_policies.sql)) — replaced with `TO authenticated`.
- **`is_admin(auth.uid())` returning FALSE for all V2 users** (closed 2026-02-22) — dual-lookup added.

## P1 — High

### P1-01: Broad anon SELECT RLS on 14+ tables including PII

- **Status**: open.
- **Location**: [supabase/migrations/20260216230000_allow_anon_read_pos_tables.sql](../../../supabase/migrations/) (and follow-ups).
- **Tables affected**: `products`, `categories`, `customers`, `customer_categories`, `promotions`, `settings`, `suppliers`, `orders`, `order_items`, `roles`, `user_roles`, plus a few reference tables.
- **Risk**: anyone with the anon key (which is in the SPA bundle, by design) can `SELECT` rows from these tables without authentication. Includes customer names, phone numbers, and order history.
- **Mitigation in flight**: `auth-verify-pin` now mints a Supabase Auth magic-link JWT, so PIN-logged-in clients have a true `auth.uid()` and the policies can be migrated from `TO anon` to `TO authenticated`. Migration is partial; see RLS_AUDIT_REPORT.
- **Recommendation**: complete the `anon → authenticated` migration. For the few tables that legitimately need device-context reads (KDS, customer display), create narrow PII-free VIEWs and grant `SELECT` only on those.

### P1-02: Client-side PIN fallback bypasses Edge Function controls

- **Status**: open.
- **Location**: [src/services/authService.ts](../../../src/services/authService.ts) `_loginWithPinFallback`.
- **Risk**: when `auth-verify-pin` is unreachable, the client calls `supabase.rpc('verify_user_pin')` directly with the anon key. This bypasses the Edge Function's IP rate limiting (20 req/min/IP) and the Edge Function-level audit logging.
- **Partial mitigation today**: `verify_user_pin` reads `failed_login_attempts` and updates `locked_until`, so brute-force is still bounded by the same 5-strikes/15-min lockout — but only if the RPC handler does the increment, which it currently does.
- **Recommendation**: either (a) remove the fallback (Edge Function downtime usually means the whole stack is down anyway), or (b) move IP rate-limiting into the SQL RPC itself using a transient table.

### P1-03: Edge Function error responses (mostly closed)

- **Status**: closed in `auth-verify-pin` (current source returns generic `Failed to create session`); audit other functions for similar leaks.
- **Recommendation**: grep for `error.message` in Edge Function `errorResponse` calls; replace with generic strings, log details server-side.

## P2 — Medium

### P2-01: Two residual `select('*')` in src/

- [src/hooks/purchasing/useSupplierDetail.ts:69](../../../src/hooks/purchasing/useSupplierDetail.ts), [src/pages/inventory/tabs/UnitsTab.tsx:91](../../../src/pages/inventory/tabs/UnitsTab.tsx).
- **Risk**: over-fetching, future-proofing fragility.
- **Recommendation**: explicit column lists. Down from 107 pre-S2; keep the trend going.

### P2-02: `auth-verify-pin` does not validate `user_id` UUID format

- Defence-in-depth; current behaviour is the DB query simply returns no row.
- **Recommendation**: add `/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(user_id)` early.

### P2-03: Anon read on `roles` and `user_roles`

- Exposes the privilege map. Migration to `authenticated` blocked on the same JWT-propagation work as P1-01.

### P2-04: `console.error` in client code paths

- [src/stores/resetAllStores.ts:44](../../../src/stores/resetAllStores.ts) and a handful of other call-sites.
- **Recommendation**: replace with `logger.error` so production builds suppress per the logger's level filter.

### P2-05: `localStorage.getItem('pos_session_id')` in POSOutstandingPage

- [src/pages/pos/POSOutstandingPage.tsx:40](../../../src/pages/pos/POSOutstandingPage.tsx). Inconsistent with the `sessionStorage` pattern; key origin unclear.
- **Recommendation**: source from the shift store or migrate to sessionStorage.

### P2-06: `auth-logout` accepts `session_id` and `user_id` in body

- Current code validates the caller matches; design is fragile because validation is the only gate against impersonation.
- **Recommendation**: derive both IDs entirely from the session token / JWT, drop the body fields.

### P2-07: SPA CSP — closed (verified 2026-05-03)

- [vercel.json](../../../vercel.json) now serves a CSP header with `default-src 'self'`, scoped script-src, `frame-ancestors 'none'`, and explicit Supabase / Sentry / Anthropic / localhost-3001 connect sources. The 2026-04-09 audit predates this — finding closed.

## P3 — Low

### P3-01: `posLocalSettingsStore` uses `localStorage` (not `sessionStorage`)

- Stores favourites and auto-print only. Non-sensitive, but inconsistent on shared terminals.

### P3-02: Edge Functions pinned to Deno std@0.168.0 (2023)

- Consistent across all 16 functions. Track Supabase's recommended version.

### P3-03: `debug_pearl_sugar.ts` in repo root

- Investigation file with `select('*')`. Should be deleted (covered by `appgrav-cleanup-obsolete` skill scope).

### P3-04: `EXTRA_ALLOWED_ORIGINS` could widen CORS

- Recommendation: validate that values are HTTPS and end in `.thebreakery.app` or `.vercel.app`.

### P3-05: 18 `console.*` calls in src/ (9 files)

- Most in `logger.ts` itself or tests. Audit and route the rest through `logger`.

## Architectural constraints (not findings — inherent properties)

These are not bugs to fix; they are tradeoffs the system was designed around. Documented so future planners do not propose changes that fight the design.

| Constraint | Why it exists | Consequence | Mitigation |
|---|---|---|---|
| **Online-only** (no offline POS) | Volume too low to justify offline sync complexity (~200 tx/day). | Internet outage = POS down. | LAN print server stays up for receipt reprints; cash-only fallback procedure. |
| **Monolithic SPA** (Vite, not Next.js) | Single deployment surface, fast iteration. | All routes downloaded on first visit (mitigated by `React.lazy()`). | Code-split per page. |
| **No message queue** | Vercel + Supabase only; no Redis/SQS. | Long-running operations (invoice generation, daily reports) run in Edge Function timeout. | Operations are short; daily report runs on schedule, off the hot path. |
| **No read replica** | Supabase free/Pro tier. | Heavy reports compete with POS writes. | Materialised views ([03-database/05-views-and-matviews.md](../03-database/05-views-and-matviews.md)) for expensive aggregations. |
| **English-only UI** (i18n suspended) | Local team is fluent; translation drift caused bugs. | Cannot easily onboard non-English speakers. | Document only; revisit if hire mix changes. |
| **Anon key in client bundle** | RLS-protected by design. | Anyone can `SELECT` from anon-policy tables (see P1-01). | Tighten anon SELECT surface (in progress). |
| **PIN-only auth (no MFA)** | Touchscreen POS UX requires fast login. | A leaked PIN is a full breach. | Lockout after 5 attempts; audit logging; 30-min session timeout; manager PIN required for sensitive ops. |

## Operational risks

### LAN

- **Print server is non-redundant.** [src/services/lan/](../../../src/services/lan/) routes print jobs through a single hub. If the hub is down, printing stops. Procedure: failover to a secondary terminal that can take over hub role (manual config switch). See [06-lan-architecture/](../06-lan-architecture/).
- **Hub heartbeat is best-effort.** 30s heartbeat, 120s stale threshold. A network partition can leave clients showing stale device status. Operators check the LAN device dashboard at shift open.
- **No TLS on LAN.** Print server runs HTTP on port 3001 because consumer printers don't have TLS. The CSP already allows `http://localhost:3001 http://127.0.0.1:3001` in `connect-src`. Risk: anyone on the LAN can print arbitrary content. Mitigation: physical-access control of the LAN.

### Database

- **No automatic backup verification.** Supabase keeps 7-day PITR, but we do not periodically test-restore. Manual restore drill recommended quarterly.
- **RLS overhead on large lists.** Even with `is_authenticated()` STABLE caching, list endpoints over 5000 rows can show measurable RLS cost. Today's tables are well under this; if `audit_logs` grows past 100k rows the dashboard query could slow noticeably.
- **`audit_logs` has no purge job.** ~7k rows/year at current volume. At 10x volume (~70k/yr) revisit.
- **RPC concurrency.** `complete_order_with_payments` is the hot RPC. It is idempotent (added 2026-04-29 by [migration](../../../supabase/migrations/20260429234000_add_idempotency_to_complete_order_rpc.sql)) but takes a row lock on `orders`. At >1 tx/sec on the same order ID, lock contention could become visible.

### Tests

- **9 known test failures** in `src/services/__tests__/authService.test.ts`. They exercise Edge Function behaviour against a live Supabase project and fail without one configured. Documented in [CLAUDE.md](../../../CLAUDE.md) "Pitfalls". Not a regression — these tests were always Edge-Function-dependent.

### CI / deploy

- **No staging environment** that mirrors prod. Vercel preview deployments use prod Supabase. A schema change in a PR can break preview deploys for other PRs. Mitigation: schema changes go via dedicated migration PRs, reviewed independently.
- **Sourcemaps uploaded but `hidden` mode.** End users do not see sourcemap URLs in their browser; only Sentry can resolve them. If `SENTRY_AUTH_TOKEN` leaks, attacker can upload spoofed sourcemaps. Mitigation: rotate token annually and on any incident.

## Pitfalls summary (from CLAUDE.md)

These are recurring pitfalls codified to keep Claude Code from regressing them:

- Always use optional chaining on async data (`data?.map(...)`).
- Every new table MUST have RLS enabled + policies — no exceptions.
- After SQL changes, run `/gen-types` to sync TypeScript types.
- Locked cart items require PIN to modify (kitchen-sent items).
- Do NOT use `t()` or i18next — English strings only.
- Split payments use `complete_order_with_payments` RPC — do not use separate createOrder + processPayment calls.
- Promotion engine auto-evaluates on cart changes via `useCartPromotions`.
- Edge Functions: `verify_jwt: true` unless explicitly justified with a `breakery-lint-disable:public-edge-fn` comment.
- Do NOT use `select('*')` — always targeted selects.
- Trigger functions returning `TRIGGER` cannot be invoked standalone (smoke tests must use `pg_proc` lookup, not call).
- `information_schema.role_table_grants` does NOT enumerate matview privileges — use `has_table_privilege(...)`.
- `cmdk` Command primitive defaults `shouldFilter={true}` — pass `shouldFilter={false}` for server-side results.

## Recommended cadence

| Skill | Trigger |
|---|---|
| `/security-review` | Before every release; after any change to auth, RLS, Edge Functions, or env vars. |
| `/db-schema-audit` | After any migration; weekly otherwise. |
| `/accounting-audit` | After any change to journal_entries, RPCs, or accounting_mappings; monthly otherwise. |
| `/report-audit` | When dashboard numbers look off; monthly otherwise. |
| Sentry replay review | Monthly — sample 10-20 replays to verify no PII leakage and look for UX issues. |
| RLS audit | Quarterly — re-run the methodology in [../03-database/06-rls-policies.md](../03-database/06-rls-policies.md) *(consolidated 2026-02-22 audit state)*. |
| Backup restore drill | Quarterly — pick a snapshot, restore to a temporary Supabase project, verify schema + sample row read. |
| Secret rotation | Annually for `SENTRY_AUTH_TOKEN`, `ANTHROPIC_API_KEY`. Immediately on any suspected leak for service_role. |
| Permission inventory | When onboarding/offboarding staff; quarterly otherwise. |
| Lockout / failed-login review | Weekly — check `audit_logs` for `LOGIN_FAILED` clusters. |

## Hardening backlog (open items not classified above)

1. Move `IP rate-limit` for `verify_user_pin` into the SQL RPC (resolves P1-02 fully).
2. Implement audit-log retention policy (24-month rolling window + cold archive).
3. Add `breakery-lint:public-edge-fn` ESLint rule to CI to catch any new `verify_jwt = false` without explanation.
4. Switch all anon SELECT policies to `authenticated` once the magic-link JWT path is proven across all device contexts.
5. Add a SECURITY.md at repo root with disclosure contact (currently bundled into this audit doc).
6. Document & test the failover procedure for the LAN print hub (paper SOP + dry-run).
7. Quarterly Sentry replay PII spot-check (process documented, no automation today).
8. Add UUID format validation to all Edge Functions accepting an ID (P2-02 generalised).

## Cross-references

- [01-auth-flow-pin.md](./01-auth-flow-pin.md), [02-rls-patterns.md](./02-rls-patterns.md), [03-rbac-permissions.md](./03-rbac-permissions.md), [04-edge-function-security.md](./04-edge-function-security.md), [05-secrets-and-env.md](./05-secrets-and-env.md), [06-pii-and-compliance.md](./06-pii-and-compliance.md).
- [docs/audit/01-architecture-security-audit.md](../../audit/01-architecture-security-audit.md) — full 2026-04-09 audit, 15 findings.
- [../03-database/06-rls-policies.md](../03-database/06-rls-policies.md) *(consolidated 2026-02-22 audit state)* — full 2026-02-22 RLS audit + remediation log.
- [CURRENT_STATE.md](../../../CURRENT_STATE.md) — sprint progress, backlog, in-flight items.
- [CLAUDE.md](../../../CLAUDE.md) — coding pitfalls, business rules, environment.
