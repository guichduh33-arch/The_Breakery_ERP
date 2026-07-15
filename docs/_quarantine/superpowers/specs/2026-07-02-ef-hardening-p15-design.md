# S55 — P1.5 (T7) Durcissement EF restant : design

> Session 55 · branche `swarm/session-55` · source : §4 P1.5 + §6.5 de
> `docs/workplan/audits/2026-06-27-audit-integral-par-module.md`.

## 1. Périmètre réel (re-vérifié code en main)

L'audit T7/P1.5 listait 4 items. Vérification du repo au 2026-07-02 :

| Item audit | État | Preuve |
|---|---|---|
| Rate-limit `auth-change-pin` | ✅ **déjà fait** | `checkRateLimitDurable` 5/60 s, bucket `user:<target>` (`supabase/functions/auth-change-pin/index.ts:50`, réf. SEC-S30-MED-03) |
| Secret `notification-dispatch` en header | ✅ **déjà fait (S50)** | header `x-dispatch-secret`, hard cutover, plus de `?secret=` (`supabase/functions/notification-dispatch/index.ts:65`) |
| Idempotency `void-order` / `cancel-item` | ❌ à faire | aucun `x-idempotency-key` lu ; RPCs v3/v2 sans `p_idempotency_key` |
| Discount-PIN : plus de PIN brut en arg SQL | ❌ à faire | `process-payment` relaie `p_manager_pin` à `complete_order_with_payment_v15` (`_verify_pin_with_lockout` côté SQL → PIN visible `pg_stat_activity`/pgaudit sur le statement money-path) |

**S55 = 2 chantiers + 1 attestation.** Les UI déférées (DEV-S54-01, DEV-S52-03)
restent hors périmètre (décision par défaut, user AFK — re-proposer au closeout).

- **T0 (attestation)** : vérifier que les versions *déployées* des 2 EFs déjà
  couvertes portent bien ces protections (`get_edge_function` MCP) ; redéployer si
  la version live est antérieure au fix. Consigner dans l'INDEX.
- **Chantier A** : idempotency void-order / cancel-item (flavor 1 S25 — header HTTP).
- **Chantier B** : discount-PIN vérifié dans l'EF + nonce single-use, bump money-path v15 → v16.

## 2. Chantier A — Idempotency `void-order` / `cancel-item`

