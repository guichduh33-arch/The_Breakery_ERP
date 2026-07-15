# Kiosk-mode Auth Design — `kiosk-issue-jwt`

> **Date** : 2026-05-13 (Phase 0.3 of Session 13)
> **Spec ref** : `docs/workplan/specs/2026-05-13-session-13-spec.md` D18 (kiosk-mode auth) + D19 (channel uniqueness)
> **Plan ref** : `docs/workplan/plans/2026-05-13-session-13-INDEX.md` Phase 0.3 lines 175-198
> **Audit ref** : `docs/workplan/specs/2026-05-13-session-13-architecture-audit.md` R4 (RLS anon→authenticated breaks KDS / Display / Tablet)
> **Status** : Draft for lead review — staged in `docs/workplan/refs/` per the executor brief
> **Author** : sec-design subagent (executor of Phase 0.3 — security architect hat)

---

## 0. Problem statement

Tâche `25-001` (Phase 1 Stream B) bascule les RLS lecture des tables PII (`orders`, `order_items`, `customers`, `customer_categories`, `user_roles`, `pos_sessions`, `restaurant_tables`, `business_config`) de `is_authenticated()` (qui inclut implicitement les anonymes via aucun GRANT explicite) vers **strictement `authenticated`** (i.e. `auth.uid() IS NOT NULL`).

Trois surfaces n'ont aujourd'hui **aucun PIN staff** :

| Surface | Code path | Données nécessaires |
|---|---|---|
| **KDS** (`apps/pos/src/features/kds/`) | `Kds.tsx` route + `useKdsRealtime` | `orders` (status, table_number), `order_items` (name, modifiers, dispatch_station, kitchen_status) |
| **Customer Display** (16, build-from-scratch Phase 4) | `CustomerDisplayPage.tsx` | `orders` (order_number, status, total — public-safe), `order_items` (name, qty) **sans PII client** |
| **Tablet** (`apps/pos/src/features/tablet/`) | `Tablet.tsx` route | `orders` (own only via `customer_id`), `order_items`, `products`, `customer_categories` |

