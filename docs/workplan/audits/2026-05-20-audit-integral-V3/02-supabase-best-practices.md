# Vague 2 — Audit Supabase Best Practices

> **Date** : 2026-05-20
> **Skill** : `anthropic-skills:supabase-best-practices` (adaptée V3 — la skill cible V2 `abjabuniwkqpfsenxljp`, ici V3 `ikcyvlovptebroadgtvd`)
> **Scope** : 285 migrations SQL, ~217 RPCs SECURITY DEFINER/INVOKER, 11 Edge Functions Deno, RLS toutes tables, types & realtime apps/**
> **Effort réel** : ~75 minutes (lecture seule, 0 modif code/migration)
> **Méthode** : Glob/Grep sur `supabase/migrations/`, `supabase/functions/`, `apps/**`, `packages/**` + Read approfondi des RPCs/EFs critiques

---

## TL;DR (5 lignes max)

Posture sécurité **forte** : RLS 100% coverage, `has_permission()` v7 verrouillé pure-lookup, S20 GRANT hardening complet (REVOKE anon défense-en-profondeur sur tables/views/functions + ALTER DEFAULT PRIVILEGES), idempotency 2-flavors propres (S25), rate-limit durable Postgres-backed sur 5 EFs sensibles (S19). **3 findings élevés** : `void-order` / `cancel-item` reçoivent encore PIN en body JSON (cutover S25 partiel — refund-order seul migré, sweep différé documenté CLAUDE.md), `process-payment` EF n'a NI rate-limit NI idempotency header (relie sur RPC body field), CORS `*` Allow-Origin sur 100% EFs (acceptable kiosk/POS LAN, à durcir post-déploiement production internet). **0 critique**. `packages/domain` IO-pur, Realtime channels tous UUID-suffixés. La dette consiste majoritairement en hygiène TS (`as any` × 18 sur tables jeunes hors `gen-types`).

---

## Méthodologie

1. **Inventaire** — Glob sur `supabase/migrations/*.sql` (285 fichiers), `supabase/functions/*/index.ts` (11 EFs), `apps/**`, `packages/**`. Comptage migrations (285), fonctions PG (216 sur 162 fichiers), helpers `_shared/` (11).
2. **RPC qualité** — Grep `^CREATE OR REPLACE FUNCTION` + `SECURITY DEFINER|INVOKER` + `has_permission(` + `REVOKE EXECUTE` ; lecture détaillée de 8 RPCs représentatives (catalog, B2B, tablet idempotent, inventory primitive, has_permission core, refund replay, expense, mappings).
3. **RLS** — Grep `ENABLE ROW LEVEL SECURITY` (76 instances) ; recherche exhaustive `USING(true)` (14 hits) puis lecture des fichiers pour distinguer tables PII vs catalog/throwaway ; vérification du migration S20 `_033` `rls_pii_anon_to_authenticated`.
4. **Edge Functions** — Lecture des 11 EFs (auth-verify-pin, auth-change-pin, auth-get-session, auth-logout, process-payment, cancel-item, refund-order, void-order, customer-birthday-notify, kiosk-issue-jwt, notification-dispatch) + helpers `_shared/cors.ts`, `_shared/idempotency.ts`, `_shared/rate-limit.ts`.
5. **Apps anti-patterns** — Grep `\.select\(['"]*['"]\)` (11 fichiers BO), `as any` (50 occurrences / 23 fichiers), `as never` (1 fichier test), `@ts-(ignore|expect-error)` (0 trouvé), `.channel(` (9 mounts).
6. **`packages/domain` IO-pure** — Grep `react|@supabase|next|fetch` → 0 violation (les fichiers grep-matchés contiennent uniquement des types Supabase ré-exportés, pas d'IO).

---

## Score qualité par catégorie

| Catégorie | Score | Notes |
|---|---|---|
| RPCs SECURITY DEFINER/INVOKER cohérence | 38/38 critiques | mutations DEFINER, reads INVOKER. 0 ambiguïté. |
| RPCs critiques avec `has_permission()` gate | 35/38 | Exceptions justifiées : `record_stock_movement_v1` (internal primitive — REVOKE auth), `evaluate_promotions_v1` (read-only logique), `has_permission` lui-même. |
| RPCs critiques mutations avec REVOKE EXECUTE pair | 33/38 | 33 RPCs publient explicitement `REVOKE ALL FROM PUBLIC` + `REVOKE EXECUTE FROM anon` + `GRANT TO authenticated`. Reste protégé par S20 `ALTER DEFAULT PRIVILEGES`. |
| RPCs idempotentes (mutations réseau-sensibles) | 8/12 | OK : `complete_order_with_payment` v8 (RPC arg `p_idempotency_key`), `create_tablet_order_v2` (p_client_uuid), `record_b2b_payment_v1`, `adjust_b2b_balance_v1`, `record_stock_movement_v1`+wrappers, `refund_order_rpc_v2`, `update_cost_price_v1`. NON-idem : `void_order_rpc`, `cancel_order_item_rpc`, `record_cash_movement_rpc`, `close_shift_rpc` (NON-critique pour les 2 derniers car flow utilisateur unique). |
| RLS coverage tables publiques | ~100% | 76 `ENABLE ROW LEVEL SECURITY` détectés, 49 fichiers `init_*` ; S20 `_010` + `_040` ont fermé tous les manques connus. |
| `USING(true)` sur tables PII | 0 | 14 occurrences au total, toutes sur tables non-PII (settings, holidays, lan_devices, print_queue, etc.) ; S20 `_040` a permission-gate les 5 sensibles (cash_movements, lan_devices, notification_outbox, print_queue, stock_reservations). |
| EFs avec rate-limit câblé | 5/11 | OK : `auth-verify-pin` (3/min IP), `kiosk-issue-jwt` (10/min IP + 1/min kiosk_id), `refund-order` (10/min IP), `void-order` (10/min IP), `cancel-item` (10/min IP). NON câblé : `process-payment`, `auth-change-pin`, `auth-get-session`, `auth-logout`, `customer-birthday-notify`, `notification-dispatch`. |
| EFs avec idempotency helper (`_shared/idempotency.ts`) | 1/11 | Seul `refund-order` utilise `getIdempotencyKey()`. `process-payment` lit `idempotency_key` du body JSON (legacy avant S25). Les autres EFs sont semantiquement non-idem ou non-mutantes. |
| EFs mutantes avec PIN en header `x-manager-pin` | 1/3 | OK : `refund-order` (S25 cutover). À MIGRER : `void-order` + `cancel-item` (PIN en body JSON) — sweep documenté dans CLAUDE.md, "deferred post-S30". |
| `select('*')` count apps/** | 11 fichiers / 14 hits | Hooks BO sur tables peu volumineuses (settings, suppliers, expenses, lan_devices, print_queue) ; pas dangereux à court terme mais anti-pattern type-drift. |
| `as any` count apps/** | 50 occurrences / 23 fichiers | Majoritaire = tests fixtures (acceptable) ; **18 réelles en hooks/pages** : `(supabase as any).from(...)`, `payload as any` (RPC arg), `('view_...' as any)` pour vues post-`gen-types`. |
| `as any` count packages/** | 1 (`packages/ui/src/primitives/EmptyState.tsx`) | acceptable (générique render-prop). |
| `as never` count | 1 occurrence | `apps/pos/src/stores/__tests__/cartStore.networkSplit.test.ts` (test util, OK). |
| `@ts-ignore` / `@ts-expect-error` | 0 | clean. |
| Realtime channels UUID-suffixed | 9/9 | Tous les `.channel(...)` mountent un suffixe UUID ou un `mountId`/`hubDeviceId` unique. StrictMode-safe. |
| `packages/domain` IO-pure | OK | Aucun import `react/@supabase/next`, aucun `fetch()`. Les fichiers grep-matchés `supabase` contiennent uniquement des types `Database`/`Tables` ré-exportés. |

---

## Findings

### Critiques (Bloquants — fix avant prod)

| ID | Catégorie | RPC/EF/File | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|---|
| (aucun) | — | — | Aucun finding critique. | — | — |

### Élevés (Sécurité / dette structurelle)

| ID | Catégorie | RPC/EF/File | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|---|
| **V2-SBP-H1** | EF/Secret leak | `void-order/index.ts`, `cancel-item/index.ts` | PIN manager lu depuis body JSON (`body.manager_pin`). Pattern CLAUDE.md S25 exige `x-manager-pin` header (request bodies loggés par PostgREST/pgaudit/reverse-proxy par défaut). `refund-order` est seul migré (cutover hard S25). | `void-order/index.ts:19,57-59,61` ; `cancel-item/index.ts:23,61-63,66` | Cutover header-only en miroir de `refund-order`. Patch identique (5-line diff) + suppression body field. Test smoke POS à mettre à jour. Sweep déjà budgété : CLAUDE.md "deferred post-S30". |
| **V2-SBP-H2** | EF/Idempotency | `process-payment/index.ts` | EF n'utilise PAS le helper `getIdempotencyKey()` (S25). L'idempotency est passée via `body.idempotency_key` au RPC. Conséquence : retries réseau côté POS qui timeoutent côté EF (502/504) peuvent doubler une commande car le RPC ne voit pas la clé si le body n'est pas reparvenu. | `process-payment/index.ts:40,~140` (forward body field) | Migrer vers `x-idempotency-key` header + helper `getIdempotencyKey(req)`. Header survit aux retries fetch/networkretry middleware. |
| **V2-SBP-H3** | EF/Rate-limit gap | `process-payment/index.ts` | EF la plus mutante du système (crée order + JE + stock_movements + loyalty + promotions) sans rate-limit Postgres-backed. Vector de DoS comptable : un attaquant authentifié peut générer des milliers d'orders consécutifs et saturer journal_entries + corromper le mv_pl_monthly. | `process-payment/index.ts:~66-77` (no `checkRateLimitDurable` call) | Câbler `checkRateLimitDurable({ functionName: 'process-payment', bucketKey: 'profile:'+id, maxPerWindow: 60, windowSec: 60 })` (60 tx/min/cashier raisonnable). |

### Moyens (Dette technique / risque modéré)

| ID | Catégorie | RPC/EF/File | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|---|
| **V2-SBP-M1** | CORS | `_shared/cors.ts` | `Access-Control-Allow-Origin: *` sur les 11 EFs sans distinction. Acceptable kiosk LAN/POS LAN ; risqué pour les EFs auth (`auth-verify-pin`, `auth-change-pin`) et financières (`refund-order`, `process-payment`) exposées internet. | `_shared/cors.ts:3` | Implémenter un `corsHeadersFor(req, allowedOrigins)` qui valide `Origin` contre allowlist par EF. Variable d'env `POS_ALLOWED_ORIGINS` (ex `https://breakery.local,https://breakery.app`). |
| **V2-SBP-M2** | TS hygiene | 18 fichiers BO/POS | Bypass type avec `as any` sur appels RPC/vues récentes : `view_product_allergens_resolved as any`, `stock_lots as any`, `payload as any`, etc. Indique du drift `gen-types` (tables/vues nouvelles non régénérées dans `types.generated.ts`). | Voir Annexe A2 | Lancer `mcp__plugin_supabase_supabase__generate_typescript_types` → écrire dans `packages/supabase/src/types.generated.ts` → remplacer les `as any` par les types générés. |
| **V2-SBP-M3** | Idempotency v1-5 leak | `_shared/idempotency.ts:5` | UUID_REGEX accepte v1-5 mais le message d'erreur dit "must be UUID v4". Documenté DEV-S25-1.A-01. POS utilise `crypto.randomUUID()` (toujours v4) donc inoffensif aujourd'hui. | `_shared/idempotency.ts:5,17` | Si volonté de strict v4 : durcir regex `[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}` (3e bloc commence par '4', 4e bloc commence par 8/9/a/b). Sinon, corriger juste le message d'erreur. |
| **V2-SBP-M4** | Audit log compat-view | `audit_log` view (post-S13) | Vue de compatibilité `audit_log` (singulier) sur `audit_logs` (pluriel) avec INSTEAD-OF trigger, créée S13 `_034` pour ne pas casser 4 RPCs legacy. Restée en place depuis 5 sessions. Tech debt qui masque les nouveaux usages potentiellement incorrects. | `supabase/migrations/20260517000034_drop_legacy_audit_log_singular.sql` | Audit lecture : `grep -r "audit_log[^s]" supabase/migrations` post-`_034` → si 0 hit nouveau, drop la view dans S30+. |
| **V2-SBP-M5** | `select('*')` BO | 11 fichiers BO | 14 hits `.select('*')` dans hooks BO sur tables peu critiques (suppliers, expenses, holidays, receipt_templates, etc.). Pas dangereux côté perf à court terme mais drift de typage (nouvelles colonnes ajoutées arrivent sous forme `Record<string, unknown>` selon types.generated.ts). | Voir Annexe A2 | Refactor incrémental — sélectionner explicitement les colonnes consommées. Priorité basse (tables jeunes, low-cardinality). |
| **V2-SBP-M6** | `customer-birthday-notify` cron secret en clair | `customer-birthday-notify/index.ts:38-41` | Auth via header `x-cron-secret`. CLAUDE.md évoque "pg_net-based birthday cron" deferred. Le secret est stocké dans une variable d'env Supabase mais transite en clair sur le `pg_cron net.http_post` body — visible dans `pg_cron.job` logs. | `customer-birthday-notify/index.ts:38` | Migrer vers Vault (`vault.create_secret(...)`) + lecture dans le cron via `vault.decrypted_secrets`. Documenté DEV-S21-1.A.1-01. |

### Bas (Cosmétique / informationnel)

| ID | Catégorie | RPC/EF/File | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|---|
| **V2-SBP-L1** | Compat view exposed | `audit_log` view post-S13 | `GRANT SELECT, INSERT ON audit_log TO authenticated` avec policy héritée de `audit_logs` mais la vue elle-même n'a pas de RLS (PostgreSQL views inherit underlying-table RLS only si security_invoker, ce qui n'est pas explicité). | migration `_034:77` | Ajouter `ALTER VIEW audit_log SET (security_invoker = true);` (PG15+) pour expliciter le canal d'autorisation. Pour PG14 / vues SECURITY DEFINER, le risque actuel est nul car la policy de `audit_logs` est restrictive. |
| **V2-SBP-L2** | EF redundancy | `verifyManagerPin` invoqué APRÈS rate-limit mais AVANT idempotency lookup | `refund-order/index.ts:55-105` ordre : rate-limit → manager_pin header présent → idempotency key → auth header → body validation → verifyManagerPin. Inefficient — un PIN invalide consomme un slot rate-limit + un round-trip DB inutile. | `refund-order/index.ts:55-105` | Inverser l'ordre : verifyManagerPin avant idempotency (le RPC va de toute façon valider). Gain : ~50ms par requête malformée. |
| **V2-SBP-L3** | TS hygiene packages/ | `packages/ui/src/primitives/EmptyState.tsx` | 1 `as any` dans un primitive (render-prop). Acceptable mais documentable. | `packages/ui/src/primitives/EmptyState.tsx:1` | Préciser le type générique du render-prop ou ajouter un commentaire `// eslint-disable-next-line — render-prop polymorphic`. |
| **V2-SBP-L4** | Realtime sur tables sensitives | `apps/pos/src/features/promotions/hooks/usePromotionsRealtime.ts` | Subscribe sur tablet `promotions` (changements de prix). Pas un leak mais broadcaster les changements de promotions à tous les POS révèle des stratégies pricing aux clients tablet. | `usePromotionsRealtime.ts:23` | Vérifier que kiosk-JWT tablet ne peut PAS s'abonner à `postgres_changes` sur `promotions` (RLS doit aussi gate Realtime). Si nécessaire, scope tighten dans Supabase Studio. |
| **V2-SBP-L5** | EF logging plain | `process-payment/index.ts` (et autres) | `console.error([refund-order] rpc error, error)` log l'erreur entière (peut contenir SQL state + hint = info schema). Pas un leak HTTP (redacted via `redactError`) mais visible dans Edge Function logs Supabase. | All EFs | OK pour debugging interne — confirmer que les logs Edge Function ne sont pas exfiltrés à un tiers (Sentry/Datadog) sans masquage SQL state. |

---

## Détails par catégorie

### 1. RPC qualité — RPCs critiques échantillonnées

| RPC | SEC | has_perm | REVOKE pair | Idempotent | Notes |
|---|---|---|---|---|---|
| `create_product_v1` (S27b) | DEFINER | ✓ `products.create` (ligne 32) | ✓ `_101749` | N/A | Allowlist 21 cols, SKU unique check, seed `product_unit_contexts`, audit_logs. |
| `update_product_v1` (S27) | DEFINER | ✓ `products.update` (ligne 25) | ✓ `_023915` | N/A | Allowlist 18 cols, `cost_price` exclu (use `update_cost_price_v1`), audit_logs. |
| `set_product_units_v1`, `set_product_sections_v1`, `upsert_product_modifiers_v1` (S27) | DEFINER | ✓ | ✓ `_023932/45/57` | N/A | OK. |
| `create_category_v1`, `update_category_v1`, `reorder_categories_v1` (S27b) | DEFINER | ✓ | ✓ `_101902/13/24` | N/A | DnD reorder fixed `_102709` ambiguous-id bug. |
| `record_stock_movement_v1` (S12-13, v5) | DEFINER | (internal — REVOKE auth) | ✓ REVOKE all | ✓ `p_idempotency_key` | INTERNAL primitive — appelable seulement par autres SEC DEFINER. FIFO lot resolution embedded. |
| `adjust_stock_v1`, `receive_stock_v1`, `waste_stock_v1` (S12) | DEFINER | ✓ `inventory.*` | ✓ | ✓ via primitive | OK. |
| `get_stock_levels_v1` (S12) | INVOKER (read) | ✓ `inventory.read` | (read, GRANT SELECT) | N/A | OK. |
| `internal_transfer_*` (4 RPCs S12) | DEFINER | ✓ | ✓ | ✓ | OK. |
| `record_production_v1` (S13-15 yield-aware) | DEFINER | ✓ `inventory.production.create` | ✓ | ✓ | OK. |
| `record_batch_production_v1` (S15) | DEFINER | ✓ | ✓ | ✓ | Tempttbl fix `_103`. |
| `calculate_recipe_cost_v1`, `recipe_bom_full_v1`, `recipe_cost_history_v1` | DEFINER (cost cascade) | ✓ `recipes.read` | ✓ | N/A (read) | walk helper revoked S19 `_020`. |
| `validate_recipe_no_cycle_v1` (S15) | DEFINER | ✓ | ✓ | N/A | Anti-cycle DFS. |
| `revert_production_v1`, `duplicate_recipe_v1`, `suggest_production_schedule_v1` | DEFINER | ✓ | ✓ | partial (revert idempotent) | OK. |
| `create_po`, `receive_po`, `cancel_po` (S15) | DEFINER | ✓ `purchasing.*` | ✓ | ✓ | WAC update embedded in receive_po S17. |
| `update_cost_price_v1` (S22) | DEFINER | ✓ `inventory.update_cost` | ✓ + `_010` table REVOKE UPDATE col | ✓ envelope `_014` | OK. |
| `validate_b2b_credit_limit_v1` (S14, wired S24) | DEFINER | ✓ `customers.read` | ✓ | N/A | OK — gate called by `create_b2b_order_v1`. |
| `record_b2b_payment_v1`, `adjust_b2b_balance_v1`, `create_b2b_order_v1` (S24) | DEFINER | ✓ `customers.update` / `sales.b2b.create` | ✓ | ✓ key UNIQUE | JE DR Cash/Bank/CR B2B_AR + FIFO allocation snapshot. |
| `create_expense_*` (5 RPCs S13 G4) | DEFINER | ✓ `expenses.*` | ✓ | partial | OK. |
| `init_accounting_mappings`, `pnl_rpc`, `balance_sheet_rpc`, `cash_flow_rpc`, `cash_flow_v1_3sections_rpc` (S25) | DEFINER (init) / INVOKER (reports) | ✓ `accounting.*` / `reports.financial.read` | ✓ | N/A | OK. |
| `calculate_vat_payable_rpc` (S13 G6) | DEFINER | ✓ `accounting.read` | ✓ | N/A | OK. |
| `retry_sale_je_rpc` (S13) | DEFINER | ✓ `accounting.post` | ✓ | partial | OK. |
| `update_mapping_rpc` (S13) | DEFINER | ✓ `accounting.mapping.update` | ✓ | N/A | OK. |
| `update_role_session_timeout_v1` (S19) | DEFINER | ✓ admin-gated | ✓ corrective `_022` REVOKE FROM anon | N/A | Audit log gated. |
| `record_rate_limit_v1` (S19) | DEFINER | (internal, REVOKE all) | ✓ | atomic | xact_lock fix `_012`. |
| `reset_user_pin_v1` (S13) | DEFINER | ✓ `users.update` | ✓ | partial | OK. |
| **POS:** `complete_order_with_payment` v9 (S13) | DEFINER | ✓ `payments.process` | ✓ | ✓ `p_idempotency_key` arg | Le pivot du système — multi-tender, JE atomique. |
| `pay_existing_order` v6 (S13) | DEFINER | ✓ `payments.process` | ✓ | ✓ | OK. |
| `create_tablet_order_v2` (S25) | DEFINER | ✓ `sales.create` (après idem replay) | ✓ | ✓ `p_client_uuid` UNIQUE | v1 dropped same migration (CLAUDE.md monotonic rule). |
| `pickup_tablet_order_rpc`, `cancel_tablet_order_rpc`, `mark_item_served_rpc`, `send_items_rpc` | DEFINER | ✓ | ✓ | N/A | OK. |
| `void_order_rpc`, `refund_order_rpc_v2` (S13 / S25) | DEFINER | ✓ `pos.sale.void` / `pos.sale.refund` | ✓ | ✓ (refund seul) | `void_order_rpc` non-idem documenté. |
| `cancel_order_item_rpc` (S10) | DEFINER | ✓ `pos.sale.cancel_item` | ✓ | N/A | OK. |
| `evaluate_promotions_v1` (S11) | INVOKER | (logique read-only) | (GRANT EXECUTE) | N/A | OK — pure compute. |
| `adjust_loyalty_points_v1` (S14) | DEFINER | ✓ `loyalty.adjust` | ✓ hardened `_004` | partial | OK. |
| `get_customer_product_price` (S9) | INVOKER (read) | ✓ `products.read` | (GRANT) | N/A | OK. |
| `soft_delete_customer_rpc` (S14) | DEFINER | ✓ `customers.delete` | ✓ hardened `_003` | N/A | OK. |
| `close_shift_rpc` (S13) | DEFINER | ✓ `cash_register.close` | ✓ | non | OK — flow utilisateur unique par shift. |
| `record_cash_movement_rpc` (S13) | DEFINER | ✓ `cash_register.adjust` | ✓ | non | OK — montant + reason = pas vraiment replayable. |

**Verdict RPC** : qualité **excellente**. 38/38 ont SECURITY mode cohérent, 35/38 ont gate explicite (3 exceptions internes/read justifiées), 33/38 ont REVOKE pair. La discipline RPC versioning monotonic est respectée partout (`_v2` créé + drop `_v1` dans la même migration via DO block).

### 2. RLS coverage

**Tables sans `ENABLE ROW LEVEL SECURITY`** : aucune détectée sur les tables `public.*` mutées par le code. Le grep `ENABLE ROW LEVEL SECURITY` retourne 76 hits sur 49 fichiers `init_*`, et S20 `_010` `enable_rls_refund_sequences` + S20 `_040` `tighten_authenticated_select_policies` ont fermé les manques connus.

**`USING(true)` résiduels** (14 hits, tous non-PII) :

| Table | Migration:ligne | Sensitivity | Justification |
|---|---|---|---|
| `expense_categories` | `_120:162` | Low (réf catalog) | Cataloguette, opérateur a besoin de l'autocomplete. |
| `cash_movements` (legacy) | `_134:25` | **Medium** | **OK** — réécrite S20 `_040` avec `cash_register.read OR reports.financial.read`. |
| `lan_devices` (legacy) | `_171:63` | Medium | OK — réécrite S20 `_040` avec `lan.devices.read`. |
| `notification_outbox` (legacy) | `_180:97,114` | Low | OK — réécrite S20 `_040` avec `settings.read`. |
| `display_screens` | `_160:44` | Low | Intentionnel (printer pairing affichage). |
| `stock_reservations` (legacy) | `_132:52` | Medium | OK — réécrite S20 `_040` avec `inventory.read`. |
| `print_queue` (legacy) | `_170:73` | Medium | OK — réécrite S20 `_040` avec `has_kiosk_jwt() OR print_queue.read`. |
| `email_receipt_templates` | `_192:44,100` | Low | Intentionnel (POS imprime reçus). |
| `holidays` | `_191:51` | Low | Intentionnel (POS pick holiday calendar). |
| `refund_sequences` | `_010:14` | Low | sequences-like = pas de PII. |
| `tablet_order_idempotency_keys` | `_010:23` | Low | Internal idempotency table, sans données métier. |

**Helper `has_permission()` v7** : LOCKED par S13 `_030`, pure-lookup 4-tier (DENY override > role grant > GRANT override > default DENY), STABLE SECURITY DEFINER. Aucune CREATE OR REPLACE post-S13 — CI grep gate enforce. **Verdict RLS : 100% propre**.

### 3. Edge Functions

| EF | Auth flow | Idempotency | CORS | Rate-limit | PIN header | Error redact | Notes |
|---|---|---|---|---|---|---|---|
| `auth-verify-pin` | own (PIN hash) | N/A | `*` | ✓ 3/min IP | N/A | `redactError` | Émet HS256 JWT → custom fetch wrapper. |
| `auth-change-pin` | `requireSession` | N/A | `*` | ✗ | header OK | non | Pas de RL — accessible par session valide (low risk). |
| `auth-get-session` | `requireSession` | N/A | `*` | ✗ | N/A | non | Read-only profile + perms + timeout. |
| `auth-logout` | `requireSession` | N/A | `*` | ✗ | N/A | non | Termine la session DB. |
| `process-payment` | Bearer header → userClient | body field (forwarded) | `*` | ✗ **GAP** | N/A | console.error | **V2-SBP-H2/H3** : pas de header idem, pas de RL. |
| `cancel-item` | Bearer + manager-pin body | non | `*` | ✓ 10/min IP | **body JSON** | console.error | **V2-SBP-H1** : PIN en body. |
| `refund-order` | Bearer + x-manager-pin header | ✓ helper `getIdempotencyKey` | `*` | ✓ 10/min IP | ✓ header | console.error | S25 reference impl. |
| `void-order` | Bearer + manager-pin body | non | `*` | ✓ 10/min IP | **body JSON** | console.error | **V2-SBP-H1** : PIN en body. |
| `customer-birthday-notify` | x-cron-secret OR service_role | N/A | `*` | ✗ | N/A | non | Cron-triggered. Secret en clair pg_cron — DEV-S21-1.A.1-01. |
| `kiosk-issue-jwt` | IP allowlist + 2 buckets RL | N/A | `*` | ✓ 10/min IP + 1/min kiosk_id | N/A | logAndRedact | Mint HS256 JWT pour KDS/display/tablet. |
| `notification-dispatch` | Bearer OR query secret | N/A | `*` | ✗ | N/A | non | Cron poll outbox max 50 rows. |

**Helpers `_shared/`** :
- `cors.ts` : single CORS object avec `Access-Control-Allow-Origin: *` (V2-SBP-M1).
- `idempotency.ts` : helper propre (V2-SBP-M3 regex v1-5 leak).
- `rate-limit.ts` : `checkRateLimitDurable` layered (memory pre-check + Postgres RPC durable), fail-open sur DB error (D2 intentionnel).
- `manager-pin.ts` : verifyManagerPin → resolve `profile_id`. OK.
- `jwt.ts` : HS256 signer (SUPABASE_JWT_SECRET).
- `permissions.ts` : `computePermissionsForRole` + `checkPermissionForRole`.
- `error-redact.ts` : `redactError` + `logAndRedact` (server log côté, response masquée).
- `responses.ts` : `rateLimitedResponse` avec `Retry-After` header (S22 fix DEV-S19-2.A-02).
- `session-auth.ts` : `requireSession(req)` valide la session DB.
- `pin-strength.ts` : miroir Deno de `packages/utils/pin-strength.ts` (S19, test sync).
- `email-provider.ts` : Resend integration avec fallback console.

### 4. Types & query quality

**`select('*')` apps/** (14 hits / 11 fichiers)** — voir Annexe A2.

**`as any` apps/** (18 réels en hooks/pages, 32 dans __tests__)** :
- **RPC arg cast** (5) : `useUpdateProduct.ts:53` `payload as any` ; `useCategoryMutations.ts:32,50` ; `useCreateProduct.ts:29` ; `useCreateB2bOrder.ts:120` — drift `types.generated.ts` post-S27.
- **Vues post-types regen** (5) : `useProductAllergens.ts:27,33,59` ; `useResolvedAllergensMap.ts:22` ; `useStockLots.ts:53` — vues PostgREST non listées dans `types.generated.ts`.
- **`(supabase as any).from`** (3) : `useLanDevices.ts:33` ; `usePrintQueue.ts:43` ; `useExpiringLots.ts:71` — tables jeunes.
- **Test fixtures** (32) : tous en `__tests__/` — OK.

### 5. Realtime

Tous les 9 mounts `.channel(...)` sont **UUID-suffixed ou identifiés par mount-unique key** (StrictMode-safe) :

| Mount | Pattern | Mounting key |
|---|---|---|
| `useTabletOrderStatusListener.ts:30` | `tablet-order-status-${mountId}` | uuid mount |
| `useTableOccupancy.ts:46` | `table_occupancy_realtime-${mountId}` | uuid mount |
| `usePromotionsRealtime.ts:23` | `promotions-changes-${mountId}` | uuid mount |
| `usePendingTabletOrders.ts:25` | `pending-tablet-orders-${crypto.randomUUID()}` | uuid mount |
| `useDisplayRealtime.ts:31` | `${channelName}` (mountId-scoped) | uuid mount |
| `useKdsRealtime.ts:57` | `${channelName}` (mountId-scoped) | uuid mount |
| `lanHub.ts:73` | `lan-hub-${hubDeviceId}-${channelKeySuffix}` | per-device |
| `lanClient.ts:66` | `lan-hub-${hubDeviceId}-${channelKeySuffix}` | per-device |
| `realtime-channel-uniqueness.test.tsx:20` | (test capture) | N/A |

Tous les hooks ont également un cleanup `removeChannel` dans le `useEffect` return (vérifié par sample). **Pas de leak subscription détecté**.

### 6. `packages/domain` IO-purity

- Aucun import `react`, `@supabase/*`, `next`.
- Aucun `fetch()` call.
- Les 7 fichiers `supabase`-matched contiennent uniquement des `import type { Database, Tables }` de `packages/supabase/src/types.generated.ts` (types ré-exportés, pas de runtime IO).
- **Verdict : 100% IO-pure**.

---

## Annexes

### A1 — Liste exhaustive des RPCs auditées avec statut détaillé

Cf. tableau §1 ci-dessus. 38 RPCs critiques échantillonnées sur 216 RPCs totales (~18% du surface). Aucune surprise post-S25 — la discipline `has_permission()` + `REVOKE EXECUTE` + DROP `_v(N)` est uniforme sur les RPCs post-S13 (les RPCs pré-S13 sont également uniformes via les migrations harden `_015xxxxx`).

### A2 — `as any` apps/ (hors __tests__) avec contexte

| Fichier | Ligne | Contexte | Catégorie |
|---|---|---|---|
| `apps/backoffice/src/features/categories/hooks/useCategoryMutations.ts` | 32 | `p_payload: payload as any` | RPC arg cast (drift types.generated post-S27b) |
| | 50 | `p_patch: patch as any` | idem |
| `apps/backoffice/src/features/products/hooks/useCreateProduct.ts` | 29 | `p_payload: payload as any` | idem (S27b) |
| `apps/backoffice/src/features/products/hooks/useUpdateProduct.ts` | 53 | `p_patch: patch as any` | idem (S27) |
| `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts` | 120 | `await supabase.rpc('create_b2b_order_v1', rpcArgs as any)` | RPC arg cast (S24) |
| `apps/backoffice/src/features/products/hooks/useProductAllergens.ts` | 27,33,59 | `.from('view_product_allergens_resolved' as any)`, `.update({ allergens } as any)` | Vue non régénérée |
| `apps/backoffice/src/features/products/hooks/useResolvedAllergensMap.ts` | 22 | `.from('view_product_allergens_resolved' as any)` | idem |
| `apps/backoffice/src/features/inventory/hooks/useStockLots.ts` | 53 | `.from('stock_lots' as any)` | Table jeune (S13 F1) |
| `apps/backoffice/src/features/inventory/hooks/useExpiringLots.ts` | 71 | `await (supabase as any).rpc('get_expiring_lots_v1', args)` | RPC jeune |
| `apps/backoffice/src/features/lan-devices/hooks/useLanDevices.ts` | 33 | `const builder = (supabase as any).from('lan_devices')` | Table S13 |
| `apps/backoffice/src/features/print-queue/hooks/usePrintQueue.ts` | 43 | `const builder = (supabase as any).from('print_queue')` | Table S13 |
| `apps/pos/src/features/products/hooks/useActiveLotsByProduct.ts` | 31 | `.from('stock_lots' as any)` | idem |
| `apps/pos/src/features/products/hooks/useProductAllergens.ts` | 27 | `.from('view_product_allergens_resolved' as any)` | idem |
| `apps/backoffice/src/layouts/Sidebar.tsx` | (2 hits) | navigation type narrowing | Composant |
| `apps/backoffice/src/routes/index.tsx` | (4 hits) | route guard cast | Router types |

**`select('*')` apps/** (11 fichiers / 14 hits)** :

| Fichier | Ligne | Table |
|---|---|---|
| `apps/backoffice/src/features/suppliers/hooks/useSuppliersList.ts` | 29 | `suppliers` |
| `apps/backoffice/src/features/suppliers/hooks/useSupplierDetail.ts` | 20 | `suppliers` |
| `apps/backoffice/src/features/settings/hooks/useReceiptTemplates.ts` | 24 | `email_receipt_templates` |
| `apps/backoffice/src/features/settings/hooks/usePermissionsMatrix.ts` | 27,28,29 | `roles`, `permissions`, `role_permissions` |
| `apps/backoffice/src/features/settings/hooks/useHolidays.ts` | 24 | `holidays` |
| `apps/backoffice/src/features/settings/hooks/useEmailTemplates.ts` | 23 | `notification_templates` |
| `apps/backoffice/src/features/print-queue/hooks/usePrintQueue.ts` | 44 | `print_queue` |
| `apps/backoffice/src/features/lan-devices/hooks/useLanDevices.ts` | 34 | `lan_devices` |
| `apps/backoffice/src/features/expenses/hooks/useExpenseDetail.ts` | 14 | `expenses` |
| `apps/backoffice/src/features/expenses/hooks/useExpensesList.ts` | 32,71 | `expenses` |

### A3 — Mapping EF → couverture rate-limit / idempotency / PIN header

| EF | Rate-limit | Idempotency helper | PIN flow | Action |
|---|---|---|---|---|
| `auth-verify-pin` | ✓ (3/min IP) | N/A (auth) | own | OK |
| `auth-change-pin` | ✗ | N/A | header PIN | (Considérer RL : 5/min user) |
| `auth-get-session` | ✗ | N/A | N/A | OK (idempotent read) |
| `auth-logout` | ✗ | N/A | N/A | OK |
| `process-payment` | ✗ **V2-SBP-H3** | ✗ **V2-SBP-H2** (body field) | N/A | Add `checkRateLimitDurable` + `getIdempotencyKey` header |
| `cancel-item` | ✓ | ✗ | **body JSON V2-SBP-H1** | Migrate PIN to header |
| `refund-order` | ✓ | ✓ (S25 ref impl) | ✓ header | OK |
| `void-order` | ✓ | ✗ | **body JSON V2-SBP-H1** | Migrate PIN to header + add idem |
| `customer-birthday-notify` | ✗ | N/A | cron-secret | OK (cron-triggered, low surface) |
| `kiosk-issue-jwt` | ✓ (2 buckets) | N/A | N/A | OK |
| `notification-dispatch` | ✗ | N/A | Bearer | OK (cron-triggered) |
