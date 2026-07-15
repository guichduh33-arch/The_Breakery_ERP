# Vague 1 — Audit Drift Schema DB ↔ Code TypeScript

> **Date** : 2026-05-20
> **Skill** : anthropic-skills:db-schema-audit
> **Scope** : 312 migrations, `packages/supabase/src/types.generated.ts` (6 718 lignes), apps/** + packages/** + supabase/functions/** consumers
> **Effort réel** : ~30 min (lecture statique + grep ; aucun appel cloud, aucun écriture)

## TL;DR

L'audit pure-statique de 312 migrations contre les consommateurs apps/POS+BackOffice révèle **0 RPC fantôme runtime** mais **2 bugs Critiques bien réels** : (1) `apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts:31` sélectionne `order_items(id, name, ...)` alors que la colonne s'appelle `name_snapshot` — HTTP 400 garanti à l'exécution ; (2) le code POS Customer Display teste `order_type === 'take_away'` mais l'enum DB n'a que `'take_out'` — branche morte silencieuse. Côté schéma : 21 permissions DB absentes du union TS `PermissionCode` forcent un usage massif de `as never` dans tout le module purchasing (typing perdu), et 2 perms `users.create`/`users.update` sont seedées dans `seed.sql` uniquement (pas dans la migration défensive `000030`), donc cassent sur CI Docker reset. La monotonie des 312 timestamps est intacte (0 doublon, ordre lexical = naturel). Pas de blocage Vague 2 — corrections fast-follow recommandées sur les 2 Critiques avant prochain release POS.

## Méthodologie

**Sources** :
1. **Ground truth schéma** : 312 fichiers SQL dans `supabase/migrations/` (DDL : `CREATE TABLE`, `CREATE TYPE`, `ALTER TYPE ADD VALUE`, `CREATE FUNCTION ... SECURITY DEFINER`) + `supabase/seed.sql` (perms d'amorçage).
2. **Types regen** : `packages/supabase/src/types.generated.ts` (6 718 lignes). Note : cette version reflète l'état cloud à la session 27b (matchait `schema_migrations.version` au moment du regen MCP).
3. **Consommateurs** : `apps/{pos,backoffice}/src/**/*.{ts,tsx}`, `packages/**/src/**/*.ts`, `supabase/functions/**/*.ts`, `supabase/tests/**/*.{ts,sql}`.

**Techniques** :
- `Grep` ripgrep pour extraire `CREATE [OR REPLACE] FUNCTION public.X`, `.rpc('X', ...)`, `.from('X').select('cols')`, `EXECUTE FUNCTION X(...)`, `INSERT INTO permissions VALUES (...)`, `CREATE TYPE X AS ENUM (...)`, `ALTER TYPE X ADD VALUE`, `as any|as never|as unknown as never`, `REVOKE EXECUTE`.
- Pipelines bash : `sort -u`, `comm -23` (left-only), `comm -13` (right-only), `uniq -d` (doublons).
- Exclusion systématique des `node_modules` (bundle examples Supabase pollue le grep avec `from('characters')`, `rpc('echo')`…).
- Distinction des RPCs orphelines en 3 catégories : (a) appelées par triggers SQL via `EXECUTE FUNCTION`, (b) appelées par d'autres RPCs en interne (`PERFORM`/`SELECT`/`FROM`), (c) appelées par `cron.schedule`, (d) appelées par tests pgTAP/Vitest live, (e) vraiment mortes.

**Limites de l'analyse statique** :
- Les appels via `(supabase as any).rpc(name)` avec `name` variable sont invisibles. Spot check : 0 trouvé.
- Les `.select('*')` couvrent toutes les colonnes — impossible de détecter une attente client sur une col qui n'existe plus côté DB. Spot check : grep `\.select\(['"]\*['"]\)` → quelques cas (cf §3).
- Les triggers `EXECUTE FUNCTION` ne sont scannés qu'au niveau SQL `EXECUTE FUNCTION X` — les triggers via Supabase Edge Functions ne sont pas couverts (mais le scope V3 n'a aucun trigger EF).
- L'enum `permission_code` n'est pas modélisé comme un type Postgres ENUM (juste TEXT dans la table `permissions`), donc la sync TS↔DB est manuelle dans `packages/supabase/src/rls/permissions.ts:14-120`.

## Statistiques globales

| Métrique | Valeur |
|---|---|
| Migrations SQL totales | **312** (CLAUDE.md disait 285 — désync mineur sur le compteur, non bloquant) |
| Timestamps uniques | 312 (0 doublon) |
| Monotonie ordre lexical = naturel | OK |
| RPCs déclarées dans `public.*` | **165** uniques |
| Functions SECURITY DEFINER | **134** |
| RPCs appelées depuis `apps/**` (POS + BO) | 85 noms uniques (incl. 5 faux positifs node_modules) |
| RPCs appelées depuis `packages/**` | 0 |
| RPCs appelées depuis `supabase/functions/**` | 9 noms uniques (toutes valides) |
| RPCs appelées depuis tests Vitest/pgTAP | 67 noms uniques |
| RPCs utilisées via `EXECUTE FUNCTION` (triggers) | 16 |
| RPCs **vraiment orphelines** (ni code, ni tests, ni triggers) | **52** (dont 35 légitimes : helpers internes, cron jobs, scope déferé) |
| RPCs fantômes (appelées mais non déclarées) | **0** Critique (5 candidats sont tous des bundles `node_modules`) |
| Tables consultées via `.from()` (hors node_modules) | 64 |
| Tables / vues dans `types.generated.ts` | 73 (60 base tables + 5 views + 5 mv + 3 internals) |
| Tables consultées mais absentes des types | **0** runtime (cf §3 — `audit_log` est une vue compat depréciée) |
| Tables en types mais jamais consultées | 16 (backend shipped sans UI) |
| Enums Postgres | 14 (`allergen_type`, `cash_flow_section`, `customer_type`, `discount_template_type`, `loyalty_txn_type`, `modifier_group_type`, `movement_type`, `order_status`, `order_type`, `payment_method`, `price_modifier_type`, `promotion_scope`, `promotion_type`, `shift_status`) |
| Enums driftés DB ↔ TS regen | 0 |
| Enums driftés DB ↔ littéraux code | **1 Critique** (`'take_away'` vs `'take_out'`) |
| Permissions seedées en DB (migration + seed.sql) | 116 |
| Permissions dans union TS `PermissionCode` | 97 |
| Permissions DB **absentes du union TS** | **21** Élevé |
| Permissions union TS absentes de DB (mais présentes dans seed.sql) | 2 Moyen (`users.create`, `users.update`) |
| Statements `REVOKE EXECUTE` par-RPC | 139 (couvre 72 RPCs uniques) |
| RPCs SECURITY DEFINER sans REVOKE EXECUTE explicite | 71 — **sécurisées via sweep global `_20260524000031`** |

## Findings

### 🔴 Critiques (action immédiate avant Vague 2)

| ID | Catégorie | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|
| **C-01** | Colonne fantôme | `useMyTabletOrders` sélectionne `order_items(id, name, quantity, kitchen_status)` — `order_items.name` n'existe pas, la col s'appelle `name_snapshot`. HTTP 400 PostgREST au runtime. Côté types : `TabletOrderItemRow.name` aussi typé incorrectement (mais bypass via `as unknown as TabletOrderItemRow[]`). | `apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts:7,31,43` | Remplacer `name` → `name_snapshot` dans (a) le select string, (b) l'interface `TabletOrderItemRow`. Vérifier le rendu UI consommateur (`TabletOrderPage.tsx`, `TabletOrderCard.tsx` éventuels) pour aligner les access patterns. |
| **C-02** | Enum drifté | Customer Display teste `order_type === 'take_away'` 3 fois — enum DB `order_type` n'a que `dine_in`/`take_out`/`delivery`/`b2b`. La branche est dead code silencieux : pour les pickup orders réels, l'UI affiche la valeur brute `take_out` au lieu de "Pickup". | `apps/pos/src/features/display/components/CurrentOrderCard.tsx:55`<br>`apps/pos/src/features/display/components/OrderQueueTicker.tsx:33`<br>`apps/pos/src/features/display/__tests__/OrderQueueTicker.test.tsx:48` | Renommer 3 occurrences `'take_away'` → `'take_out'`. Le test fixture `OrderQueueTicker.test.tsx:48` masque le bug actuellement car le test fabrique des données factices avec `take_away` qui passent le test mais ne match jamais en prod. |

### 🟠 Élevés (à fixer avant prochaine release)

| ID | Catégorie | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|
| **H-01** | Permissions driftées | 21 permissions seedées en DB mais absentes du union TS `PermissionCode`. Force `as never` dans tout le module purchasing (12+ occurrences) + reports + accounting. Le typing perd la sécurité statique des perms. | `packages/supabase/src/rls/permissions.ts:14-120` | Ajouter au union TS : `accounting.period.close`, `accounting.post`, `accounting.reverse`, `audit_log.read`, `cash_register.adjust`, `cash_register.close`, `cash_register.open`, `cash_register.read`, `display.manage`, `display.read`, `inventory.recipes.update`, `kds.operate`, `kiosk.issue`, `payments.process`, `purchasing.po.cancel`, `purchasing.po.create`, `purchasing.po.read`, `purchasing.po.receive`, `sales.create`, `sales.discount`, `waiter`. Supprimer tous les `as never` correspondants après. |
| **H-02** | Type bypass | 4 hooks BO/POS utilisent `.from('TABLE' as any)` sur des tables présentes dans `types.generated.ts` (`stock_lots`, `view_product_allergens_resolved`, `lan_devices`, `print_queue`). Bypass typing inutile = legacy code avant regen. Risque masqué si une colonne est renommée plus tard. | `apps/backoffice/src/features/inventory/hooks/useStockLots.ts:53`<br>`apps/pos/src/features/products/hooks/useActiveLotsByProduct.ts:31`<br>`apps/backoffice/src/features/products/hooks/useProductAllergens.ts:33,59`<br>`apps/pos/src/features/products/hooks/useProductAllergens.ts:27`<br>`apps/backoffice/src/features/products/hooks/useResolvedAllergensMap.ts:22`<br>`apps/backoffice/src/features/lan-devices/hooks/useLanDevices.ts:33`<br>`apps/backoffice/src/features/print-queue/hooks/usePrintQueue.ts:43` | Supprimer les `as any` ; le typing fonctionne. Pour les vues `view_*` PostgREST traite comme tables read-only — l'accès `.from('view_X')` est typé correctement. |

### 🟡 Moyens (backlog post-S30)

| ID | Catégorie | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|
| **M-01** | Perms défensives manquantes | `users.create` et `users.update` utilisées dans `init_rls.sql` policies et 4 RPCs (`create_user_v1`, `update_user_role_v1`, `delete_user_v1`, `update_user_profile_v1`) mais seedées **uniquement** dans `supabase/seed.sql:29-30`. Sur CI Docker reset (qui run migrations puis seed.sql), OK. Mais le commentaire `20260517000200_create_user_rpcs.sql:31` ment : "already seeded in 000030" — le bloc défensif `000030` ne contient PAS ces 2 perms (vérifié lignes 84-130). Risque : reset CI partiel ou migration manuelle hors seed.sql → `has_permission(uid, 'users.create')` retourne FALSE même pour ADMIN, RPC RAISE 42501. | `supabase/migrations/20260517000030_refactor_has_permission.sql:84-130` (bloc défensif Section 1.6) | Ajouter dans la liste défensive : `('users.create', 'users', 'create', 'Créer un utilisateur')` et `('users.update', 'users', 'update', 'Modifier un utilisateur')`. Conserver `seed.sql` pour idempotence (ON CONFLICT DO NOTHING). |
| **M-02** | Vue dépréciée | 3 fichiers tests Vitest lisent encore `audit_log` (singulier — vue compat dépréciée depuis S13 `_20260517000034`). DoD du commit disait "grep returns 0 hits". | `supabase/tests/functions/adjust-stock.test.ts:111`<br>`supabase/tests/functions/inventory-concurrent.test.ts:124`<br>`supabase/tests/functions/loyalty-rls.test.ts:113` | Remplacer `.from('audit_log')` → `.from('audit_logs')` + colonnes `actor_profile_id`→`actor_id`, `subject_table`→`entity_type`, `subject_id`→`entity_id`, `payload`→`metadata`, `occurred_at`→`created_at`. |
| **M-03** | REVOKE defense-in-depth manquant | 71 RPCs `SECURITY DEFINER` n'ont pas de `REVOKE EXECUTE ... FROM anon/PUBLIC` explicite par-RPC. Sécurisées en pratique via le sweep global `20260524000031_fix_revoke_public_execute_from_public_functions.sql` (`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC` + `ALTER DEFAULT PRIVILEGES`). Mais le pattern S25 canonique demande aussi un REVOKE par-RPC dans les migrations Création (defense-in-depth, plus traçable). | Migrations : `20260507000003_create_tablet_order_rpc.sql`, `20260507000005_pay_existing_order_rpc.sql`, `20260512000008..010` (refund/void/cancel_item), `20260516000006..010` (record/adjust/receive/waste/get), `20260517000200_create_user_rpcs.sql`, etc. | Optionnel : adopter le pattern S25 (`_012` + `_013` corrective) pour toutes les futures RPCs. Pas urgent — sécurité OK. |
| **M-04** | RPC orpheline déférée wired | 5 RPCs (`update_cost_price_v1`, `adjust_b2b_balance_v1`, `set_product_units_v1`, `set_product_sections_v1`, `upsert_product_modifiers_v1`) dans `types.generated.ts` mais jamais appelées en code app. Documentées comme "scope déferé S27c" dans CLAUDE.md. | (Pas un bug, juste backlog visibility) | Tracker dans S27c / backlog produit. |
| **M-05** | Compteur CLAUDE.md désynchronisé | CLAUDE.md déclare "285 migrations" mais le compte réel est 312. Différentiel : 27 migrations ajoutées entre la dernière update et maintenant (cohérent avec S25/S27/S27b qui ont ajouté ~24 migrations). | `CLAUDE.md` § "Scope d'audit" header | Update CLAUDE.md mention "312 migrations" lors du prochain refresh. Aucun impact technique. |

### 🟢 Bas (info)

| ID | Catégorie | Finding | Fichier:ligne | Remediation |
|---|---|---|---|---|
| **L-01** | RPCs internes orphelines | 17 RPCs préfixées `_` (helpers internes) ou `tr_*`/`enforce_*`/`audit_log_*` (triggers) sont déclarées et utilisées en interne — pas un drift. Audit confirme la cohérence. | — | Aucune. |
| **L-02** | Tables shippées sans UI | 16 tables présentes dans types + DB mais jamais lues en code app : `cash_movements`, `discount_templates`, `display_screens`, `edge_function_rate_limits`, `goods_receipt_notes`, `journal_entry_sequences`, `kiosk_jwt_signing_keys`, `notification_templates`, `order_sequences`, `product_sections`, `product_unit_alternatives`, `product_unit_contexts`, `production_batches`, `refund_sequences`, `stock_locations`, `unit_conversions`. Plusieurs sont des séquences/règles internes (`*_sequences`, `*_idempotency_keys`) consommées via RPC. Les autres sont des features déférées (display screens, kiosk JWT signing keys, production batches). | — | Aucune urgence. À revoir lors de l'audit Vague 2 (Edge Functions) pour confirmer la consommation côté EF. |
| **L-03** | `b2b_payments.idempotency_key` UNIQUE | Vérifié : `b2b_payments.idempotency_key string\|null` — UNIQUE constraint via `record_b2b_payment_v1` RPC. Conforme S24 doc. | `packages/supabase/src/types.generated.ts:141-186` | OK. |
| **L-04** | Pattern de pol nullité `null \|\| ''` | Spot check 0 occurrence sur les FKs UUID des tables clés (`orders.customer_id`, `order_items.product_id`, etc.). Le pattern dangereux `field: x \|\| ''` n'a pas été trouvé sur les colonnes UUID NOT NULL. | — | OK. |

## Détails par catégorie

### 1. RPCs orphelines (52 total après filtrage)

Réparties en sous-catégories :

**1.A — Helpers internes (préfixe `_`) appelés en SQL via PERFORM/SELECT** (8) — **PAS un drift** :
- `_calculate_recipe_cost_walk` (1 réf SQL — appelée par `calculate_recipe_cost_v1`)
- `_snapshot_recipe_version` (2 réf SQL — triggers cost cascade S17)
- `_notif_substitute`, `_resolve_fifo_lot`, `_revoke_user_sessions_v1` (helpers privés, scope déféré)

**1.B — RPCs utilisées par cron jobs uniquement** (5) :
- `refresh_mv_sales_daily`, `refresh_mv_stock_variance`, `refresh_mv_pl_monthly` (cron MV refresh `_20260517000071`)
- `notify_birthday_customers_v1` (cron `_20260517000222`)
- `recompute_recipe_margins_v1` (cron `_20260519000142`)
- `mark_expired_lots_hourly` (cron — listé dans tests Vitest, donc compté ailleurs)
- `release_expired_reservations` (cron — listé dans tests Vitest, donc compté ailleurs)

**1.C — Helpers SQL appelés en interne dans d'autres RPCs** (10) :
- `check_fiscal_period_open` (10 réf SQL — utilisée par tous les flows accounting)
- `record_stock_movement_v1` (6 réf SQL — primitive ledger)
- `get_current_profile_id`, `get_current_role`, `has_kiosk_jwt`, `has_permission_for_profile`, `is_authenticated` (helpers RLS)
- `round_idr`, `convert_quantity`, `resolve_mapping_account` (utility functions)
- `audit_log_insert_trigger` (déjà compté dans triggers)

**1.D — Sequence helpers** (4) :
- `next_count_number`, `next_expense_number`, `next_journal_entry_number`, `next_transfer_number` — toutes appelées en SQL `nextval()` like par les RPCs métier correspondantes.

**1.E — RPCs Opname (inventory)** wired backend, UI non shipped (5) :
- `add_opname_item_v1`, `cancel_opname_v1`, `create_opname_v1`, `finalize_opname_v1`, `set_opname_count_v1`, `validate_opname_v1`
- Documentées comme feature `inventory.opname.*` — perms seedées mais UI déférée.

**1.F — RPCs scope déféré S27c** (5) — voir M-04.

**1.G — RPCs Print Queue / LAN** (4) :
- `cancel_print_job_v1`, `claim_print_job_v1`, `mark_print_done_v1`, `mark_print_failed_v1` — wired RPC, UI BO `print-queue` lit la table mais ne call pas ces RPCs (le claim/mark se font sans doute via LAN hub Edge ou pas encore wired).

**1.H — RPCs vraiment dormantes** (11) — candidats à supprimer ou à wirer :
- `calculate_vat_payable`, `cash_flow_v1` (vs `get_cash_flow_v1` qui est wired — confusion ?), `get_balance_sheet_data`, `get_low_stock_v1`, `get_movement_aggregates_v1`, `get_product_dashboard_v1`, `get_reorder_suggestions_v1`, `get_stock_movements_v1`, `pick_notifications_batch_v1`, `storage_path_to_expense_id`, `update_role_session_timeout_v1` (S19 mais UI peut-être pas câblée), `update_user_profile_v1` (RPC S13 — vérifier wiring user edit page), `validate_b2b_credit_limit_v1` (S14/S24 — appelée en interne par `create_b2b_order_v1` ? à vérifier).

Action recommandée : trier 1.H au prochain audit modulaire (Vague 3 ou 4).

### 2. RPCs fantômes (0 trouvée — green light)

Le grep initial a fait apparaître 5 noms (`add_one_each`, `echo`, `function_a`, `hello_world`, `list_stored_countries`) — vérification croisée : tous viennent exclusivement des fichiers `node_modules/.vite/deps/@supabase_supabase-js.js` (bundle examples Supabase doc). **0 vraie RPC fantôme dans le code Breakery**.

### 3. Colonnes fantômes (1 Critique trouvée — voir C-01)

- **`order_items.name`** (n'existe pas — la col est `name_snapshot`) : `apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts:31`
- Vérifié OK : `orders.{id, order_number, total, status, created_at, customer_id, paid_at, table_number, order_type, sent_to_kitchen_at, void_reason, voided_at, voided_by, customer_id, waiter_id, tax_amount, paid_at, created_via, idempotency_key, session_id}`
- Vérifié OK : `customers.{id, name, phone, email, customer_type, loyalty_points, lifetime_points, total_spent, total_visits, last_visit_at, category_id, b2b_credit_limit, b2b_current_balance}`
- Vérifié OK : `customer_categories.{id, name, slug, color, icon, price_modifier_type, discount_percentage, loyalty_enabled, points_multiplier, is_default}`
- Vérifié OK : `products.{sku, name, unit}` consulté via `usePurchaseOrderDetail.ts:37`
- Vérifié OK : `order_items.{id, product_id, name_snapshot, quantity, line_total, is_cancelled, kitchen_status}` consulté via `useOrderDetail.ts:104`

**Limite** : seules les 6 tables les plus consultées ont été scannées exhaustivement. Pour aller plus loin, recommander un linter `supabase-lint` ou `@supabase/postgres-meta` cross-check en CI.

### 4. Enums driftés (1 Critique trouvée — voir C-02)

Tous les 14 enums Postgres sont parfaitement synchronisés entre les `CREATE TYPE`/`ALTER TYPE ADD VALUE` SQL et le bloc `Constants.public.Enums` de `types.generated.ts`. Le seul drift est entre les **littéraux string codés en dur dans le code TS** et les valeurs DB :

| Enum DB | Drift |
|---|---|
| `order_type` | `'take_away'` utilisé 3× dans `apps/pos/src/features/display/` — enum DB a `take_out`. Bug C-02. |
| Tous les autres | OK |

Le pattern `as Database["public"]["Enums"]["X"]` est utilisé 14 fois (1 par enum) — typing correct.

### 5. Types regen drift (signaux indirects)

| Pattern | Count | Localisation | Sévérité |
|---|---|---|---|
| `as any` near supabase calls | 10 | Voir H-02 + `useCreateB2bOrder.ts:120` (`rpcArgs as any`) + `useExpiringLots.ts:71` (`(supabase as any).rpc('get_expiring_lots_v1', args)`) | Élevé/Moyen |
| `as never` | 12 dans purchasing + 4 dans expenses + 3 dans inventory-production + 2 dans settings | Voir H-01 (permissions) + 3 RPC args (`create_expense_v1`, `approve_expense_v1`, `pay_expense_v1`) qui suggèrent que les types `args` sont mal inférés (sans doute par Supabase Functions args complexes) | Moyen |
| `as unknown as never` | 2 dans `useRecordBatchProduction.ts:117-118` (`p_batch`, `p_items`) | RPC args jsonb pré-build — typing fragile | Bas |
| `as unknown as TabletOrderItemRow[]` | 1 dans `useMyTabletOrders.ts:43` | Cf C-01 — masque le bug `name` | Critique (déjà couvert) |

**Cause probable des `as never` sur RPC args** : Supabase TypeScript codegen retourne `never` pour un arg dont les types ne matchent pas, ou pour un RPC avec params optionnels mal typés. À investiguer avec un regen + comparaison stricte.

### 6. Monotonie migrations — RAS

- **312 migrations**, **312 timestamps uniques**, **0 doublon**.
- Ordre lexical = ordre naturel (`sort` = `sort -n` strict).
- Numérotation discontinue volontaire : ranges utilisés par séquence de sessions (cf CLAUDE.md "Migration sequence active"). Pas un gap suspect.

### 7. REVOKE EXECUTE coverage (Moyen — voir M-03)

- **139 statements `REVOKE EXECUTE`** dans 72 migrations.
- **72 RPCs uniques** ont au moins un REVOKE explicite (anon, PUBLIC, ou les deux).
- **71 RPCs SECURITY DEFINER** n'ont PAS de REVOKE par-RPC explicite. Mais le **sweep global** `_20260524000031` couvre toutes les fonctions du schéma `public` (`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC` + `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`).
- **Sécurité runtime** : OK — anon n'a pas EXECUTE sur ces 71 RPCs grâce au sweep.
- **Defense-in-depth** : Manquante — si une future migration recreée une fonction sans REVOKE explicite ET sans le sweep réappliqué, l'anon pourrait récupérer EXECUTE par défaut (sauf si `ALTER DEFAULT PRIVILEGES` ne re-grant pas — ce qui est le cas grâce au sweep S20).
- **Recommandation** : adopter systématiquement le pattern S25 (REVOKE pair `_012` + `_013` corrective) pour les nouvelles RPCs SECURITY DEFINER. Pas urgent.

## Annexes

### A1 : Liste des 165 RPCs avec statut

Stockée dans `/tmp/rpcs_declared.txt`, `/tmp/rpcs_called.txt`, `/tmp/rpcs_called_tests.txt`, `/tmp/trigger_funcs.txt`, `/tmp/rpcs_truly_orphan.txt` (à régénérer en local — non commit). Synthèse :

| Statut | Count | Notes |
|---|---|---|
| Wired apps/** (UI) | 80 | Code-path UI direct |
| Wired packages/** | 0 | (Pas de SDK domain qui call RPC) |
| Wired supabase/functions/** | 9 | Toutes EFs |
| Wired tests Vitest/pgTAP | 67 | Coverage tests |
| Used via EXECUTE FUNCTION (triggers) | 16 | Triggers OK |
| Used via cron.schedule | 5 | Cron jobs |
| Used via SQL PERFORM/SELECT in RPC body | 10 | Helpers internes |
| **Vraiment orphelin / dormant** | **11** | Cf §1.H — à trier en backlog |

### A2 : Diff suggéré pour `packages/supabase/src/rls/permissions.ts`

```diff
 export type PermissionCode =
   // ... existing ...
+  // Purchasing (session 17 — module 03)
+  | 'purchasing.po.read'
+  | 'purchasing.po.create'
+  | 'purchasing.po.receive'
+  | 'purchasing.po.cancel'
+  // Accounting (session 13 — module 10, extended in S17)
+  | 'accounting.post'
+  | 'accounting.reverse'
+  | 'accounting.period.close'
+  // Cash register (session 13 G4)
+  | 'cash_register.read'
+  | 'cash_register.open'
+  | 'cash_register.close'
+  | 'cash_register.adjust'
+  // Display (customer display screens)
+  | 'display.read'
+  | 'display.manage'
+  // Inventory recipes
+  | 'inventory.recipes.update'
+  // KDS + kiosk + payments + sales
+  | 'kds.operate'
+  | 'kiosk.issue'
+  | 'payments.process'
+  | 'sales.create'
+  | 'sales.discount'
+  // Misc
+  | 'audit_log.read'
+  | 'waiter';
```

Puis grep & remove `as never` :
```bash
rg "as never" apps/backoffice/src/ apps/pos/src/ --type ts --type tsx
```

### A3 : Migrations correctives proposées

**Migration `20260520150000_fix_users_perms_defensive_seed.sql`** (corrige M-01) :
```sql
-- Patch M-01 audit Vague 1 : users.create + users.update sont seedées en seed.sql uniquement.
-- Reseed défensif pour CI Docker reset (seed.sql ne run pas sur tous les flows).
INSERT INTO permissions (code, module, action, description) VALUES
  ('users.create', 'users', 'create', 'Créer un utilisateur'),
  ('users.update', 'users', 'update', 'Modifier un utilisateur')
ON CONFLICT (code) DO NOTHING;

-- Et reseed des role_permissions pour SUPER_ADMIN + ADMIN (idempotent ON CONFLICT)
INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT 'SUPER_ADMIN', code, TRUE FROM permissions
 WHERE code IN ('users.create', 'users.update')
ON CONFLICT (role_code, permission_code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
SELECT 'ADMIN', code, TRUE FROM permissions
 WHERE code IN ('users.create', 'users.update')
ON CONFLICT (role_code, permission_code) DO NOTHING;
```

**Fix code C-01** (1 fichier) :
```diff
-// apps/pos/src/features/tablet/hooks/useMyTabletOrders.ts
 interface TabletOrderItemRow {
   id: string;
-  name: string;
+  name_snapshot: string;
   quantity: number;
   kitchen_status: string;
 }
 // ...
-      .select('id, order_number, table_number, order_type, status, sent_to_kitchen_at, order_items(id, name, quantity, kitchen_status)')
+      .select('id, order_number, table_number, order_type, status, sent_to_kitchen_at, order_items(id, name_snapshot, quantity, kitchen_status)')
```
+ ajuster le consommateur UI pour utiliser `item.name_snapshot`.

**Fix code C-02** (3 fichiers) :
```bash
# CurrentOrderCard.tsx:55 — OrderQueueTicker.tsx:33 — OrderQueueTicker.test.tsx:48
# replace 'take_away' → 'take_out'
```

## Méthodologie complémentaire pour Vagues 2-6

Pour la **Vague 2** (Edge Functions audit) : focus sur les 11 EFs + helper `_shared/idempotency.ts`. Vérifier :
- Tous les EFs idempotent reads/writes utilisent bien le helper
- `auth-verify-pin`, `auth-change-pin`, `kiosk-issue-jwt` : JWT signing key rotation (table `kiosk_jwt_signing_keys` jamais lue côté code app — vérifier EF)
- `refund-order` v7 : confirmer le hard cutover header `x-manager-pin` documenté
- `notification-dispatch` : confirmer la consommation des templates

Pour la **Vague 5** (Tests coverage) : croiser les 67 RPCs testées avec les 165 déclarées → seulement **40% des RPCs ont une couverture tests directe**. Identifier les 98 RPCs sans test.

---

**Rapport généré par** : agent Vague 1 + skill `anthropic-skills:db-schema-audit`
**Working directory** : `C:\Users\guich\a trier\The_Breakery_ERP`
**Prochaine étape** : feu vert pour Vague 2. Les 2 Critiques C-01 et C-02 sont des fixes < 5 min chacun à exécuter en fast-follow ou intégrer dans la prochaine session S28.