Sans authentification, ces surfaces casseront **silencieusement** quand 25-001 atterrira (RLS denied → fetch retourne 0 row, pas d'erreur visible immediate, KDS affiche "no orders").

L'audit (R4) flagge ce blocker comme **likelihood High / impact L (large)**. Solution actée : **EF `kiosk-issue-jwt`** émet un JWT court-vivant (24 h) signé identiquement au PIN flow, scopé sur `kds`, `display`, ou `tablet`. Les RLS lisent `auth.jwt() ->> 'scope'` pour autoriser des SELECT non-PII.

---

## 1. Threat model

### 1.1 Acteurs

| Acteur | Trust | Accès attendu |
|---|---|---|
| **Staff PIN holder** | High | Tout, via auth-verify-pin (HS256 JWT, `sub = auth_user_id`, `role = 'authenticated'`, `app_metadata.provider = 'pin'`) |
| **Kiosk hardware (KDS station, Display, Tablet)** | Medium | Lecture filtrée des PII tables ; **aucune écriture**. JWT = `auth_user_id IS NULL`, `app_metadata.provider = 'kiosk'`, `scope` ∈ {`kds`, `display`, `tablet`} |
| **LAN visitor** (laptop random) | None | Doit échouer à obtenir un kiosk JWT (rate-limit + secret/cert) |
| **WAN attacker** (internet) | None | EF doit être WAN-reachable (Vercel POS hits Supabase) MAIS l'IP-allowlist + `kiosk_secret` doivent rendre la fenêtre d'exploit étroite |

### 1.2 STRIDE (ciblé)

| Threat | Vector | Mitigation |
|---|---|---|
| **S**poofing — fake kiosk obtient un JWT | Rejouer `kiosk_secret` volé sur un autre LAN | Couple `kiosk_id` + `kiosk_secret` (UNIQUE en DB), `secret` rotatable, secret hashé bcrypt en DB (jamais en clair), audit-logged sur chaque issue |
| **T**ampering — modifier le scope dans le JWT côté client | Manipuler payload base64 | HS256 sig (HMAC-SHA-256) avec `SUPABASE_JWT_SECRET` — flip de payload = sig invalide → GoTrue/RLS rejette |
| **R**epudiation — un kiosk nie une action | KDS marque un item served | Toutes les écritures restent **PIN-gated** (mark_item_served, etc.) ; kiosk JWT n'a aucune `users.*` permission. JWT issuance audit-logged dans `audit_logs` (`action = 'kiosk.token.issued'`, `metadata.kiosk_id`, `ip`) |
| **I**nformation disclosure — kiosk lit PII client | KDS station lit `customers.phone` | Per-table column GRANT (cf §4) + RLS policy `kiosk_can_read` interdit `customers` direct ; KDS lit via `view_kds_tickets` (anonymisé : pas de `customer_id` dans la vue) |
| **D**enial of service — flood `kiosk-issue-jwt` | Rate-exhaust | Rate-limit 10/min/IP partagé (cf §5) + 1/min/kiosk_id ; côté EF un 429 sur excess |
| **E**levation of privilege — kiosk JWT s'auto-promu admin | Forger un scope `admin` ou un `role = 'authenticated'` avec un vrai `sub` | Payload **construit serveur uniquement** ; client n'envoie que `kiosk_id` + `kiosk_secret` ; EF rejette tout `scope` non-whitelisté ; **`sub` reste vide / synthétique** (cf §3 schéma payload). RLS policies vérifient `scope IS NOT NULL AND scope IN (...)` — un PIN JWT (sans `scope`) ne déclenche jamais la branche kiosk |

### 1.3 Verdict design

**LAN-only + admin-bootstrapped device tokens** (cf §6). Refus de :
- ❌ **mTLS / certificats clients** : impose nginx/Caddy en front et bouleverse l'infra Vercel/Supabase (Supabase Edge Functions ne supportent pas mTLS native côté inbound — flag overhead trop élevé pour Session 13).
- ❌ **JWT auto-issued à l'ouverture de page** : aucun secret côté kiosk = zéro authentification ; tout LAN visitor en aurait un.
- ✅ **Hybride** : un admin Back-Office "appaire" un kiosk via une UI dédiée (BO `/backoffice/settings/kiosks`) → génère un `kiosk_id` + `kiosk_secret` (one-shot affichable) ; le kiosk persiste `kiosk_secret` dans `localStorage` (POS app boot) ; chaque session de page appelle `kiosk-issue-jwt` au mount pour obtenir un access_token frais. Si le device est volé, l'admin révoque (`UPDATE kiosk_devices SET revoked_at = now()`).

---

## 2. Edge Function signature

### 2.1 Endpoint

```
POST {SUPABASE_URL}/functions/v1/kiosk-issue-jwt
```

### 2.2 Headers

| Header | Value | Comment |
|---|---|---|
| `Content-Type` | `application/json` | |
| `apikey` | `SUPABASE_ANON_KEY` | Standard Supabase EF gate |
| `X-Kiosk-Secret` | `<secret>` | Sent in header (NOT body) — easier rate-limit pre-parse, easier to redact in logs |

### 2.3 Body

```json
{
  "kiosk_id": "kiosk_<uuid>",
  "scope": "kds" | "display" | "tablet",
  "device_label": "Kitchen Front Station 1"  // optional, logged for audit
}
```

### 2.4 Success response (200)

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "token_type": "Bearer",
  "expires_at": 1747339200,
  "kiosk": {
    "id": "kiosk_a3f...",
    "scope": "kds",
    "device_label": "Kitchen Front Station 1"
  }
}
```

### 2.5 Error responses

| Status | Body | When |
|---|---|---|
| 400 | `{"error": "invalid_json"}` | Body parse fail |
| 400 | `{"error": "missing_fields"}` | `kiosk_id` or `scope` absent |
| 400 | `{"error": "invalid_scope"}` | Scope not in whitelist |
| 401 | `{"error": "kiosk_secret_required"}` | No `X-Kiosk-Secret` header |
| 401 | `{"error": "kiosk_not_found"}` | `kiosk_id` doesn't match an active device |
| 401 | `{"error": "kiosk_secret_invalid"}` | Bcrypt compare fail |
| 403 | `{"error": "kiosk_revoked"}` | `revoked_at IS NOT NULL` |
| 403 | `{"error": "kiosk_scope_mismatch"}` | DB scope ≠ requested scope (e.g. KDS device asking for tablet token) |
| 403 | `{"error": "ip_not_allowed", "ip": "x.x.x.x"}` | IP allowlist enforced (staging only — see §6) |
| 429 | `{"error": "rate_limited", "retry_after_sec": N}` | Either per-IP (10/min) or per-kiosk_id (1/min) exceeded |
| 500 | `{"error": "server_misconfigured_no_jwt_secret"}` | `JWT_SECRET` / `SUPABASE_JWT_SECRET` env var missing |

---

## 3. JWT signing + payload schema

### 3.1 Signing approach

**Reuse the PIN HS256 pattern** — same `JWT_SECRET` / `SUPABASE_JWT_SECRET` env var, same Web-Crypto `signJwt` helper as in `supabase/functions/auth-verify-pin/index.ts:226-235`. Rationale :

- The custom-fetch wrapper in `packages/supabase/src/client.ts:73-80` injects the bearer token blindly via header — **it does not care whether the JWT came from PIN or kiosk**. Zero client changes needed.
- GoTrue ES256 issue is bypassed identically (HS256 verifies by `SUPABASE_JWT_SECRET` configured in Supabase project ; Realtime + PostgREST honor it as a first-class authenticated session).
- Refactor candidate : **extract** `signJwt` + `getHmacKey` (lines 212-235 of `auth-verify-pin/index.ts`) **into `supabase/functions/_shared/jwt.ts`** as part of Phase 1.B alongside the rate-limit helper. Both `auth-verify-pin` and `kiosk-issue-jwt` then import it. Cuts ~25 LoC duplication and centralizes the `_hmacKey` cache.

**Rejected** : separate `SUPABASE_KIOSK_JWT_SECRET`. Would force `JWT_SECRET` to be a comma-separated list in Supabase config, complicates Realtime auth (Realtime accepts only one HS256 secret), no observable security benefit (kiosk and PIN both speak Postgres-RLS via the same trust boundary).

### 3.2 Payload schema

```typescript
interface KioskJwtPayload {
  iss: 'supabase';
  ref: string;                       // Same as PIN flow (e.g. 'local', 'breakery-prod')
  role: 'authenticated';             // CRITICAL — RLS `is_authenticated()` returns TRUE
  aud: 'authenticated';
  sub: string;                       // Synthetic UUID = `kiosk_devices.id` (NOT a real auth.users row)
  email: `kiosk-${kiosk_id}@thebreakery.local`;
  iat: number;
  exp: number;                       // iat + 24*3600 (24 hours)
  app_metadata: {
    provider: 'kiosk';               // DISTINCT from 'pin' — RLS branch on this
    kiosk_id: string;
    scope: 'kds' | 'display' | 'tablet';
  };
  user_metadata: {
    device_label?: string;
  };
}
```

#### Key design notes

| Field | Why |
|---|---|
| `role: 'authenticated'` | Required for `is_authenticated()` helper (`auth.uid() IS NOT NULL`) to return TRUE on existing tables. Without this, even GRANT-level access to `roles` / `products` would silently fail. |
| `sub: <kiosk_devices.id>` | A non-`auth.users` UUID. `auth.uid()` will return it. RLS policies that JOIN `user_profiles ON auth_user_id = auth.uid()` will return ZERO rows (correct — kiosk has no user profile, no permissions). |
| `app_metadata.provider: 'kiosk'` | Distinguishing claim — RLS policies opt-in to kiosk access via `(auth.jwt() ->> 'app_metadata' -> 'provider')::text = 'kiosk'`. PIN JWTs (`provider = 'pin'`) ignore the branch. |
| `app_metadata.scope` | Three values — RLS policies whitelist by scope (KDS sees kitchen statuses, Tablet sees own orders only, Display sees order_number+status only). |
| `exp = iat + 24h` | Long enough to avoid mid-shift re-issue ; short enough that a stolen secret window is bounded. Auto-renewal: kiosk app re-calls `kiosk-issue-jwt` at boot and every 12 h. |
| No `permissions[]` | Kiosk has no `has_permission()` capabilities. Writes blocked by RLS policies (no `INSERT`/`UPDATE` policy matches `provider = 'kiosk'`). |

### 3.3 Code skeleton (Phase 1.B target)

```typescript
// supabase/functions/kiosk-issue-jwt/index.ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { handleCors, jsonResponse } from '../_shared/cors.ts';
import { getAdminClient } from '../_shared/supabase-admin.ts';
import { checkRateLimit, getClientIp } from '../_shared/rate-limit.ts';
import { signJwt } from '../_shared/jwt.ts';            // NEW — extracted Phase 1.B
import { isIpAllowed } from '../_shared/ip-allowlist.ts'; // NEW — Phase 0.3 staging-only