### Décisions
- **Pattern** : flavor 1 du CLAUDE.md (« EF retry safety ») — précédent exact
  `refund-order` : header `x-idempotency-key` (UUID v4) lu via
  `getIdempotencyKey()` (`_shared/idempotency.ts`), propagé `p_idempotency_key`,
  optionnel (null OK — pas de hard-require, le POS l'envoie toujours après S55).
- **Stockage replay void** : `refunds.idempotency_key` (colonne + index unique
  partiel `refunds_idempotency_key_uidx` **déjà en place** depuis
  `20260517000014`). Le void insère déjà une ligne `refunds` (`is_full_void=true`)
  → même mécanique que `refund_order_rpc_v4` : lookup en tête, INSERT avec la clé,
  catch `unique_violation` + re-read (race).
- **Stockage replay cancel** : nouvelle colonne `order_items.cancel_idempotency_key
  UUID` + index unique partiel (précédent `refunds.idempotency_key` — flavor 1
  stocke la clé sur la ligne métier créée/mutée par l'opération ; la table dédiée
  est le pattern flavor 2). La ligne `order_items` porte déjà
  `cancelled_at/by/reason` — c'est la ligne naturelle.
- **Sémantique replay** : même clé → renvoie l'enveloppe reconstruite +
  `idempotent_replay: true` (convention projet). Sans clé ou clé différente,
  les gardes existantes restent (`Cannot void % order`, `Item already cancelled`).
- **Bumps** : `void_order_rpc_v3 → v4` (source live = `20260705000018`) et
  `cancel_order_item_rpc_v2 → v3` (source live = `20260619000030`). DROP ancienne
  signature dans la même migration ; grants inchangés : REVOKE PUBLIC+anon,
  GRANT **service_role seulement** (RPCs EF-only).
- **POS** : clé générée **par le modal** (pattern `RefundOrderModal.tsx:51/126` —
  `useRef(crypto.randomUUID())` au mount, rotation à la fermeture) et passée en
  arg de mutation. Jamais générée dans `mutationFn` (les auto-retries doivent
  réutiliser la clé) ni en `useRef` dans le hook (fuite de clé entre deux
  commandes différentes → replay de la mauvaise enveloppe).

### Enveloppes replay
- **void v4** : reconstruire depuis `refunds` (refund_id, refund_number, total,
  tax_refunded) + `orders.order_number` + `refund_payments` (tenders). Champs
  identiques au chemin nominal + `idempotent_replay: true`.
- **cancel v3** : retrouver `order_items` par `cancel_idempotency_key`,
  reconstruire `order_item_id/order_id/order_number/item_name/dispatch_station`
  + `new_subtotal/new_tax_amount/new_total` relus depuis `orders` + `idempotent_replay: true`.

## 3. Chantier B — Discount-PIN hors arg SQL (money-path v15 → v16)

### Problème
`complete_order_with_payment_v15` (GRANT `authenticated`, appelée par l'EF avec
le JWT utilisateur) reçoit `p_manager_pin text` et vérifie via
`_verify_pin_with_lockout`. Le PIN transite en clair dans les args du plus gros
statement du système (visible `pg_stat_activity`, pgaudit, logs de pool).

### Contrainte structurante
v15 est **directement appelable par tout `authenticated`** via PostgREST (grant
requis — caveat S51 : sans lui, toute la money-path casse). On ne peut donc pas
simplement retirer la vérification PIN : un appelant direct pourrait forger
`p_discount_authorized_by`. Il faut un signal **non forgeable**.

### Décision : vérification EF (parité reversals) + nonce single-use
1. **EF `process-payment`** vérifie le PIN en amont via `_shared/manager-pin.ts`
   (même chemin durci que void/cancel/refund/verify-manager-pin : format,
   `isManagerPinBlocked`/`recordManagerPinFailure` — bucket SEC-07 per-IP
   partagé — puis `checkPermissionForRole(role, 'sales.discount')`).
   `p_discount_authorized_by` devient **dérivé serveur** :
   `mgr.manager_profile_id` (le body client n'est plus cru).
2. **Nonce** : nouvelle table `discount_authorizations` (service-role only,
   REVOKE anon+authenticated+PUBLIC) : `{id uuid, manager_profile_id, scope
   'discount', expires_at now()+60s, consumed_at, consumed_order_id}`. L'EF
   (admin client) insère le nonce **et appelle v16 dans la même requête** —
   TTL 60 s largement suffisant, le nonce ne sort jamais du serveur.
3. **`complete_order_with_payment_v16`** : signature 16 args = v15 **moins**
   `p_manager_pin text` **plus** `p_discount_auth_id uuid DEFAULT NULL`.
   Le bloc PIN (`_074` l.344-346) est remplacé par la **consommation atomique**
   du nonce (`UPDATE … SET consumed_at=now() WHERE id=… AND consumed_at IS NULL
   AND expires_at>now() AND manager_profile_id=p_discount_authorized_by`,
   sinon `RAISE P0003`). Les gardes existantes restent (authorizer existe,
   `has_permission(sales.discount)` — défense en profondeur). DROP v15
   (signature 16 args exacte) même migration. ⚠️ **GRANT EXECUTE TO
   authenticated obligatoire sur v16** (caveat S51) + REVOKE anon/PUBLIC.
4. **POS inchangé** : il envoie déjà le PIN en header `x-manager-pin` au
   checkout (S37) et `verify-manager-pin` (S43) reste le pré-check du modal.
   Les codes d'erreur EF restent alignés sur `classifyCheckoutError`
   (`permission_denied`, `discount_requires_authorizer`, 429 rate-limit).

### Trade-offs assumés
- Le PIN reste passé à `verify_user_pin(p_user_id, p_pin)` par le helper partagé
  (service-role, statement minuscule) — c'est le pattern « correctement durci »
  validé par l'audit pour les reversals ; l'objectif T7 est de sortir le PIN du
  statement money-path, pas de réinventer la vérification bcrypt.
- Le lockout per-manager S38 (`_verify_pin_with_lockout` + `record_pin_failure_v1`)
  est remplacé par le bucket per-IP SEC-07 partagé (5 fails/15 min, verrouille
  aussi void/cancel/refund/verify-manager-pin) + skip des managers `locked_until`.
  Parité exacte avec le reste de la famille manager-PIN. Le fallback S38
  `record_pin_failure_v1` de l'EF (DEV-S38-A-02) devient sans objet et est retiré.
- `pay_existing_order_v11` et `fire_counter_order_v4` font confiance à
  `p_discount_authorized_by` sans PIN (état S44) — **hors périmètre T7**
  (l'audit ne les cite pas) ; noter comme candidat backlog.

### Impacts collatéraux à balayer
- Toutes les suites pgTAP/ancres qui appellent `complete_order_with_payment_v15`
  par son nom (sale_flag_aware, combo_sale, s44_display_symmetry, combo_fire_pay,
  modifier_ingredient_deduction, sale_stock_unification, …) → renommer v16
  (le PIN arg n'y était pas passé ; renommage sec).
- `types.generated.ts` : regen après chaque migration (v4/v3/table/v16).
- Redéploiement EFs : `void-order`, `cancel-item`, `process-payment`.

## 4. Tests
- **pgTAP `reversal_idempotency`** : void replay (même clé → même refund_id,
  stock non double-restauré, `idempotent_replay`), cancel replay (même clé →
  enveloppe, pas d'erreur « already cancelled » ; clé différente → check_violation).
- **pgTAP `discount_auth_nonce`** : sans nonce → P0003 ; nonce valide → ordre
  créé + nonce consommé ; nonce déjà consommé → P0003 ; nonce expiré → P0003 ;
  manager mismatch → P0003 ; ordre sans discount → inchangé (pas de nonce requis).
- **Ancres** : suites v15 existantes repointées v16, re-passées vertes.
- **POS smoke** : void/cancel envoient `x-idempotency-key` stable per-modal
  (miroir de `refund-modal-pin-header.smoke.test.tsx`).
- **Gates** : `pnpm typecheck`, `pnpm build`, suites ciblées POS.

## 5. Migrations (NAME-block suivant : `20260710000082+`)
| # | Nom | Contenu |
|---|---|---|
| `_082` | `void_order_rpc_v4_idempotency` | v4 + DROP v3 + grants |
| `_083` | `cancel_order_item_rpc_v3_idempotency` | colonne+index `order_items.cancel_idempotency_key`, v3 + DROP v2 + grants |
| `_084` | `create_discount_authorizations` | table + REVOKEs |
| `_085` | `complete_order_v16_discount_auth_nonce` | v16 + DROP v15 + grants (⚠️ GRANT authenticated) |
