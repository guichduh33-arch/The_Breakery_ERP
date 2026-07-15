# S55 — P1.5 (T7) Durcissement EF restant : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer l'audit T7/P1.5 — idempotency sur void-order/cancel-item et sortie du PIN discount des args SQL de la money-path (v15 → v16 + nonce single-use).

**Architecture:** Deux chantiers indépendants. (A) réplique le précédent `refund-order` : header `x-idempotency-key` → `p_idempotency_key`, replay stocké sur la ligne métier (`refunds.idempotency_key` pour void, nouvelle colonne `order_items.cancel_idempotency_key` pour cancel). (B) déplace la vérification du PIN discount dans l'EF `process-payment` (helpers `_shared/manager-pin.ts`, parité reversals) et remplace `p_manager_pin` par un nonce single-use `discount_authorizations` consommé par `complete_order_with_payment_v16`.

**Tech Stack:** Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`) via MCP (apply_migration / execute_sql / deploy_edge_function / generate_typescript_types), Deno EFs, pgTAP via execute_sql BEGIN/ROLLBACK, Vitest/React-Query POS.

**Spec:** `docs/superpowers/specs/2026-07-02-ef-hardening-p15-design.md`

## Global Constraints

- DB = cloud V3 dev **`ikcyvlovptebroadgtvd`** uniquement ; JAMAIS `supabase start` / `db reset` / `run_pgtap.sh` (Docker retiré). Migrations via MCP `apply_migration`, pgTAP via `execute_sql` (envelope `BEGIN … ROLLBACK`, capture des assertions en temp table — cf. memory `workflow_pgtap_via_mcp_capture`).
- **Les subagents ne peuvent PAS appeler les MCP Supabase** : ils écrivent les fichiers SQL/pgTAP ; le contrôleur applique/exécute/regen/déploie.
- RPC versioning monotone : nouvelle signature = `_vN+1` + `DROP FUNCTION _vN(<args exacts>)` dans la même migration.
- Grants canoniques reversals : `REVOKE … FROM PUBLIC; REVOKE … FROM anon;` + `GRANT EXECUTE … TO service_role` (EF-only). ⚠️ v16 : **`GRANT EXECUTE TO authenticated` OBLIGATOIRE** (l'EF appelle avec le JWT utilisateur — sans ce grant, toute la money-path casse en `permission denied`).
- PIN en header HTTP uniquement (`x-manager-pin`), jamais en body ni en arg du statement money-path.
- Numérotation migrations : NAME-block suivant = `20260710000082` (vérifié : max actuel `_081`).
- Après CHAQUE migration : regen types → `packages/supabase/src/types.generated.ts` (commit).
- Fichiers < 500 lignes ; conventional commits co-authored Claude.

---

### Task 0: Attestation des 2 items déjà couverts (contrôleur seul, pas de subagent)

**Files:** aucun (lecture seule + éventuel redeploy)

- [ ] **Step 0.1:** MCP `get_edge_function(project_id='ikcyvlovptebroadgtvd', slug='auth-change-pin')` — vérifier que le code **déployé** contient `checkRateLimitDurable({functionName: 'auth-change-pin'…})`.
- [ ] **Step 0.2:** idem `slug='notification-dispatch'` — vérifier `x-dispatch-secret` (header) et absence de lecture `?secret=`.
- [ ] **Step 0.3:** si l'un des deux est en retard sur le repo → `deploy_edge_function` du source repo. Consigner le constat (versions live) dans l'INDEX de session.

---

### Task 1: Migration `_082` — `void_order_rpc_v4` (idempotency)

**Files:**
- Create: `supabase/migrations/20260710000082_void_order_rpc_v4_idempotency.sql`
- Test: `supabase/tests/reversal_idempotency.test.sql` (nouveau, section void)

**Interfaces:**
- Consumes: corps v3 = source **`supabase/migrations/20260705000018_bump_reversals_modifier_ingredients.sql`** (lignes 11-119). `refunds.idempotency_key UUID` + index unique partiel `refunds_idempotency_key_uidx` existent déjà (`20260517000014`).
- Produces: `public.void_order_rpc_v4(p_order_id uuid, p_reason text, p_authorized_by uuid, p_acting_auth_user_id uuid, p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb` — enveloppe identique à v3 + clé `idempotent_replay` (true sur replay, absente/false sinon). Task 3 (EF) et Task 6 (pgTAP) en dépendent.

- [ ] **Step 1.1: Écrire la migration.** Copier le `CREATE FUNCTION public.void_order_rpc_v3(…)` de `_018` en `void_order_rpc_v4`, puis appliquer EXACTEMENT ces hunks :

En-tête (remplace le DROP v2 de `_018`) :
```sql
-- 20260710000082_void_order_rpc_v4_idempotency.sql
-- S55 P1.5 (audit T7) : idempotency EF-retry-safety (flavor 1 S25) sur le void.
-- Réplique le précédent refund_order_rpc_v2 (20260517000014) : lookup
-- refunds.idempotency_key en tête, INSERT avec la clé, catch unique_violation.
DROP FUNCTION IF EXISTS public.void_order_rpc_v3(uuid, text, uuid, uuid);

CREATE FUNCTION public.void_order_rpc_v4(
  p_order_id uuid, p_reason text, p_authorized_by uuid,
  p_acting_auth_user_id uuid, p_idempotency_key uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
```
DECLARE : ajouter `v_existing RECORD;`.

Juste APRÈS le check `v_profile_id IS NULL` (avant le check `p_authorized_by`) :
```sql
  -- v4 idempotency replay : même clé → renvoyer l'enveloppe du premier void.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded
      INTO v_existing
      FROM refunds r
      WHERE r.idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_id', v_existing.order_id,
        'order_number', (SELECT order_number FROM orders WHERE id = v_existing.order_id),
        'refund_id', v_existing.id, 'refund_number', v_existing.refund_number,
        'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded,
        'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                      FROM refund_payments WHERE refund_id = v_existing.id),
        'idempotent_replay', true);
    END IF;
  END IF;
```
L'INSERT `refunds` (ligne 99-101 de `_018`) gagne la colonne :
```sql
  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded, reason, refunded_by, authorized_by, is_full_void, idempotency_key)
  VALUES (v_refund_number, p_order_id, v_open_session, v_order.total, v_order.tax_amount, p_reason, v_profile_id, p_authorized_by, true, p_idempotency_key)
  RETURNING id INTO v_refund_id;