const VALID_SCOPES = ['kds', 'display', 'tablet'] as const;
type Scope = (typeof VALID_SCOPES)[number];

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);

  const ip = getClientIp(req);

  // (a) Per-IP rate-limit (D17 shared helper)
  const ipRL = checkRateLimit(`kiosk-jwt:ip:${ip}`, 10);
  if (!ipRL.allowed) return jsonResponse({ error: 'rate_limited', retry_after_sec: ipRL.retryAfterSec }, 429);

  // (b) Staging IP allowlist (env-gated — see §6)
  if (Deno.env.get('KIOSK_IP_ALLOWLIST_ENABLED') === 'true') {
    if (!await isIpAllowed(ip)) return jsonResponse({ error: 'ip_not_allowed', ip }, 403);
  }

  // (c) Parse body
  const secret = req.headers.get('X-Kiosk-Secret');
  if (!secret) return jsonResponse({ error: 'kiosk_secret_required' }, 401);

  let body: { kiosk_id?: string; scope?: string; device_label?: string };
  try { body = await req.json(); } catch { return jsonResponse({ error: 'invalid_json' }, 400); }
  const { kiosk_id, scope, device_label } = body;
  if (!kiosk_id || !scope) return jsonResponse({ error: 'missing_fields' }, 400);
  if (!VALID_SCOPES.includes(scope as Scope)) return jsonResponse({ error: 'invalid_scope' }, 400);

  // (d) Per-kiosk rate-limit (1/min)
  const kRL = checkRateLimit(`kiosk-jwt:id:${kiosk_id}`, 1);
  if (!kRL.allowed) return jsonResponse({ error: 'rate_limited', retry_after_sec: kRL.retryAfterSec }, 429);

  // (e) Validate kiosk + secret via SECURITY DEFINER RPC
  const admin = getAdminClient();
  const { data: kiosk, error } = await admin.rpc('verify_kiosk_secret_v1', {
    p_kiosk_id: kiosk_id,
    p_secret: secret,
  });
  if (error || !kiosk) return jsonResponse({ error: 'kiosk_not_found' }, 401);
  if (!kiosk.secret_valid) return jsonResponse({ error: 'kiosk_secret_invalid' }, 401);
  if (kiosk.revoked) return jsonResponse({ error: 'kiosk_revoked' }, 403);
  if (kiosk.scope !== scope) return jsonResponse({ error: 'kiosk_scope_mismatch' }, 403);

  // (f) Mint JWT
  const jwtSecret = Deno.env.get('JWT_SECRET') ?? Deno.env.get('SUPABASE_JWT_SECRET');
  if (!jwtSecret) return jsonResponse({ error: 'server_misconfigured_no_jwt_secret' }, 500);
  const nowSec = Math.floor(Date.now() / 1000);
  const exp = nowSec + 24 * 3600;
  const accessToken = await signJwt({
    iss: 'supabase',
    ref: Deno.env.get('SUPABASE_PROJECT_REF') ?? 'local',
    role: 'authenticated',
    aud: 'authenticated',
    sub: kiosk.id,
    email: `kiosk-${kiosk_id}@thebreakery.local`,
    iat: nowSec,
    exp,
    app_metadata: { provider: 'kiosk', kiosk_id, scope },
    user_metadata: { device_label: device_label ?? kiosk.device_label },
  }, jwtSecret);

  // (g) Audit log + last_seen_at update
  await admin.from('audit_logs').insert({
    actor_id: null,
    action: 'kiosk.token.issued',
    entity_type: 'kiosk_devices',
    entity_id: kiosk.id,
    metadata: { kiosk_id, scope, ip, device_label },
  });
  void admin.from('kiosk_devices').update({ last_seen_at: new Date().toISOString() }).eq('id', kiosk.id);

  return jsonResponse({
    access_token: accessToken,
    token_type: 'Bearer',
    expires_at: exp,
    kiosk: { id: kiosk.id, scope, device_label: kiosk.device_label },
  });
});
```

---

## 4. RLS policy adjustments needed

### 4.1 Inventaire des tables touchées

Verified via `Grep "FOR SELECT TO authenticated" supabase/migrations/` → 0 hits. **Current pattern uses `USING (is_authenticated())`** which is fine *until* 25-001 tightens column grants. Tâche 25-001 will likely move PII columns behind explicit per-column GRANT + per-policy `auth.jwt()` claim checks.

**Tables that KDS / Display / Tablet currently read** (validated via grep on their hooks):

| Table | Required by | Sensitivity | New RLS shape after 25-001 |
|---|---|---|---|
| `orders` | KDS (order_number, status, table_number, sent_to_kitchen_at), Display (order_number, status), Tablet (own orders via customer_id) | High (totals are non-PII but customer link IS) | `kiosk_can_read` policy + per-column GRANT |
| `order_items` | KDS (name, dispatch_station, kitchen_status, modifiers_summary), Display (name, qty), Tablet (own line items) | Medium | `kiosk_can_read` policy filtered by scope |
| `products` | KDS (name lookup), Tablet (catalog), Display (n/a) | Low | already auth_read — add kiosk branch (no change actually needed since kiosk is `role=authenticated`) |
| `categories` | KDS, Tablet, Display | Low | same as products |
| `restaurant_tables` | KDS (table_number → display), Display | Low | same |
| `customers` | **Tablet only** (own profile lookup) | **Very High** | NO kiosk policy — tablet uses `view_my_tablet_customer` (filtered self-only or denied entirely Phase 0.3 decision) |
| `customer_categories` | Tablet (catalog pricing) | Low | kiosk read OK (no PII) |
| `pos_sessions` | KDS (drawer/cashier display) | Medium | kiosk read OK for status only — no cashier name leak |
| `order_payments` | KDS shouldn't read this | Medium | **NO kiosk policy** |
| `loyalty_transactions` | none for kiosk | High | **NO kiosk policy** |
| `stock_movements` | none for kiosk | Medium | **NO kiosk policy** (display in BO only) |

### 4.2 Policy template

Pattern réutilisable (à appliquer sur chaque table avec accès kiosk) :

```sql
-- pattern: kiosk_can_read scoped by JWT claim
CREATE POLICY "kiosk_can_read"
  ON {table}
  FOR SELECT
  TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kiosk'
    AND (auth.jwt() -> 'app_metadata' ->> 'scope') IN ('kds', 'display', 'tablet')
    -- Optional table-specific scope filter:
    -- AND (auth.jwt() -> 'app_metadata' ->> 'scope') = ANY(ARRAY['kds', 'display'])
  );
