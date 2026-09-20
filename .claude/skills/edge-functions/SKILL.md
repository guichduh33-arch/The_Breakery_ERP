---
name: edge-functions
description: >-
  Edge Functions Deno Breakery et appels POS/BO : PIN en header, idempotence, fetch wrapper PIN-JWT, CORS, rate limit et déploiement. Avant de modifier une EF ou son appel ; SQL : db-migrations.
---

# Edge Functions (Deno) — The Breakery ERP

Appliquer AGENTS.md. Suivre l’appel client, le helper partagé et la RPC concernée ; vérifier l’EF déployée avant d’affirmer son comportement live. Ne pas charger un inventaire complet pour un handler isolé.

## The rules you must not break

1. **PIN / secrets in an HTTP header, never in the JSON body.** Any EF consuming a manager PIN or validation secret reads it from a dedicated header (`x-manager-pin`, `x-current-pin`, `x-new-pin`). Bodies get logged (PostgREST, pgaudit, proxies, function logs); headers rarely are. **Hard cutover**: drop the body field in the SAME commit as the header read — no dual-mode. Reference: `refund-order` (S25), `void-order`/`cancel-item` (S34), `auth-change-pin` (S59, EF v8).

2. **Idempotence — deux couches compatibles, selon le parcours :**
   - **HTTP `x-idempotency-key`** (retry safety): client makes a `crypto.randomUUID()` in a `useRef`, sends the header; EF reads it via `getIdempotencyKey(req)` from `_shared/idempotency.ts` and forwards it as `p_idempotency_key`. Reference: `refund-order` EF + `refund_order_rpc`.
   - **RPC arg `p_client_uuid` / `p_idempotency_key`** (intrinsic business idempotence): REQUIRED at the RPC, keyed into a **dedicated** idempotency table, replay returns the first result (or `{ …, idempotent_replay: true }`). Reference: `create_tablet_order`, `record_b2b_payment`.

3. **The PIN-JWT fetch wrapper is sacred.** `auth-verify-pin` issues HS256 JWTs GoTrue (ES256) can't validate via the default header. The Supabase client injects the PIN JWT on every request via `setSupabaseAccessToken` (in `packages/supabase`). **Never** bypass with a raw `Authorization` header or `auth.setSession`.

4. **`getSession()` returns null under PIN-auth.** A common invisible bug (mocked tests miss it) — the checkout EF path must not rely on `getSession()`; the fetch wrapper carries the token. Vérifier le call-site réel et `packages/supabase/src/client.ts` ; un mock de session ne prouve pas le comportement sous PIN.

5. **CORS / `x-app`.** EFs must allow the app's headers or `functions.invoke` is blocked browser-side (another mocked-test blind spot). Extend the CORS allowlist when you add a custom header.

6. **Durable rate-limit** (not in-memory): PIN endpoints and `generate-pdf` (30/min) persist their counters so a restart doesn't reset the window. Secret-header checks (`notification-dispatch`) stay enforced.

7. **The EF calls the current money-path RPC, the POS never does.** `process-payment` → `complete_order_with_payment` (versions omises — vérifier `CLAUDE.md` / `supabase/migrations/`); the discount PIN is verified **in-EF** and carried by a `discount_authorizations` nonce (no PIN in SQL args since S55). When the RPC version bumps, repoint the EF and redeploy.

## Before you ship an EF — checklist
- [ ] Any PIN/secret read from a header, body field dropped same-commit (hard cutover).
- [ ] Couches d’idempotence applicables câblées : header de retry transmis à la RPC et clé métier obligatoire selon le contrat ; un header seul ne prouve pas l’idempotence serveur.
- [ ] No raw `Authorization` / `auth.setSession`; fetch wrapper untouched.
- [ ] CORS allowlist covers every custom header the client sends.
- [ ] Rate-limit durable if this is an auth/PDF endpoint.
- [ ] RPC version et grants du rôle réellement utilisé vérifiés avec db-migrations; EF redeployed.
- [ ] Live-RPC / EF test added; no reliance on `getSession()` under PIN-auth.