```
Race concurrente : encapsuler cet INSERT (et lui seul) :
```sql
  BEGIN
    INSERT INTO refunds (…) VALUES (…) RETURNING id INTO v_refund_id;
  EXCEPTION WHEN unique_violation THEN
    -- Un void concurrent avec la même clé a gagné : rejouer le lookup et sortir.
    SELECT r.id, r.refund_number, r.order_id, r.total, r.tax_refunded INTO v_existing
      FROM refunds r WHERE r.idempotency_key = p_idempotency_key;
    RETURN jsonb_build_object(
      'order_id', v_existing.order_id,
      'order_number', (SELECT order_number FROM orders WHERE id = v_existing.order_id),
      'refund_id', v_existing.id, 'refund_number', v_existing.refund_number,
      'total_refunded', v_existing.total, 'tax_refunded', v_existing.tax_refunded,
      'tenders', (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                    FROM refund_payments WHERE refund_id = v_existing.id),
      'idempotent_replay', true);
  END;
```
Fin de migration (grants canoniques, signature 5 args) :
```sql
REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.void_order_rpc_v4(uuid, text, uuid, uuid, uuid) TO service_role;
```
Le reste du corps v3 (restore stock/display/modifiers, loyalty, refund_lines, refund_payments, audit, RETURN final) est copié tel quel — le RETURN final nominal reste sans `idempotent_replay`.

- [ ] **Step 1.2 (contrôleur):** appliquer via MCP `apply_migration(name='void_order_rpc_v4_idempotency', …)`.
- [ ] **Step 1.3:** Écrire la section void de `supabase/tests/reversal_idempotency.test.sql` (pattern temp-table capture) : seed order paid + session ouverte (attention FK `created_by`→`user_profiles`, cf. memory pgTAP), appel 1 v4 avec clé K → succès ; compter `stock_movements sale_void` ; appel 2 v4 même clé K → `idempotent_replay=true`, même `refund_id`, count `sale_void` inchangé, `refunds` count = 1.
- [ ] **Step 1.4 (contrôleur):** exécuter la suite via `execute_sql` (BEGIN…ROLLBACK). Attendu : 0 `not ok`.
- [ ] **Step 1.5: Commit** `feat(pos): void_order_rpc_v4 — idempotency replay via refunds.idempotency_key (S55 T7)`

---

### Task 2: Migration `_083` — `cancel_order_item_rpc_v3` (idempotency)

**Files:**
- Create: `supabase/migrations/20260710000083_cancel_order_item_rpc_v3_idempotency.sql`
- Test: `supabase/tests/reversal_idempotency.test.sql` (section cancel, même fichier que Task 1)

**Interfaces:**
- Consumes: corps v2 = source **`supabase/migrations/20260619000030_create_reversal_rpcs_acting_user.sql`** (lignes 210-330).
- Produces: `public.cancel_order_item_rpc_v3(p_order_item_id uuid, p_reason text, p_authorized_by uuid, p_acting_auth_user_id uuid, p_idempotency_key uuid DEFAULT NULL) RETURNS jsonb` + colonne `order_items.cancel_idempotency_key uuid`. Enveloppe v2 + `idempotent_replay` sur replay.

- [ ] **Step 2.1: Écrire la migration.** D'abord la colonne + index :
```sql
-- S55 P1.5 (audit T7) : idempotency EF-retry-safety sur le cancel-item.
-- La clé vit sur la ligne métier mutée (précédent refunds.idempotency_key).
ALTER TABLE order_items ADD COLUMN IF NOT EXISTS cancel_idempotency_key UUID;
CREATE UNIQUE INDEX IF NOT EXISTS order_items_cancel_idempotency_key_uidx
  ON order_items(cancel_idempotency_key) WHERE cancel_idempotency_key IS NOT NULL;