```

### 4.3 Per-table policy snippets

#### `orders`

```sql
-- 20260517000031_kiosk_rls_orders.sql (Phase 1.B, before 25-001 lands)
DROP POLICY IF EXISTS "auth_read" ON orders;

-- Staff (PIN provider) — see everything they could before
CREATE POLICY "staff_read" ON orders
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'pin'
  );

-- KDS kiosk — only kitchen-relevant orders (open / preparing), no customer_id leak via column GRANT
CREATE POLICY "kiosk_kds_read" ON orders
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kiosk'
    AND (auth.jwt() -> 'app_metadata' ->> 'scope') = 'kds'
    AND status IN ('pending', 'pending_payment', 'preparing', 'sent_to_kitchen', 'ready')
  );

-- Display kiosk — public-facing, broader status set, but stricter columns (cf grant below)
CREATE POLICY "kiosk_display_read" ON orders
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kiosk'
    AND (auth.jwt() -> 'app_metadata' ->> 'scope') = 'display'
    AND status IN ('preparing', 'ready', 'served', 'completed')
    AND created_at > (now() - interval '4 hours')  -- queue ticker scope
  );

-- Tablet kiosk — self-orders only via customer_id derived from a custom claim (lead question Q4)
CREATE POLICY "kiosk_tablet_read" ON orders
  FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kiosk'
    AND (auth.jwt() -> 'app_metadata' ->> 'scope') = 'tablet'
    AND created_via = 'tablet'
    -- Phase 0.3 OPEN QUESTION: how to scope to "my tablet"? See §10 Q4
  );

-- Column GRANT to keep PII off kiosk eyes
REVOKE SELECT ON orders FROM authenticated;
GRANT SELECT (id, order_number, status, table_number, order_type, items_total, total, created_at, sent_to_kitchen_at, ready_at, served_at)
  ON orders TO authenticated;
-- Note: customer_id, customer_phone_snapshot, customer_name_snapshot, notes, refunded_at, voided_by — NOT granted to authenticated.
-- Staff PIN flows go through SECURITY DEFINER RPCs (complete_order_with_payment_v9, etc.) which run as postgres and bypass column grants.
```

#### `order_items`

```sql
-- 20260517000032_kiosk_rls_order_items.sql
DROP POLICY IF EXISTS "auth_read" ON order_items;

CREATE POLICY "staff_read" ON order_items FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'provider') = 'pin');

CREATE POLICY "kiosk_kds_read" ON order_items FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kiosk'
    AND (auth.jwt() -> 'app_metadata' ->> 'scope') = 'kds'
    AND kitchen_status IN ('pending', 'preparing', 'ready')
  );

CREATE POLICY "kiosk_display_read" ON order_items FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kiosk'
    AND (auth.jwt() -> 'app_metadata' ->> 'scope') = 'display'
    AND kitchen_status IN ('preparing', 'ready')
  );

CREATE POLICY "kiosk_tablet_read" ON order_items FOR SELECT TO authenticated
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'provider') = 'kiosk'
    AND (auth.jwt() -> 'app_metadata' ->> 'scope') = 'tablet'
    -- joined-row scope via order_id → orders.created_via='tablet'
  );

-- Column GRANT
REVOKE SELECT ON order_items FROM authenticated;
GRANT SELECT (id, order_id, product_id, product_name, quantity, unit_price, line_total, dispatch_station, kitchen_status, modifiers_summary, sent_to_kitchen_at, served_at)
  ON order_items TO authenticated;
-- Withheld: notes (may contain customer name), staff_id, void_reason, void_by.
```

#### `customers` (tablet-only, restricted)

```sql
-- 20260517000033_kiosk_rls_customers.sql
-- Phase 0.3 decision: kiosk tablet does NOT read `customers` directly.
-- Tablet uses a SECURITY DEFINER RPC `get_my_tablet_customer_v1(p_tablet_token TEXT)`
-- that returns ONLY the active customer matching a tablet-scoped token.
-- No new RLS policy required — customers already locked to `auth_read` PIN providers.
-- Existing `auth_read` policy is tightened in 25-001 to require `provider = 'pin'`:

DROP POLICY IF EXISTS "auth_read" ON customers;
CREATE POLICY "staff_read" ON customers FOR SELECT TO authenticated
  USING ((auth.jwt() -> 'app_metadata' ->> 'provider') = 'pin' AND deleted_at IS NULL);
```

#### Estimated policy count

| Phase 1.B migration | Tables | New policies |
|---|---|---|
| `kiosk_rls_orders.sql` | orders | 4 (staff_read, kiosk_kds_read, kiosk_display_read, kiosk_tablet_read) |
| `kiosk_rls_order_items.sql` | order_items | 4 |
| `kiosk_rls_products.sql` | products, categories | 2 (no-op kiosk extension — products already public-safe) |
| `kiosk_rls_restaurant_tables.sql` | restaurant_tables | 2 (staff + kiosk_kds_display) |
| `kiosk_rls_pos_sessions.sql` | pos_sessions | 2 (staff_read, kiosk_kds_read for cashier name redacted via view) |
| `kiosk_rls_customers.sql` | customers | 1 (staff-only, tighter than today) |
| `kiosk_rls_customer_categories.sql` | customer_categories | 2 (staff + kiosk_tablet) |

**Total : ≈ 7 migrations, ≈ 17 new policies.** Estimated 2-3 h of pgTAP coverage on top of the migration work.

### 4.4 Negative tests required (pgTAP)

```sql
-- supabase/tests/security_kiosk_rls.test.sql
BEGIN;
SELECT plan(12);

