---
name: edge-functions
description: >-
  Supabase Edge Functions (Deno) discipline for The Breakery — PIN & validation
  secrets in a dedicated HTTP header NEVER in the JSON body, the two idempotency
  flavors (HTTP x-idempotency-key for retry safety vs RPC p_client_uuid for
  business idempotence), durable rate-limit, the custom PIN-JWT fetch wrapper
  (HS256 JWT that GoTrue can't validate — never bypass with raw Authorization),
  hard-cutover (no dual-mode fallback), the _shared helpers, CORS/x-app, and the
  getSession()-null-under-PIN-auth trap. Use this skill WHENEVER you create or
  edit supabase/functions/**, wire the POS/BO to an EF, or touch process-payment
  / refund-order / void-order / cancel-item / auth-* / generate-pdf /
  kiosk-issue-jwt, add an idempotency key, or add a rate-limit — invoke it BEFORE
  editing any EF. Boundary: the SQL/RPC the EF calls (versioning, REVOKE, GRANT
  authenticated) → db-migrations + the domain skill; RLS / permission-gate design
  and PIN verification semantics → security-auth; the POS→EF client UX and
  order-to-payment flow → pos-flow-audit. Mirrors the edge-functions-engineer
  agent as an always-on guardrail.
pathPatterns:
  - 'supabase/functions/**'
promptSignals:
  phrases:
    - 'edge function'
    - 'deno'
    - 'process-payment'
    - 'refund-order'
    - 'void-order'
    - 'cancel-item'
    - 'auth-verify-pin'
    - 'x-manager-pin'
    - 'x-idempotency-key'
    - 'idempotency key'
    - 'rate limit'
    - 'PIN header'
    - 'fetch wrapper'
    - 'getSession'
    - 'CORS'
---

# Edge Functions (Deno) — The Breakery ERP

**`CLAUDE.md` (Critical patterns) is the source of truth.** This skill is the always-on guardrail for `supabase/functions/**`; the full EF inventory + deep procedures live in the **`edge-functions-engineer`** agent. On this project **only the POS/BO call these EFs** (no uncontrolled external callers) — which is what makes hard-cutover safe. Verify the live EF (`get_edge_function`) before asserting behaviour.

## The rules you must not break

1. **PIN / secrets in an HTTP header, never in the JSON body.** Any EF consuming a manager PIN or validation secret reads it from a dedicated header (`x-manager-pin`, `x-current-pin`, `x-new-pin`). Bodies get logged (PostgREST, pgaudit, proxies, function logs); headers rarely are. **Hard cutover**: drop the body field in the SAME commit as the header read — no dual-mode. Reference: `refund-order` (S25), `void-order`/`cancel-item` (S34), `auth-change-pin` (S59, EF v8).

2. **Idempotency — pick the right flavor:**
   - **HTTP `x-idempotency-key`** (retry safety): client makes a `crypto.randomUUID()` in a `useRef`, sends the header; EF reads it via `getIdempotencyKey(req)` from `_shared/idempotency.ts` and forwards it as `p_idempotency_key`. Reference: `refund-order` EF + `refund_order_rpc`.
   - **RPC arg `p_client_uuid` / `p_idempotency_key`** (intrinsic business idempotence): REQUIRED at the RPC, keyed into a **dedicated** idempotency table, replay returns the first result (or `{ …, idempotent_replay: true }`). Reference: `create_tablet_order`, `record_b2b_payment_v2`.

3. **The PIN-JWT fetch wrapper is sacred.** `auth-verify-pin` issues HS256 JWTs GoTrue (ES256) can't validate via the default header. The Supabase client injects the PIN JWT on every request via `setSupabaseAccessToken` (in `packages/supabase`). **Never** bypass with a raw `Authorization` header or `auth.setSession`.

4. **`getSession()` returns null under PIN-auth.** A common invisible bug (mocked tests miss it) — the checkout EF path must not rely on `getSession()`; the fetch wrapper carries the token. See MEMORY `browser-only-auth-gaps`.

5. **CORS / `x-app`.** EFs must allow the app's headers or `functions.invoke` is blocked browser-side (another mocked-test blind spot). Extend the CORS allowlist when you add a custom header.

6. **Durable rate-limit** (not in-memory): PIN endpoints and `generate-pdf` (30/min) persist their counters so a restart doesn't reset the window. Secret-header checks (`notification-dispatch`) stay enforced.

7. **The EF calls the current money-path RPC, the POS never does.** `process-payment` → `complete_order_with_payment` (versions omises — vérifier `CLAUDE.md` / `supabase/migrations/`); the discount PIN is verified **in-EF** and carried by a `discount_authorizations` nonce (no PIN in SQL args since S55). When the RPC version bumps, repoint the EF and redeploy.

## Before you ship an EF — checklist
- [ ] Any PIN/secret read from a header, body field dropped same-commit (hard cutover).
- [ ] Idempotency flavor chosen correctly and wired (header→`p_idempotency_key`, or required RPC arg).
- [ ] No raw `Authorization` / `auth.setSession`; fetch wrapper untouched.
- [ ] CORS allowlist covers every custom header the client sends.
- [ ] Rate-limit durable if this is an auth/PDF endpoint.
- [ ] RPC version + `GRANT authenticated` verified with db-migrations; EF redeployed.
- [ ] Live-RPC / EF test added; no reliance on `getSession()` under PIN-auth.