DROP FUNCTION IF EXISTS public.cancel_order_item_rpc_v2(uuid, text, uuid, uuid);
```
Puis copier le corps v2 en `cancel_order_item_rpc_v3(…, p_idempotency_key uuid DEFAULT NULL)`, avec ces hunks :

Juste APRÈS le check `v_profile_id IS NULL` :
```sql
  -- v3 idempotency replay : même clé → renvoyer l'enveloppe du premier cancel.
  IF p_idempotency_key IS NOT NULL THEN
    SELECT oi.id AS order_item_id, oi.order_id, o.order_number, oi.name_snapshot,
           oi.dispatch_station, o.subtotal, o.tax_amount, o.total
      INTO v_replay
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE oi.cancel_idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'order_item_id', v_replay.order_item_id, 'order_id', v_replay.order_id,
        'order_number', v_replay.order_number, 'item_name', v_replay.name_snapshot,
        'dispatch_station', v_replay.dispatch_station,
        'new_subtotal', v_replay.subtotal, 'new_tax_amount', v_replay.tax_amount,
        'new_total', v_replay.total, 'idempotent_replay', true);
    END IF;
  END IF;
```
(DECLARE : ajouter `v_replay RECORD;`.)

L'UPDATE `order_items` (marquage cancel) gagne la clé :
```sql
  UPDATE order_items SET
    is_cancelled           = true,
    cancelled_at           = now(),
    cancelled_reason       = p_reason,
    cancelled_by           = p_authorized_by,
    cancel_idempotency_key = p_idempotency_key
  WHERE id = p_order_item_id;