-- T1 — Kiosk KDS JWT cannot SELECT customers
SELECT _set_kiosk_jwt('kds', 'kiosk_a');
SELECT is_empty($$ SELECT 1 FROM customers LIMIT 1 $$, 'KDS kiosk denied on customers');

-- T2 — Kiosk display JWT cannot SELECT pos_sessions cashier identity
SELECT _set_kiosk_jwt('display', 'kiosk_b');
SELECT is_empty($$ SELECT opened_by FROM pos_sessions WHERE opened_by IS NOT NULL $$, 'Display kiosk has no opened_by access');

-- T3 — Kiosk tablet JWT cannot read orders not from tablet
SELECT _set_kiosk_jwt('tablet', 'kiosk_c');
SELECT is_empty(
  $$ SELECT 1 FROM orders WHERE created_via != 'tablet' LIMIT 1 $$,
  'Tablet kiosk only sees tablet-created orders'
);

-- T4 — Revoked kiosk JWT — caller cannot use a stale token (enforced at issuance, not RLS — covered by integration test)
-- T5 — Scope mismatch (kds token tries display data) — denied because policy WHERE scope = 'display'
-- ... etc.

SELECT * FROM finish();
ROLLBACK;
```

---

## 5. Rate-limit strategy

Reuse `supabase/functions/_shared/rate-limit.ts` (single instance, LRU bucket, opportunistic stale purge — already in production for `auth-verify-pin`, see `:1-61`). Two budgets:

| Key | Limit | Window | Rationale |
|---|---|---|---|
| `kiosk-jwt:ip:${ip}` | 10 | 60 s | Catches LAN-wide enumeration attempts (10 different `kiosk_id` tries from one workstation in 60 s) |
| `kiosk-jwt:id:${kiosk_id}` | 1 | 60 s | Each kiosk should refresh max once / minute (real cadence is 12h interval — anything more frequent is suspicious) |

Both bucket checks happen before bcrypt verify, so a brute-force of the 60-char `kiosk_secret` is bounded to 60 attempts/h/kiosk_id (1/min) **at most** — at bcrypt strength 12, this is ≈ 6×10^21 years for full enumeration. Acceptable.

The rate-limit helper is single-instance — D9 (CLAUDE.md re: 25-002) notes Phase 1.B will move it to a Postgres-backed `edge_function_rate_limits` table for cross-instance correctness. **This EF inherits that upgrade automatically** if it imports the shared helper.

---

## 6. IP-allowlist

### 6.1 Staging gate (env var)

```bash
# supabase/functions/.env (staging only)
KIOSK_IP_ALLOWLIST_ENABLED=true
```

When `true`, the EF consults a small `kiosk_ip_allowlist` table and returns 403 on miss. Defaults to OFF in dev (Docker) and ON in staging/prod.

### 6.2 Table sketch

```sql
-- Phase 1.B migration 20260517000034_init_kiosk_ip_allowlist.sql
CREATE TABLE kiosk_ip_allowlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cidr        CIDR NOT NULL,                  -- '10.0.0.0/8' or '203.0.113.42/32'
  label       TEXT NOT NULL,                  -- 'Office LAN', 'Lab tablet'
  created_by  UUID REFERENCES user_profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ                    -- optional auto-revoke
);

CREATE INDEX idx_kiosk_ip_allowlist_active ON kiosk_ip_allowlist(cidr)
  WHERE expires_at IS NULL OR expires_at > now();

-- Seed: explicit super-admin only
ALTER TABLE kiosk_ip_allowlist ENABLE ROW LEVEL SECURITY;
CREATE POLICY "super_admin_only" ON kiosk_ip_allowlist FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code IN ('SUPER_ADMIN')));
```

### 6.3 Lookup helper

```typescript
// supabase/functions/_shared/ip-allowlist.ts
import { getAdminClient } from './supabase-admin.ts';

export async function isIpAllowed(ip: string): Promise<boolean> {
  if (Deno.env.get('KIOSK_IP_ALLOWLIST_ENABLED') !== 'true') return true;
  if (ip === 'unknown') return false;
  const admin = getAdminClient();
  const { data } = await admin.rpc('check_kiosk_ip_v1', { p_ip: ip });
  return data === true;
}
```

```sql
-- Helper RPC (security definer)
CREATE OR REPLACE FUNCTION check_kiosk_ip_v1(p_ip INET)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM kiosk_ip_allowlist
    WHERE p_ip <<= cidr
      AND (expires_at IS NULL OR expires_at > now())
  );
$$;
```

### 6.4 Dev bypass

Locally, set `KIOSK_IP_ALLOWLIST_ENABLED=false` in `supabase/functions/.env` (already standard for the Windows-Edge-Runtime workaround flow per `memory/MEMORY.md`).

---

## 7. Revocation : `kiosk_devices` schema

```sql
-- 20260517000030_init_kiosk_devices.sql (Phase 1.B, FIRST migration of the kiosk stream)
CREATE TABLE kiosk_devices (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kiosk_id      TEXT NOT NULL UNIQUE,                          -- e.g. 'kiosk_kds_front_01'
  scope         TEXT NOT NULL CHECK (scope IN ('kds', 'display', 'tablet')),
  secret_hash   TEXT NOT NULL,                                  -- bcrypt cost 12
  device_label  TEXT NOT NULL,
  created_by    UUID NOT NULL REFERENCES user_profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_by    UUID REFERENCES user_profiles(id),
  notes         TEXT
);

CREATE INDEX idx_kiosk_devices_active ON kiosk_devices(kiosk_id) WHERE revoked_at IS NULL;

ALTER TABLE kiosk_devices ENABLE ROW LEVEL SECURITY;

-- Only admins read/list/revoke
CREATE POLICY "admin_read"  ON kiosk_devices FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code IN ('SUPER_ADMIN', 'ADMIN')));
CREATE POLICY "admin_write" ON kiosk_devices FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code IN ('SUPER_ADMIN', 'ADMIN')));