```
Note : pas de bloc `unique_violation` nécessaire — la ligne cible est verrouillée
`FOR UPDATE OF oi` avant l'UPDATE, et le check `v_is_cancelled` protège la course
(le perdant relit `is_cancelled=true` → si sa clé matche, le replay du haut a déjà
répondu ; sinon `Item already cancelled` reste correct).

Fin de migration : mêmes 3 lignes de grants que Task 1, signature `(uuid, text, uuid, uuid, uuid)`, fonction `cancel_order_item_rpc_v3`.

- [ ] **Step 2.2 (contrôleur):** `apply_migration(name='cancel_order_item_rpc_v3_idempotency', …)`.
- [ ] **Step 2.3:** Compléter `reversal_idempotency.test.sql` : seed order draft + item fired ; appel 1 v3 clé K → succès `is_cancelled=true` ; appel 2 même clé K → `idempotent_replay=true` (PAS d'erreur « already cancelled »), totals identiques ; appel 3 clé K2 ≠ K → SQLSTATE `23514` (`Item already cancelled`).
- [ ] **Step 2.4 (contrôleur):** exécuter la suite complète (void + cancel). Attendu : 0 `not ok`.
- [ ] **Step 2.5: Commit** `feat(pos): cancel_order_item_rpc_v3 — idempotency replay via order_items.cancel_idempotency_key (S55 T7)`

---

### Task 3: EFs `void-order` / `cancel-item` — lire `x-idempotency-key`

**Files:**
- Modify: `supabase/functions/void-order/index.ts`
- Modify: `supabase/functions/cancel-item/index.ts`

**Interfaces:**
- Consumes: `getIdempotencyKey` de `../_shared/idempotency.ts` (existant) ; RPCs v4/v3 des Tasks 1-2.
- Produces: les 2 EFs relaient `p_idempotency_key` (nullable). Erreur clé malformée → 400 `{error:'invalid_idempotency_key'}` (parité refund-order).

- [ ] **Step 3.1:** Dans chaque EF, ajouter l'import et la lecture (placer après le parse du body, avant l'appel RPC) — copier le pattern exact de `supabase/functions/refund-order/index.ts` :
```ts
import { getIdempotencyKey, InvalidIdempotencyKeyError } from '../_shared/idempotency.ts';
// …
let idempotencyKey: string | null = null;
try {
  idempotencyKey = getIdempotencyKey(req);
} catch (e) {
  if (e instanceof InvalidIdempotencyKeyError) {
    return jsonResponse({ error: 'invalid_idempotency_key' }, 400);
  }
  throw e;
}
```
- [ ] **Step 3.2:** Bump des appels RPC : `void_order_rpc_v3` → `void_order_rpc_v4` avec `p_idempotency_key: idempotencyKey` ; `cancel_order_item_rpc_v2` → `cancel_order_item_rpc_v3` idem. Mettre à jour les commentaires d'en-tête (mention S55 + header `x-idempotency-key: UUID v4 — optionnel`).
- [ ] **Step 3.3 (contrôleur):** `deploy_edge_function` pour `void-order` et `cancel-item`.
- [ ] **Step 3.4 (contrôleur):** vérification live : appeler void-order avec `x-idempotency-key: not-a-uuid` → 400 `invalid_idempotency_key` (via curl/fetch de test, sans PIN valide nécessaire — la clé est validée avant le RPC ; sinon vérifier par lecture du code déployé `get_edge_function`).
- [ ] **Step 3.5: Commit** `feat(pos): void-order/cancel-item EFs read x-idempotency-key → RPC v4/v3 (S55 T7)`

---

### Task 4: POS — clés d'idempotence per-modal (void + cancel)

**Files:**
- Modify: `apps/pos/src/features/order-history/hooks/useVoidOrder.ts`
- Modify: `apps/pos/src/features/cart/hooks/useCancelOrderItem.ts`
- Modify: `apps/pos/src/features/cart/hooks/useVoidServerOrder.ts`
- Modify: `apps/pos/src/features/order-history/OrderHistoryPanel.tsx` (call-site void)
- Modify: `apps/pos/src/features/cart/BottomActionBar.tsx` (call-site void serveur)
- Modify: `apps/pos/src/features/cart/ActiveOrderPanel.tsx` + `apps/pos/src/features/cart/CancelItemModal.tsx` (call-site cancel)
- Test: `apps/pos/src/features/order-history/__tests__/void-idempotency-header.smoke.test.tsx` (nouveau)

**Interfaces:**
- Consumes: hooks existants ; pattern de référence **`RefundOrderModal.tsx:51`** (`const idempotencyKeyRef = useRef<string>(crypto.randomUUID());`) **et `:126`** (rotation `idempotencyKeyRef.current = crypto.randomUUID()` à la fermeture) + smoke miroir `refund-modal-pin-header.smoke.test.tsx`.
- Produces: `useVoidOrder` accepte `idempotencyKey?: string` dans `VoidArgs` ; `useCancelOrderItem` accepte `idempotencyKey?: string` dans `CancelItemArgs` ; `useVoidServerOrder` signature `(managerPin: string, idempotencyKey?: string)`.

- [ ] **Step 4.1:** Hooks — ajouter l'arg + le header conditionnel (copie exacte du pattern `useRefundOrder.ts:38-43`) :
```ts
const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  Authorization: `Bearer ${accessToken}`,
  'x-manager-pin': managerPin,
};
if (idempotencyKey) headers['x-idempotency-key'] = idempotencyKey;
```
- [ ] **Step 4.2:** Call-sites — dans chaque composant qui collecte le PIN (modal void de `OrderHistoryPanel`, confirm void de `BottomActionBar`, `CancelItemModal`), ajouter un `useRef(crypto.randomUUID())` par modal, passé à la mutation, **roté à la fermeture du modal** (pas à chaque render, pas dans `mutationFn`). Règle : 1 ouverture de modal = 1 clé ; retry du même échec = même clé ; nouveau modal = nouvelle clé.
- [ ] **Step 4.3:** Écrire le smoke test (miroir de `refund-modal-pin-header.smoke.test.tsx` C1/C2) : (a) le fetch void porte `x-manager-pin` + `x-idempotency-key` UUID, body sans PIN ; (b) la clé reste identique entre un échec et son retry dans le même modal, et change après close/reopen.
- [ ] **Step 4.4:** Run : `pnpm --filter @breakery/pos test void-idempotency` → PASS ; puis `pnpm --filter @breakery/pos test void` + `test cancel` (suites existantes non cassées).
- [ ] **Step 4.5: Commit** `feat(pos): stable per-modal x-idempotency-key on void/cancel flows (S55 T7)`

---

### Task 5: Migration `_084` — table `discount_authorizations`

**Files:**
- Create: `supabase/migrations/20260710000084_create_discount_authorizations.sql`

**Interfaces:**
- Produces: table `public.discount_authorizations` — service-role/DEFINER only. Consommée par v16 (Task 6), alimentée par l'EF (Task 7).

- [ ] **Step 5.1: Écrire la migration :**
```sql
-- 20260710000084_create_discount_authorizations.sql
-- S55 P1.5 (audit T7) : nonce single-use adossé à la vérification EF du PIN
-- discount. Le nonce ne sort jamais du serveur : process-payment le mint
-- (service_role) et appelle complete_order_with_payment_v16 dans la même
-- requête → TTL court. v16 (SECURITY DEFINER) le consomme atomiquement.
CREATE TABLE public.discount_authorizations (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_profile_id UUID NOT NULL REFERENCES user_profiles(id),
  scope              TEXT NOT NULL DEFAULT 'discount' CHECK (scope = 'discount'),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at         TIMESTAMPTZ NOT NULL DEFAULT now() + interval '60 seconds',
  consumed_at        TIMESTAMPTZ,
  consumed_order_id  UUID
);
COMMENT ON TABLE public.discount_authorizations IS
  'S55 T7 — single-use discount-PIN authorization nonces minted by the process-payment EF (service_role) and consumed by complete_order_with_payment_v16. Never client-visible.';
ALTER TABLE public.discount_authorizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.discount_authorizations FROM PUBLIC;
REVOKE ALL ON public.discount_authorizations FROM anon;
REVOKE ALL ON public.discount_authorizations FROM authenticated;
GRANT ALL ON public.discount_authorizations TO service_role;
```
(RLS activée sans policy = deny par défaut hors service_role/owner — défense en profondeur.)
- [ ] **Step 5.2 (contrôleur):** `apply_migration(name='create_discount_authorizations', …)`.
- [ ] **Step 5.3: Commit** `feat(pos): discount_authorizations nonce table (S55 T7)`

---

### Task 6: Migration `_085` — `complete_order_with_payment_v16` + sweep des ancres

**Files:**
- Create: `supabase/migrations/20260710000085_complete_order_v16_discount_auth_nonce.sql`
- Modify: toute suite sous `supabase/tests/` qui nomme `complete_order_with_payment_v15` (sweep grep) → `_v16`
- Test: `supabase/tests/discount_auth_nonce.test.sql` (nouveau)

**Interfaces:**
- Consumes: corps v15 = source **`supabase/migrations/20260710000074_complete_order_v15_use_sale_helper.sql`** (source live intégrale) ; table Task 5.
- Produces: `public.complete_order_with_payment_v16(p_session_id uuid, p_order_type order_type, p_items jsonb, p_payment jsonb DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL, p_customer_id uuid DEFAULT NULL, p_loyalty_points_redeemed integer DEFAULT 0, p_table_number text DEFAULT NULL, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT NULL, p_discount_value numeric DEFAULT NULL, p_discount_reason text DEFAULT NULL, p_discount_authorized_by uuid DEFAULT NULL, p_promotions jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT NULL, p_discount_auth_id uuid DEFAULT NULL) RETURNS jsonb` — enveloppe inchangée vs v15.

- [ ] **Step 6.1: Écrire la migration.** Copier intégralement le corps v15 de `_074` en `complete_order_with_payment_v16` avec EXACTEMENT ces hunks :

Signature : remplacer la dernière ligne d'args `p_manager_pin text DEFAULT NULL::text` par `p_discount_auth_id uuid DEFAULT NULL::uuid`.

Bloc gate discount (`_074` lignes 330-347) — les gardes authorizer/`has_permission` restent, SEUL le check PIN (l.344-346) est remplacé :
```sql
    -- S55 T7 : le PIN n'entre plus dans ce statement. L'EF process-payment l'a
    -- vérifié (helpers manager-pin, bucket SEC-07) et a minté un nonce
    -- single-use service-role-only. Consommation atomique : un nonce ne sert
    -- qu'une fois, expire à 60 s, et doit désigner le même manager.
    UPDATE discount_authorizations
       SET consumed_at = now()
     WHERE id = p_discount_auth_id
       AND consumed_at IS NULL
       AND expires_at > now()
       AND scope = 'discount'
       AND manager_profile_id = p_discount_authorized_by;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Invalid manager PIN for discount authorization'
        USING ERRCODE = 'P0003';
    END IF;