COMMENT ON TABLE kiosk_devices IS
  'Paired kiosk devices for KDS/Display/Tablet. Secret bcrypt-hashed; revoked_at IS NOT NULL = denied at JWT issue.';
```

### 7.1 Helper RPCs

```sql
-- Pair / rotate a kiosk (admin-only callable)
CREATE OR REPLACE FUNCTION pair_kiosk_v1(
  p_scope TEXT,
  p_device_label TEXT,
  p_kiosk_id TEXT DEFAULT NULL  -- if NULL, autogenerate
) RETURNS TABLE(kiosk_id TEXT, kiosk_secret TEXT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_secret TEXT;
  v_hash   TEXT;
  v_id     TEXT;
BEGIN
  -- Caller perm gate
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code IN ('SUPER_ADMIN', 'ADMIN')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_scope NOT IN ('kds', 'display', 'tablet') THEN
    RAISE EXCEPTION 'invalid_scope: %', p_scope;
  END IF;

  v_id := COALESCE(p_kiosk_id, 'kiosk_' || p_scope || '_' || substring(gen_random_uuid()::text, 1, 8));
  -- Cryptographically random secret (32 bytes base64url)
  v_secret := encode(gen_random_bytes(32), 'base64');
  v_secret := translate(v_secret, '+/=', '-_');
  v_hash := crypt(v_secret, gen_salt('bf', 12));

  INSERT INTO kiosk_devices (kiosk_id, scope, secret_hash, device_label, created_by)
  VALUES (v_id, p_scope, v_hash, p_device_label, (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid()));

  -- Return is one-shot — admin sees secret ONCE in the BO UI
  RETURN QUERY SELECT v_id, v_secret;
END $$;

-- Verify a secret on JWT issue
CREATE OR REPLACE FUNCTION verify_kiosk_secret_v1(p_kiosk_id TEXT, p_secret TEXT)
RETURNS TABLE(id UUID, scope TEXT, device_label TEXT, secret_valid BOOLEAN, revoked BOOLEAN)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  r RECORD;
BEGIN
  SELECT k.id, k.scope, k.device_label, k.secret_hash, k.revoked_at
    INTO r FROM kiosk_devices k WHERE k.kiosk_id = p_kiosk_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT NULL::UUID, NULL::TEXT, NULL::TEXT, false, false;
    RETURN;
  END IF;
  RETURN QUERY SELECT r.id, r.scope, r.device_label,
    (r.secret_hash = crypt(p_secret, r.secret_hash)),
    (r.revoked_at IS NOT NULL);
END $$;

-- Revoke (admin)
CREATE OR REPLACE FUNCTION revoke_kiosk_v1(p_kiosk_id TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM user_profiles WHERE auth_user_id = auth.uid() AND role_code IN ('SUPER_ADMIN', 'ADMIN')) THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  UPDATE kiosk_devices SET revoked_at = now(),
    revoked_by = (SELECT id FROM user_profiles WHERE auth_user_id = auth.uid())
    WHERE kiosk_id = p_kiosk_id AND revoked_at IS NULL;
END $$;
```

---

## 8. Implementation order (Phase 1.B placement)

Migration block reserved: `20260517000030..045` (under Phase 1.B Security stream).

| # | Migration | Description | Estimated effort |
|---|---|---|---|
| 1 | `20260517000030_init_kiosk_devices.sql` | Table + RLS + 3 RPCs (pair, verify, revoke) | 1 h |
| 2 | `20260517000031_init_kiosk_ip_allowlist.sql` | Table + helper RPC | 30 min |
| 3 | EF code: `supabase/functions/kiosk-issue-jwt/index.ts` | Plus `_shared/jwt.ts` + `_shared/ip-allowlist.ts` extraction | 2 h |
| 4 | Vitest live RPC: `supabase/tests/functions/kiosk-issue-jwt.test.ts` | 8-10 cases (happy, missing secret, wrong secret, revoked, scope mismatch, rate-limit IP, rate-limit kiosk_id, IP allowlist on/off) | 1.5 h |
| 5 | pgTAP: `supabase/tests/security_kiosk_devices.test.sql` | RLS denies anon, RLS denies non-admin reads, secret never queried via JOIN | 1 h |
| 6 | `20260517000032..035_kiosk_rls_*.sql` | 4-5 migrations: orders, order_items, restaurant_tables, customer_categories, pos_sessions kiosk policies | 2 h |
| 7 | pgTAP: `supabase/tests/security_kiosk_rls.test.sql` | 12-15 negative tests (KDS can't read customers, tablet can't read non-tablet orders, etc.) | 2 h |
| 8 | BO smoke (Phase 1.B or 4): `apps/backoffice/src/features/settings/kiosks/` | Pair / list / revoke UI (Phase 1.B = behind admin flag ; full UI in Phase 5 alongside 19 settings) | 3 h (deferred to Phase 5) |
| 9 | Client wiring: KDS / Display / Tablet boot calls `kiosk-issue-jwt` on mount, persists in `sessionStorage`, refresh on `expires_at - 10 min` | `apps/pos/src/lib/kiosk-auth.ts` + integration | 2 h |

**Phase 1.B sequencing requirement (D18, line 113 of spec)** : kiosk EF + tables + RLS migrations must land **before** 25-001 (anon→authenticated tightening). Without that, the kiosks break the moment 25-001 lands.

**Sequence within Phase 1.B**:

```
25-002 (shared rate-limit helper) — first
  ↓
kiosk-1 (kiosk_devices table + 3 RPCs)
  ↓
kiosk-2 (kiosk-issue-jwt EF + jwt.ts extraction)
  ↓
kiosk-3 (kiosk RLS policies on orders/order_items/...)
  ↓
25-001 (drop legacy anon SELECT — now safe because kiosks have JWT)
  ↓
25-003 (drop client PIN fallback)
  ↓
25-004 (EF error redaction)
```

---

## 9. Test plan

### 9.1 Unit (Vitest live RPC) — `supabase/tests/functions/kiosk-issue-jwt.test.ts`

```typescript
describe('kiosk-issue-jwt', () => {
  let pairedKiosk: { kiosk_id: string; kiosk_secret: string };

  beforeAll(async () => {
    // Pair a kiosk via service role
    pairedKiosk = await callAsAdmin('pair_kiosk_v1', { p_scope: 'kds', p_device_label: 'Test KDS' });
  });

  it('issues a valid JWT on correct kiosk_id + secret', async () => {
    const res = await callEdgeFunction('kiosk-issue-jwt',
      { kiosk_id: pairedKiosk.kiosk_id, scope: 'kds' },
      { 'X-Kiosk-Secret': pairedKiosk.kiosk_secret });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toMatch(/^eyJ/);
    expect(res.body.kiosk.scope).toBe('kds');

    // Decode JWT and assert claims
    const payload = decodeJwt(res.body.access_token);
    expect(payload.role).toBe('authenticated');
    expect(payload.app_metadata.provider).toBe('kiosk');
    expect(payload.app_metadata.scope).toBe('kds');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000) + 23 * 3600);
  });

  it('rejects wrong secret with 401', async () => {
    const res = await callEdgeFunction('kiosk-issue-jwt',
      { kiosk_id: pairedKiosk.kiosk_id, scope: 'kds' },
      { 'X-Kiosk-Secret': 'WRONG' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('kiosk_secret_invalid');
  });

  it('rejects revoked kiosk with 403', async () => {
    await callAsAdmin('revoke_kiosk_v1', { p_kiosk_id: pairedKiosk.kiosk_id });
    const res = await callEdgeFunction('kiosk-issue-jwt',
      { kiosk_id: pairedKiosk.kiosk_id, scope: 'kds' },
      { 'X-Kiosk-Secret': pairedKiosk.kiosk_secret });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('kiosk_revoked');
  });

  it('rejects scope mismatch (kds device asking for tablet)', async () => { /* ... */ });
  it('rejects unknown kiosk_id', async () => { /* ... */ });
  it('rate-limits 10/min/IP', async () => { /* ... */ });
  it('rate-limits 1/min/kiosk_id', async () => { /* ... */ });
  it('respects IP allowlist when enabled', async () => { /* ... */ });
});
```

### 9.2 pgTAP — `supabase/tests/security_kiosk_rls.test.sql`

12-15 tests, all negative (kiosk JWT can NOT read X). Pattern from `inventory_phase1_complete.test.sql`.

### 9.3 BO smoke (Phase 5 — deferred)

The kiosk-pairing admin UI lands later (`/backoffice/settings/kiosks`). Phase 1.B implements **only** the EF + tables + RLS. For Phase 1.B testing we pair via `pair_kiosk_v1` directly through psql / Supabase SQL editor.

---

## 10. Open questions for the lead

1. **Q1 — IP allowlist scope** : staging always-on / prod always-on / prod off ? Recommendation: staging always-on; prod gated by `KIOSK_IP_ALLOWLIST_ENABLED=true` on the prod Supabase project. Off in dev. **Lead approval needed.**

2. **Q2 — Token refresh strategy** : on the client side, who polls `expires_at` and re-calls `kiosk-issue-jwt` ? Recommendation: a single hook `useKioskAuth()` mounted at the kiosk route level (Kds.tsx, CustomerDisplayPage.tsx, Tablet.tsx) that calls re-issue at `expires_at - 10 min`. The kiosk_secret stays in `localStorage`. **Confirm OK.**

3. **Q3 — Storage of `kiosk_secret` on the kiosk** : `localStorage` (persistent) vs. session-only env injection at deployment ? Recommendation: `localStorage` — a kiosk reboots more often than admins want to re-pair. Caveat: if the kiosk is a shared browser (Chrome), the secret is exfiltrable by XSS. Mitigation: CSP `script-src 'self'` (paired with 25-005 CSP work — Phase 1.B).

4. **Q4 — Tablet "own orders" scoping** : how does a tablet kiosk JWT prove which `customer_id` it's serving ? Three options :
   - **a) Tablet kiosk has no customer scoping at all** — RLS lets any tablet JWT read all `created_via='tablet'` orders. Acceptable if every tablet is at a unique table_number and orders are short-lived (< 4h). **Recommended.**
   - **b) Custom claim `tablet_customer_id`** added at issuance — but the kiosk doesn't know its customer until check-in.
   - **c) SECURITY DEFINER RPC `claim_tablet_session_v1(customer_id)`** issued *after* customer scan — RPC returns a session token; tablet stores it; orders RLS joins `tablet_sessions`. More complex, may be Phase 4 work. **Recommend deferring c) to Phase 4 if option a) raises any privacy concerns.**

5. **Q5 — Audit retention for `kiosk.token.issued` events** : every kiosk re-issues every 12 h, that's ~6 events/kiosk/day. 10 kiosks = 60/day × 365 = ~22k rows/year. `audit_logs` already exists — keep there or split into a separate `kiosk_audit` table ? Recommendation: keep in `audit_logs` ; tag with `action = 'kiosk.token.issued'` for easy filtering ; reuse the existing `audit_logs` Phase 1.B retention/archival (covered by 25-006 secret-rotation work).

6. **Q6 — `auth.uid()` returning a non-`auth.users` UUID** : SQL helpers `is_authenticated()` (`auth.uid() IS NOT NULL`) handle this fine, but `has_permission(auth.uid(), ...)` does a join to `user_profiles ON auth_user_id` which will return zero rows for a kiosk UUID — correct behaviour (kiosk has no permissions). **Confirm this is by design** (it is — kiosks are read-only via RLS, never via RPC).

7. **Q7 — Default behavior when `kiosk-issue-jwt` is down** : KDS / Display / Tablet have no fallback. Should we ship a "degraded mode" that lets a staff PIN holder log in and the kiosk inherits the PIN JWT until kiosk-issue-jwt comes back ? Recommendation: **YES** — implement during the client-side wiring step (item 9 of §8). Add a "Sign in with staff PIN (degraded)" button on the kiosk route. Lead approval needed because it complicates the threat model.

8. **Q8 — JWT secret rotation** : when prod rotates `SUPABASE_JWT_SECRET`, existing kiosk tokens become invalid. Recommend documenting this in `25-006_secrets_rotation_runbook.md` (Phase 5) — kiosks re-issue at next 12-h tick anyway, so a 12-h max outage. Acceptable, just needs ops awareness. **Lead to confirm cadence.**

9. **Q9 — Browser-probe detection** : the kiosk routes (`/kds`, `/display`, `/tablet`) should refuse to render if there's no kiosk JWT and no PIN JWT. Recommendation: a route guard that calls `kiosk-issue-jwt` at mount and shows an "Unpaired device — admin must pair this kiosk in Back-Office → Settings → Kiosks" empty state on 401/403. **Implementation tracked in Phase 1.B item 9 of §8.**

---

## 11. Migration cleanup checklist

| Item | Where | When |
|---|---|---|
| `kiosk_devices` table + RLS + 3 RPCs | `20260517000030_init_kiosk_devices.sql` | Phase 1.B |
| `kiosk_ip_allowlist` table + helper RPC | `20260517000031_init_kiosk_ip_allowlist.sql` | Phase 1.B |
| Per-table kiosk RLS policies | `20260517000032..036_kiosk_rls_*.sql` (5 files) | Phase 1.B before 25-001 |
| Column GRANT tightening on `orders`, `order_items` | Bundled with the kiosk RLS migration touching the table | Phase 1.B |
| `pnpm db:types` regen | After each migration batch | Phase 1.B |
| `_shared/jwt.ts` extraction from `auth-verify-pin/index.ts` | Refactor in same PR as the new EF | Phase 1.B |
| `_shared/ip-allowlist.ts` new helper | New file | Phase 1.B |
| `kiosk-issue-jwt` Edge Function | `supabase/functions/kiosk-issue-jwt/index.ts` | Phase 1.B |
| Vitest live RPC for the EF | `supabase/tests/functions/kiosk-issue-jwt.test.ts` | Phase 1.B |
| pgTAP RLS tests | `supabase/tests/security_kiosk_*.test.sql` | Phase 1.B |
| Client wiring (`useKioskAuth` hook + route guard) | `apps/pos/src/lib/kiosk-auth.ts` + KDS / Tablet / Display routes | Phase 1.B (cli) → Phase 4 (Display build-from-scratch) |
| Admin UI for pairing / revoking | `apps/backoffice/src/features/settings/kiosks/` | Phase 5 (alongside 19 settings) |

---

*End of design. Next : `ui-steward-charter.md` for the parallel D9 deliverable.*

---

## Appendix A — K8 Manual Rotation Runbook (Phase 1.B addendum)

> **Status** : Added 2026-05-14 by sec-stream per lead decision K8 (manual rotation only).
> **Scope** : Rotation of `SUPABASE_JWT_SECRET` (which signs BOTH kiosk JWTs and PIN JWTs).
> **Cadence** : every 6 months OR immediately after suspected compromise.
> **Owner** : `guichduh33@gmail.com` (lead) + at least one ADMIN witness.

### A.1 Pre-rotation checklist

1. Verify staging environment is up and matches prod migrations (Phase 0.2 staging Supabase project ref : `ikcyvlovptebroadgtvd` — see `memory/MEMORY.md`).
2. Confirm no Phase 1.B test suite is mid-run on the affected stack.
3. Capture current key_id active row:
   ```sql
   SELECT id, key_id, scope, is_active, rotated_in_at
     FROM kiosk_jwt_signing_keys
    WHERE is_active = TRUE;
   ```
4. Notify all kiosk operators (KDS, display, tablet stations) of the maintenance window — they will need to re-auth at the next 12-h tick (kiosk JWTs auto-refresh via `useKioskAuth` hooks).

### A.2 Rotation steps

1. **Generate a new secret** (must be ≥ 32 random bytes, base64url-encoded). Use the Supabase project dashboard or `openssl rand -base64 48`.
2. **Update Supabase Vault** : Project → Settings → API → "JWT Secret" → paste new secret. Wait for the rolling restart of Realtime + PostgREST.
3. **Update local `.env` files** for staging/dev workstations (`supabase/functions/.env` with `JWT_SECRET=<new>` and `SUPABASE_JWT_SECRET=<new>`).
4. **Insert audit row** in `kiosk_jwt_signing_keys` with a new `key_id` and `is_active=TRUE`; the unique partial index will fail if the previous row isn't first deactivated:
   ```sql
   BEGIN;
   UPDATE kiosk_jwt_signing_keys
      SET is_active = FALSE, rotated_out_at = now()
    WHERE is_active = TRUE AND scope = 'any';

   INSERT INTO kiosk_jwt_signing_keys (key_id, scope, is_active, notes)
   VALUES ('kiosk-rotated-2026-11', 'any', TRUE, 'Rotated 2026-11-15 by guichduh33 (K8 manual cadence)');
   COMMIT;
   ```
5. **Invalidate active sessions** — all PIN JWTs become unverifiable at rotation. Each cashier re-PINs at next route navigation (the auth store's `validateSession()` 401s, triggering logout). Kiosk JWTs auto-refresh in ≤ 12h via the `useKioskAuth` refresh tick.
6. **Verify** : run `pnpm --filter @breakery/supabase test kiosk-issue-jwt` against the rotated stack — every test must pass.

### A.3 Rollback

If rotation breaks auth in unexpected ways :

1. **Revert the Supabase Vault JWT Secret** to the previous value (keep the previous secret in a sealed envelope for the maintenance window).
2. **Revert the `kiosk_jwt_signing_keys` rows** :
   ```sql
   UPDATE kiosk_jwt_signing_keys SET is_active = FALSE, rotated_out_at = now() WHERE key_id = 'kiosk-rotated-2026-11';
   UPDATE kiosk_jwt_signing_keys SET is_active = TRUE,  rotated_out_at = NULL WHERE key_id = 'kiosk-default-2026-05';
   ```
3. Notify operators and re-schedule rotation.

### A.4 Cadence + ownership matrix

| Event | Frequency | Owner | Witness |
|---|---|---|---|
| Routine rotation | Every 6 months | Lead (`guichduh33`) | One ADMIN |
| Post-compromise rotation | Immediate (within 4h) | Lead | Two ADMINs |
| Rotation audit log review | Quarterly | Lead | RBAC ADMIN |

### A.5 Out-of-scope (deferred to Phase 5+)

- Automated rotation (cron + Vault webhook integration) — Phase 5+.
- Multi-region key sync — Phase 7 (multi-tenancy work).
- Hardware Security Module (HSM) backing for the JWT secret — Phase 7.