```
(Le message d'erreur reste MOT POUR MOT celui de v15 — le POS/EF mappent dessus. `p_discount_auth_id IS NULL` tombe naturellement dans le NOT FOUND.)

Après le `INSERT INTO orders … RETURNING id INTO v_order_id;` (l.546), tracer la consommation :
```sql
  IF v_has_discount AND p_discount_auth_id IS NOT NULL THEN
    UPDATE discount_authorizations SET consumed_order_id = v_order_id WHERE id = p_discount_auth_id;
  END IF;
```
Metadata audit du discount (l.557) : `'rpc_version', 'v16'`.

Fin de migration :
```sql
DROP FUNCTION IF EXISTS public.complete_order_with_payment_v15(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, text);

REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v16(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.complete_order_with_payment_v16(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) FROM anon;
-- ⚠️ CAVEAT S51 : l'EF appelle avec le JWT utilisateur. Sans ce grant, toute la
-- money-path casse en `permission denied`.
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v16(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v16(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid) TO service_role;
```
- [ ] **Step 6.2 (contrôleur):** `apply_migration(name='complete_order_v16_discount_auth_nonce', …)`.
- [ ] **Step 6.3: Sweep des ancres.** `grep -r complete_order_with_payment_v15 supabase/tests/` → renommer chaque appel en `_v16` (aucune de ces suites ne passait `p_manager_pin` — renommage sec ; si une suite le passait, la convertir au nonce : INSERT direct dans `discount_authorizations` en seed).
- [ ] **Step 6.4:** Écrire `supabase/tests/discount_auth_nonce.test.sql` (temp-table capture) :
  - T1 : commande AVEC discount, `p_discount_auth_id NULL` → SQLSTATE P0003.
  - T2 : nonce valide seedé (manager avec `sales.discount`) → commande créée, `consumed_at NOT NULL`, `consumed_order_id = order_id`.
  - T3 : rejouer le même nonce → P0003.
  - T4 : nonce `expires_at < now()` → P0003.
  - T5 : nonce d'un autre manager que `p_discount_authorized_by` → P0003.
  - T6 : commande SANS discount, sans nonce → succès (sanity : chemin nominal intact).
- [ ] **Step 6.5 (contrôleur):** exécuter `discount_auth_nonce` + re-passer les ancres repointées (`sale_flag_aware`, `combo_sale`, `s44_display_symmetry`, `combo_fire_pay`, `modifier_ingredient_deduction`, `sale_stock_unification`) → 0 `not ok`.
- [ ] **Step 6.6: Commit** `feat(pos): complete_order_with_payment_v16 — discount auth nonce, PIN out of SQL args (S55 T7)`

---

### Task 7: EF `process-payment` — vérification PIN en amont + nonce → v16

**Files:**
- Modify: `supabase/functions/process-payment/index.ts`

**Interfaces:**
- Consumes: `verifyManagerPin`, `isManagerPinBlocked`, `recordManagerPinFailure`, `MANAGER_PIN_FAIL_WINDOW_SEC` (`../_shared/manager-pin.ts`) ; `checkPermissionForRole` (`../_shared/permissions.ts`) ; `getAdminClient` (`../_shared/supabase-admin.ts`) ; table Task 5 ; RPC v16 Task 6.
- Produces: contrat HTTP INCHANGÉ pour le POS (mêmes headers, mêmes codes d'erreur : `permission_denied` 403, `discount_requires_authorizer` 409 via P0001, 429 rate-limited). `p_discount_authorized_by` désormais dérivé serveur.

- [ ] **Step 7.1:** Ajouter les imports (`manager-pin.ts`, `permissions.ts`, `supabase-admin.ts`) et, à la place du simple `const managerPin = req.headers.get('x-manager-pin');` (l.199), le bloc de vérification AVANT l'appel RPC :
```ts
  // S55 T7 — le PIN discount est vérifié ICI (parité void/cancel/refund) et ne
  // descend plus jamais dans un arg SQL de la money-path. Un nonce single-use
  // (discount_authorizations, service-role only) transporte l'autorisation
  // jusqu'à complete_order_with_payment_v16, qui le consomme atomiquement.
  const managerPin = req.headers.get('x-manager-pin');
  const hasDiscount = (typeof body.discount_amount === 'number' && body.discount_amount > 0)
    || body.items.some((i) => typeof (i as { discount_amount?: number }).discount_amount === 'number'
        && ((i as { discount_amount?: number }).discount_amount ?? 0) > 0);

  let discountAuthId: string | null = null;
  let discountAuthorizedBy: string | null = null;
  if (hasDiscount) {
    if (!managerPin || managerPin.trim().length === 0) {
      return jsonResponse({ error: 'permission_denied', message: 'Discount requires the manager PIN (x-manager-pin header)' }, 403);
    }
    if (await isManagerPinBlocked(ip)) {
      return rateLimitedResponse(MANAGER_PIN_FAIL_WINDOW_SEC);
    }
    const mgr = await verifyManagerPin(managerPin);
    if (!mgr.ok) {
      if (mgr.reason === 'invalid_pin_format') return jsonResponse({ error: 'invalid_pin_format' }, 400);
      if (mgr.reason === 'no_match') {
        const { blocked, retryAfterSec } = await recordManagerPinFailure(ip, 'process-payment');
        if (blocked) return rateLimitedResponse(retryAfterSec);
        return jsonResponse({ error: 'permission_denied', message: 'Invalid manager PIN for discount authorization' }, 403);
      }
      return jsonResponse({ error: 'internal' }, 500);
    }
    const allowed = await checkPermissionForRole(mgr.role_code, 'sales.discount', mgr.manager_profile_id);
    if (!allowed) {
      return jsonResponse({ error: 'permission_denied', message: 'Permission denied: sales.discount (authorizer)' }, 403);
    }
    // L'autorisation est DÉRIVÉE du PIN vérifié — le body client n'est plus cru.
    discountAuthorizedBy = mgr.manager_profile_id;
    const admin = getAdminClient();
    const { data: nonce, error: nonceErr } = await admin
      .from('discount_authorizations')
      .insert({ manager_profile_id: mgr.manager_profile_id })
      .select('id')
      .single();
    if (nonceErr || !nonce) {
      console.error('[process-payment] discount nonce mint failed', nonceErr);
      return jsonResponse({ error: 'internal' }, 500);
    }
    discountAuthId = nonce.id;
  }
```
- [ ] **Step 7.2:** L'appel RPC devient `complete_order_with_payment_v16` ; remplacer les deux spreads finaux :
```ts
    ...(discountAuthorizedBy
      ? { p_discount_authorized_by: discountAuthorizedBy }
      : (body.discount_authorized_by ? { p_discount_authorized_by: body.discount_authorized_by } : {})),
    ...(discountAuthId ? { p_discount_auth_id: discountAuthId } : {}),
```
(plus AUCUN `p_manager_pin`). Le fallback `body.discount_authorized_by` ne sert que le cas sans-discount/champ-orphelin — inoffensif, v16 ne le lit que si `v_has_discount`.
- [ ] **Step 7.3:** Supprimer le bloc S38 `record_pin_failure_v1` (l.229-249) — sans objet, la vérification n'est plus dans le RPC (le remplaçant per-IP est `recordManagerPinFailure` au Step 7.1). Garder TOUT le mapping d'erreurs P0001/P0002/P0003/P0004/P0010/23514 (v16 émet les mêmes ; P0003 'Invalid manager PIN…' vient maintenant du nonce NOT FOUND — cas appel direct PostgREST forgé ou course d'expiration). Mettre à jour le commentaire d'en-tête (S55).
- [ ] **Step 7.4 (contrôleur):** `deploy_edge_function('process-payment')`.
- [ ] **Step 7.5 (contrôleur):** Smoke live : un encaissement SANS discount via l'EF (payload minimal seedé) → 200 ; vérifier qu'un appel v16 direct avec discount + `p_discount_auth_id` forgé (UUID aléatoire) → P0003.
- [ ] **Step 7.6: Commit** `feat(pos): process-payment verifies discount PIN in-EF + mints nonce → v16 (S55 T7)`

---

### Task 8: Types + gates transverses

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (regen)

- [ ] **Step 8.1 (contrôleur):** `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`.
- [ ] **Step 8.2:** `grep -rn "complete_order_with_payment_v15\|void_order_rpc_v3\|cancel_order_item_rpc_v2" apps packages supabase/functions` → 0 résultat hors migrations/docs historiques.
- [ ] **Step 8.3:** `pnpm typecheck` → 0 erreur. `pnpm build` → succès.
- [ ] **Step 8.4:** Suites ciblées : `pnpm --filter @breakery/pos test` (smokes void/cancel/refund/payment) ; `pnpm --filter @breakery/domain test payment` (retryClassifier inchangé). Baseline env-gated ≠ régression (cf. test-engineer).
- [ ] **Step 8.5: Commit** `chore(types): regen after S55 migrations _082.._085`

---

### Task 9: Closeout

**Files:**
- Create: `docs/workplan/plans/2026-07-02-session-55-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan)

- [ ] **Step 9.1:** Écrire l'INDEX S55 : périmètre, constat T0 (2 items déjà couverts + attestation live), migrations `_082.._085`, bumps v4/v3/v16, suites pgTAP, déviations numérotées éventuelles (DEV-S55-xx).
- [ ] **Step 9.2:** CLAUDE.md : P1.5 passe en « Merged (latest) » ; retirer la ligne « In flight » P1.5 ; mettre à jour la liste des RPCs courants (`void_order_rpc_v4`, `cancel_order_item_rpc_v3`, `complete_order_with_payment_v16` + caveat GRANT authenticated reporté sur v16) ; UI déférées DEV-S54-01/DEV-S52-03 restent listées.
- [ ] **Step 9.3:** PR `swarm/session-55 → master` (squash), body avec résumé + `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, co-author Claude.

## Self-review (fait à l'écriture)
- Couverture spec : T0 ✅ (Task 0), Chantier A ✅ (Tasks 1-4), Chantier B ✅ (Tasks 5-7), tests ✅ (1.3/2.3/4.3/6.4), gates ✅ (Task 8), closeout ✅ (Task 9).
- Types cohérents : signatures v4/v3/v16 identiques entre Tasks 1/2/6 et leurs consommateurs Tasks 3/7 ; `idempotencyKey?: string` uniforme Tasks 3/4.
- Pas de placeholder : chaque hunk SQL/TS est donné ; les corps copiés pointent leur source exacte (`_018` l.11-119, `20260619000030` l.210-330, `_074` intégral).
