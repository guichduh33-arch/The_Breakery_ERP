# Audit de divergence — `docs/reference/04-modules/` vs état réel du projet (S57)

> **Date :** 2026-07-03 · **Méthode :** 7 auditeurs parallèles read-only, chaque affirmation vérifiable des fiches (RPCs, tables, colonnes, EFs, chemins, permissions, flux) confrontée au ground truth du repo (`supabase/migrations/`, `supabase/functions/`, `apps/*/src`, `packages/*/src`, types générés).
> **Limite :** vérification contre les migrations sur disque + code, pas contre le cloud live (les subagents n'ont pas accès au MCP Supabase). La version la plus haute de chaque RPC par nom a été retenue.
> **Sévérités :** 🔴 contredit activement le code (suivre la fiche = casse) · 🟠 périmé/incomplet, prête à confusion · 🟡 cosmétique.

---

## 1. Synthèse

**Constat racine : les 20 fiches portent toutes `Last verified: 2026-05-13` (~S13) ; le projet est à S57.** Sept semaines et ~44 sessions de dérive non répercutées. Seul `00-modules-index.md` a été retouché (2026-06-12) — et il s'auto-déclare honnêtement « catalogue V2 historique ».

**Aucune des 20 fiches n'a une Partie II (référence technique) fiable.** Les Parties I (vue fonctionnelle/métier) restent globalement utilisables sur ~15 fiches. Quatre causes systémiques expliquent la quasi-totalité des divergences :

1. **Migration V2 monolithe → V3 monorepo non répercutée.** Toutes les fiches citent des chemins `src/{hooks,services,components,pages}/…` qui n'existent plus. Le code réel vit sous `apps/{pos,backoffice}/src/features/<module>/` et `packages/*/src`. **Aucun chemin de fichier cité dans les 20 fiches n'est valide.**
2. **RPC-ification + versioning non répercutés.** Les fiches décrivent des inserts/updates directs client, des moteurs TS côté client (`accountingEngine.ts`, `promotionEngine.ts`, `arService.allocateFIFO`) et des RPCs sous leurs noms S13. Réalité : tout écrit via RPCs SECURITY DEFINER versionnés (`_vN`), moteurs migrés en SQL (triggers `tr_20_je_emit`, helpers `_resolve_*`), money-path `complete_order_with_payment_v17` via EF `process-payment`.
3. **Durcissement sécurité S50→S57 absent.** Gates `has_permission` sur les rapports, REVOKE anon/PUBLIC, PIN en header/nonce (`discount_authorizations`), idempotency 2-flavors, plafonds promo atomiques — rien n'est documenté.
4. **Pivots d'architecture inversés.** LAN hub/client → Supabase Realtime (KDS/display/tablette) ; moteur promo client → serveur ; et des features décrites « absentes » qui existent (lots/FEFO, Z-report, sous-recettes, versioning recettes, offline tablette) tandis que des features décrites en détail n'existent pas (mobile shell, retours/QC achats, price-lists B2B, carrousel display, pages VAT/CALK/Bank Rec).

**Comptage des divergences relevées :** ~60 🔴, ~55 🟠, ~12 🟡 sur 21 fichiers.

**Point de risque immédiat :** `CLAUDE.md` déclare `docs/reference/04-modules/` comme « Module reference (canonical) ». Tant que les fiches ne sont pas corrigées, cette ligne oriente chaque session vers une documentation qui contredit le code.

### Classement des fiches par fiabilité résiduelle

| Fiche | Partie I (métier) | Partie II (technique) | Divergence la plus grave |
|---|---|---|---|
| 18-mobile-shell | ❌ fantôme | ❌ fantôme | **Module entièrement inexistant** (aucun fichier, 0 grep Capacitor/MobileLayout) |
| 07-purchasing-suppliers | 🟠 promet des features inexistantes | ❌ | 5 tables fictives (returns/history/attachments/pricing), state machine fausse, modèle GRN absent |
| 09-b2b-wholesale | 🟠 | ❌ | 6 tables `b2b_*` fictives, FIFO client → allocations serveur S52 |
| 13-promotions-discounts | 🟠 | ❌ | Moteur « 100 % client » → tout serveur (`evaluate_promotions_v2`), table `promotion_usage` fictive |
| 04-kds-kitchen | 🟠 | ❌ | « Temps réel via LAN, pas de Realtime » : **inversé** ; inventaire de fichiers inexistant |
| 16-display-customer | 🟠 | ❌ | Canal/messages LAN fictifs, mode Idle/carrousel inexistant, `payment_complete` (S57) absent |
| 01-auth-permissions | 🟠 | ❌ | RBAC M:N fictif (mono-rôle réel), catalogue permissions faux, 4 EFs fictives |
| 12-cash-register-shift | ✅ | ❌ | Martèle « pas de JE auto à la clôture » — **inverse de la réalité** (JE variance auto) ; Z-report absent |
| 03-payments-split | ✅ | ❌ | RPC mal nommée + `SECURITY INVOKER` faux + `complete_order_as_outstanding` fictive |
| 02-pos-cart-orders | ✅ | ❌ | Money-path fausse (nom, signature, appel direct vs EF) |
| 02b-orders | ✅ | ❌ (stub assumé) | Query client `.limit(500)` vs `get_orders_list_v2` curseur serveur |
| 05-products-categories | ✅ | ❌ | Schéma combos faux, table `product_uoms` fictive, signature pricing fausse |
| 06-inventory-stock | ✅ | ❌ | Inserts directs vs RPC-only ; « pas de lots » alors que `stock_lots` existe |
| 14-reports-analytics | ✅ | ❌ | Architecture config-driven + EF `calculate-daily-report` fictives ; RPCs `_data` → `_vN` gatés |
| 15-production-recipes | ✅ | ❌ | Inserts client vs `record_production_v1` atomique ; « ne supporte pas » sous-recettes/versioning : faux |
| 09→ 08-customers-loyalty | ✅ | ❌ | RPCs `add/redeem_loyalty_points` fictives |
| 11-expenses | ✅ | 🟠 | `approve_expense_with_journal` disparue → chaîne multi-étapes seuils/SOD/PIN |
| 10-accounting-double-entry | ✅ | 🟠 | `accountingEngine.ts` fictif, RPCs `_data` → `_v2/_v3`, pages VAT/CALK/BankRec inexistantes |
| 17-tablet-ordering | ✅ | 🟠→❌ | INSERT brut vs `create_tablet_order_v2` idempotent ; LAN → Realtime |
| 19-settings-configuration | ✅ | 🟠 | ~24 routes décrites vs 9 réelles ; RPC `update_role_permissions` fictive |
| 00-modules-index | ✅ (disclaimer honnête) | 🟡 | Colonne « Doc » = TBD pour des fiches qui existent ; volumes datés (16 EF vs 14 réelles) |

---

## 2. Inventaire

21 fichiers sous `docs/reference/04-modules/` (~15 000 lignes). 20 fiches datées du 2026-05-13 (fiche 03 : contenu auto-daté 2026-05-03), index retouché 2026-06-12. Numérotation V3 : 01→19 + 02b + 00-index. Toutes classées **canonical reference / stale** au sens du doc-map (zone « evergreen, kept current » — le contrat de la zone n'est plus tenu).

---

## 3. Constats détaillés par fiche

### 3.1 · 01-auth-permissions.md — RBAC décrit ≠ RBAC réel

La fiche décrit un modèle multi-rôles M:N qui n'existe pas ; le code réel est mono-rôle.

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| Tables `user_roles` M:N + `is_primary`, multi-rôles | Mono-rôle : `user_profiles.role_code TEXT REFERENCES roles(code)` ; aucune table `user_roles` (`20260503000001_init_auth.sql:29`) | 🔴 |
| Garde `user_has_permission(uid,code)` | S'appelle `has_permission(p_uid,p_perm)` (+ `has_permission_for_profile`) (`20260517000030:295`) | 🔴 |
| EFs `auth-user-management`, `set-user-pin`, `create-admin-user`, `list-auth-users` | **Aucune n'existe.** CRUD = RPCs `create_user_v1`/`update_user_role_v1`/`delete_user_v1`/`update_user_profile_v1`/`reset_user_pin_v1` (`20260517000200`) | 🔴 |
| RPC `update_role_permissions(p_role_id, p_permission_ids[])` | N'existe pas ; matrice = table `role_permissions(role_code,permission_code)` | 🔴 |
| `roles` : id, name_fr/en/id, `hierarchy_level` 10-100 | PK = `code` TEXT ; ni id, ni hierarchy_level, ni name_* (`init_auth.sql:5-11`) | 🔴 |
| `permissions.is_sensitive` (re-PIN) | Colonne inexistante | 🔴 |
| `user_profiles` : first/last/display_name, phone, email, timezone… | Réel : `full_name`, employee_code, pin_hash, role_code, lockout, deleted_at (`init_auth.sql:23-37`) | 🔴 |
| `audit_logs` : user_id/module/table_name/old_values/new_values/severity | Réel : actor_id/action/entity_type/entity_id/metadata (S56) | 🔴 |
| Catalogue permissions (sales.view, users.roles, settings.network…) | Catalogue réel : pos.sale.void/refund, sales.discount, inventory.read/waste, accounting.read/post/…, rbac.read/update… (`20260517000030:84-180`). La plupart des codes de la fiche n'existent pas | 🔴 |
| Rôles seedés owner/admin/manager/cashier/waiter/barista/kitchen/accountant/stockman | Réel : SUPER_ADMIN/ADMIN/MANAGER/CASHIER/waiter | 🟠 |
| Overrides `user_permissions` PK (user_id,permission_id) | `user_permission_overrides` PK (user_profile_id,permission_code) + is_granted/expires_at (DENY>role>GRANT) | 🟠 |
| Routes `/users`, `/settings/roles`, `/settings/audit` | `/backoffice/users*`, `/backoffice/settings/permissions` ; audit sous Reports (`routes/index.tsx:612-636,932`) | 🟠 |

**Toujours exact :** PIN bcrypt + lockout, soft-delete, protection last-admin (`LAST_ADMIN_PROTECTED`), révocation sessions au changement de rôle, EFs `auth-verify-pin`/`auth-get-session`/`auth-change-pin`/`auth-logout`, audit append-only.
**Manques :** `verify-manager-pin`, `kiosk-issue-jwt`, nonce `discount_authorizations` (S55), `expires_at` des overrides.
**Verdict : non fiable — à réécrire** (presque chaque table/RPC/EF/permission contredite).

### 3.2 · 02-pos-cart-orders.md — money-path fausse

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| RPC `complete_order_with_payments` (pluriel) appelée directement par le front | `complete_order_with_payment_v17` via **EF `process-payment`** uniquement (`supabase/functions/process-payment/index.ts:265`) | 🔴 |
| Signature `(p_order_id, p_payments[], p_staff_id, p_session_id)` — order pré-créé | v17 : l'order est **créé dans la RPC** depuis `p_items` (+ discount nonce, promotions…) | 🔴 |
| Void/refund = boutons front sans idempotency | EFs `void-order`/`refund-order`/`cancel-item` → `void_order_rpc_v4`/`refund_order_rpc_v2`/`cancel_order_item_rpc_v3`, idempotency replay + `x-manager-pin` (S55) (`useVoidOrder.ts:43-46`) | 🔴 |
| EFs `send-to-printer`, `generate-invoice` | **Inexistantes** (14 EF réelles, aucune des deux) | 🔴 |
| Arbo `src/hooks/pos/*`, `orderService.ts`, `POSMainPage.tsx` | Monorepo `apps/pos/src/features/{payment,cart,order-history,kds,discounts}/` (Glob = 0 sur les chemins fiche) | 🔴 |
| PIN discount validé côté SQL/panier | PIN vérifié in-EF → nonce single-use `discount_authorizations` consommé par v17 (`process-payment/index.ts:218-263`) | 🟠 |
| Taux taxe 10 % hardcodé client | `useTaxRate()` lit `business_config.tax_rate` ; POS consomme `lines[]`/`tax_amount` serveur (S51) | 🟠 |

**Toujours exact :** Partie I fidèle (zones d'écran, verrou post-cuisine PIN, held orders, split, ardoise, 4 canaux realtime) ; `cartStore`/`paymentStore` existent.
**Manques :** `_resolve_line_price_v1` (S51), `_resolve_combo_price_v1` (S57), plafonds promo, idempotency 2-flavors, broadcast `payment_complete`.
**Verdict : Partie I utilisable, Partie II dangereuse — à réécrire.**

### 3.3 · 02b-orders.md — stub jamais consolidé

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| Liste = query directe `orders` + `.limit(500)` + filtres client | RPC `get_orders_list_v2` : curseur serveur + filtres JSONB (status, type, refund_status, hour, terminal_id, payment_method) (`useOrdersList.ts:66-84`) | 🔴 |
| RPCs `void_order`, `refund_order`, `mark_order_paid`, `relink_order_customer` | Aucune n'existe ; void/refund via EFs (`useVoidOrder.ts:34`) | 🔴 |
| Chemins `src/pages/Orders.tsx` etc. (marqué TODO) | `apps/backoffice/src/pages/orders/OrdersListPage.tsx` + `features/orders/hooks/` | 🟠 |
| Realtime via `useKdsStatusListener` | Hook BO réel : `useOrdersRealtime.ts` | 🟠 |
| Table `order_activity_log` | Surface d'audit = `audit_logs` uniquement (S56) | 🟠 |

**Verdict : Partie II explicitement un stub, largement fausse. Ne pas utiliser comme référence technique.**

### 3.4 · 03-payments-split.md — la plus ancienne (2026-05-03)

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| `complete_order_with_payments(p_order_id,…)` via `orderService` | v17 via EF `process-payment`, hook `useCheckout` (`useCheckout.ts:220-290`) | 🔴 |
| RPC `SECURITY INVOKER`, RLS du caller | v17 **SECURITY DEFINER** + GRANT authenticated ; sécurité par gates+REVOKE (`20260710000092`) | 🔴 |
| RPC `complete_order_as_outstanding` (Pay Later) | Inexistante ; ardoise via money-path + `get_pos_b2b_debts_v3` | 🔴 |
| Arbo `src/services/payment/*`, `PaymentModal.tsx`, `usePaymentProcessing` | `apps/pos/src/features/payment/{PaymentTerminal,SuccessModal,hooks/useCheckout,split/SplitPaymentFlow}` | 🔴 |
| `SplitByItemModal` + `splitItemStore` | `features/payment/split/` : `SplitPaymentFlow`, `ModeSelectStep`, `PayerCountStep`, `ItemAssignStep`, `PerPayerCashStep` | 🟠 |
| Split « ferme » un order pré-créé | v17 crée l'order ; seul pickup/tablette paye un order persisté via `pay_existing_order_v11` | 🟠 |

**Toujours exact :** sémantique du split (N `order_payments`, tolérance ~1 IDR, couverture 100 %, anti-double-clic, cash drawer).
**Verdict : la plus périmée du groupe POS — à réécrire avant tout usage technique.**

### 3.5 · 04-kds-kitchen.md — architecture inversée (LAN → Realtime)

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| « Temps réel via LAN ; pas de Realtime Supabase côté KDS » | **Inversé** : `useKdsRealtime` s'abonne à `postgres_changes` sur `order_items` filtré `dispatch_station` (`useKdsRealtime.ts:54-78`) + refetch 30 s ; LAN = mesh secondaire | 🔴 |
| Statut = `order_items.item_status` (new/preparing/ready/served/cancelled) | Colonne réelle **`kitchen_status`** (pending/preparing/ready) + `is_locked`/`sent_to_kitchen_at`/`ready_at` ; `served` via RPC `mark_item_served` | 🔴 |
| Updates directes `order_items.update(...)` | RPCs idempotents `kds_bump_item_v1`, `mark_item_served`, recall/undo (`20260517000151`) | 🔴 |
| Hooks/services/composants (KDSMainPage, KdsSoundService, useKdsOrderQueue…) | **Aucun n'existe.** Réel : `KdsBoard`, `KdsOrderCard`, `BumpButton`/`RecallButton`/`UndoBumpToast`, `useKdsOrders`/`useKdsBumpItem`/`useKioskAuth`… | 🔴 |
| « Pas de store dédié » ; routes `/kds` + `/kds/:station` | Store Zustand `kdsStore` ; route unique `/kds` (`routes/index.tsx:72-76`) | 🟠 |
| Routage par `categories.dispatch_station` (singulier) | Multi-station : array `order_items.dispatch_stations` + `resolve_dispatch_stations_v1` (Spec B-1, `20260710000041/042`) | 🟠 |
| Moteur sonore + boucle d'alerte urgente | Introuvables ; urgence purement visuelle | 🟠 |

**Toujours exact :** archivage client ~5 min des items ready, seuil urgence ~600 s, tri FIFO.
**Verdict : Partie II entièrement fausse — la plus dangereuse du groupe. À réécrire.**

### 3.6 · 05-products-categories.md — combos/UOM/pricing faux

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| `get_customer_product_price(product_id, category_slug)` | Signature réelle `(p_product_id UUID, p_customer_id UUID DEFAULT NULL)` (`20260509000006`) | 🔴 |
| Combos = `product_combos`/`product_combo_groups`/`product_combo_group_items` | Combo = `products.product_type='combo'` + `combo_groups`/`combo_group_options` (`20260704000010`) | 🔴 |
| « Pas de RPC combo — 3 inserts client » | `upsert_combo_v1` existe (`20260704000011`) | 🔴 |
| Table `product_uoms` | Inexistante ; UOM = `product_unit_alternatives` + `product_unit_contexts` + registre `units` | 🔴 |
| « Pas de table variants » (JSONB modifiers seul) | Architecture linked-products : `create_variant_v1`, `convert_product_to_parent_v1` (`20260524003433`) | 🟠 |
| Flag `deduct_ingredients` | Flags canoniques `deduct_stock` + `track_inventory` | 🟠 |
| Import client upsert direct | RPCs `import_catalog_v1`/`export_catalog_v1` (`20260625000011/12`) | 🟡 |

**Manques :** `is_display_item` + display-stock, registre unités, allergènes admin.
**Verdict : Partie II périmée sur ses points porteurs.**

### 3.7 · 06-inventory-stock.md — write-path et lots périmés

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| Hooks insèrent direct dans `stock_movements` | Append-only + REVOKE ; écritures via RPCs SECURITY DEFINER (`record_stock_movement_v1`, `adjust_stock_v1`, `waste_stock_v1`…) (`20260516000003..009`) | 🔴 |
| Types mouvement `sale_pos`/`sale_b2b`/`stock_in`/`ingredient` | Enum réel : sale, sale_void, production*, purchase, waste, adjustment*, transfer_in/out, opname*, incoming… | 🔴 |
| « Pas de FEFO/FIFO par batch, pas de lot tracking » | `stock_lots` + FIFO + `create_stock_lot_v1` + `get_expiring_lots_v1` + cron `mark_expired_lots` (`20260517000040/043/045`) | 🔴 |
| Perms `inventory.view/.create/.update/.delete` | Granulaire : `inventory.read`/`.waste`/`.adjust`… | 🔴 |
| `current_stock` par trigger AFTER INSERT | Mis à jour DANS les RPCs (« NO trigger », commentaire `20260517000040`) | 🟠 |
| Tables `recipes + recipe_ingredients` | Table unique `recipes` (BOM plat) | 🟠 |
| EF `intersection_stock_movements` | Aucune trace | 🟠 |

**Manques :** display-stock, `allow_negative_stock` + `_record_sale_stock_v1` (S53), `unit_cost` par unité de base.
**Verdict : Partie I riche et juste ; Partie II décrit un modèle disparu.**

### 3.8 · 07-purchasing-suppliers.md — la moins fiable du groupe stock

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| Statuts `draft→sent→confirmed→partially_received→received` | CHECK réel : `draft/pending/partial/received/cancelled` (`20260517000110`) | 🔴 |
| Réception = upserts client + trigger UPDATE status | RPC `receive_purchase_order_v2` + **GRN** (`goods_receipt_notes`), JE au INSERT GRN, conversion base-unit, lot upfront (`20260701000011`) | 🔴 |
| Tables `purchase_order_returns/history/attachments`, `supplier_pricing`, `supplier_categories` | **Aucune n'existe** → retours, QC, timeline, attachments, prix négociés = features inexistantes | 🔴 |
| PO items `quantity_received`/`quantity_returned`/`qc_passed` | Réel : `received_quantity` seul | 🔴 |
| `payment_status` + trigger + `postPurchasePaymentJournalEntry` | `payment_terms` (cash/credit) + table `purchase_payments` (S46, `20260701000012`) | 🔴 |
| Perms = alias `inventory.*` | Dédiées `purchasing.po.read/.create/.receive/.cancel` | 🔴 |
| EF `purchase_order_module` | Aucune trace | 🟠 |

**Verdict : à réécrire quasi intégralement — décrit un monolithe V2 avec des features jamais portées en V3.**

### 3.9 · 08-customers-loyalty.md — RPCs loyalty fictives

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| RPCs `add_loyalty_points`/`redeem_loyalty_points` | **Inexistantes** (0 hit repo). Seule RPC : `adjust_loyalty_points` (`20260514000002`) ; earn embarqué dans la money-path + `get_loyalty_multiplier` (`20260628000010`) | 🔴 |
| Chemins `src/hooks/customers/…`, `useLoyalty.ts` | `apps/backoffice/src/features/{customers,loyalty}/hooks/` | 🔴 |
| Wrapper client JE redemption (2210↔4131) | Non implémenté tel quel | 🟠 |
| INSERT `loyalty_transactions` côté client | Writes révoquées (`20260621000014`) — RPC-only | 🟠 |

**Manques :** `search_customers_v3`/`get_customer_v3` (gatés S50).
**Verdict : vue fonctionnelle partiellement fiable, API décrite fictive.**

### 3.10 · 09-b2b-wholesale.md — architecture entière disparue

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| Tables `b2b_orders`, `b2b_order_items`, `b2b_deliveries`, `b2b_order_history`, `b2b_price_lists(_items)` | **Aucune n'existe.** B2B = `orders` avec `order_type='b2b'`, statuts `b2b_pending`/`paid`/`voided` (`20260710000070:22,30`) | 🔴 |
| State machine 8 statuts pilotée par livraisons | Pas de livraisons ; `b2b_pending` → `paid` (allocations) / `voided` (`cancel_b2b_order_v1`) | 🔴 |
| FIFO **client** `arService.allocateFIFO` | Allocation **serveur** `record_b2b_payment_v2` (ciblée `p_invoice_ids` sinon FIFO) + table append-only `b2b_payment_allocations` (S52, `_065/_067`) | 🔴 |
| EF `generate-invoice` | Inexistante | 🔴 |
| JE via engine TS `postB2BSaleJournalEntry` | JE émis serveur dans `create_b2b_order_v3`/`record_b2b_payment_v2` | 🔴 |
| Triggers `update_b2b_payment_status`, `deduct_b2b_stock`… + `amount_due` | Aucun ; `outstanding = total − Σ allocations` (vue, `_070:19-21`) | 🔴 |
| Hiérarchie prix `b2b_price_list_items` > wholesale > retail | Pas de price-lists ; prix validé serveur | 🔴 |
| Perms `sales.*` ; 6 vues `/b2b/*` | Gates dédiés `b2b.read`/`b2b.payment.record`/`b2b.order.cancel` (S52) | 🟠 |
| Plafond crédit « contrôlé en code » | Gate serveur dur `validate_b2b_credit_limit_v1` (P0011) + re-check TOCTOU | 🟠 |

**Manques :** tout le per-invoice settlement S52, `cancel_b2b_order_v1`, vues `view_b2b_invoices`/`view_ar_aging`, `reconcile_b2b_balance_v1`, onglet Invoices (S56).
**Verdict : non fiable — à réécrire ; coder d'après cette fiche casserait.**

### 3.11 · 10-accounting-double-entry.md — concepts OK, implémentation périmée

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| Engine TS `accountingEngine.ts` (« cœur du module ») | **N'existe pas** ; génération JE 100 % SQL (triggers + RPCs) | 🔴 |
| RPCs `get_general_ledger_data`, `get_trial_balance_data`, `get_balance_sheet_data`, `get_income_statement_data` | `get_general_ledger_v2`, `get_trial_balance_v3`, `get_balance_sheet_v2`, `get_profit_loss_v2` — tous gatés (S50) | 🔴 |
| 11 pages `/accounting/*` dont VAT, AR Aging, Bank Rec, CALK | Routes réelles : chart-of-accounts, journal-entries, general-ledger, trial-balance, cash, mappings ; BS/P&L/PB1 sous **Reports** ; VAT/CALK/BankRec **inexistantes** | 🔴 |
| `approve_expense_with_journal`, `complete_order_with_payments` | Disparues → `submit_expense_v2`/`approve_expense_v3`/`pay_expense_v1` ; `complete_order_with_payment_v17` | 🔴 |
| Clôture via `accounting.manage` + `lock_fiscal_period` | `close_fiscal_year_v1` (gate `accounting.year.close` + PIN, S54) ; `check_fiscal_period_open` **fail-closed** (P0004) | 🟠 |

**Toujours exact :** double-entry stricte, contrainte debit=credit, PB1 10 % ≠ PPN, plan SAK EMKM, tables cœur, mapping keys.
**Manques :** TB v3 cumulé + opening_balance, `close_fiscal_year_v1` complet, Cash Treasury, exclusion `year_close` des rapports (S54).
**Verdict : bonne intro métier, dangereuse comme référence d'implémentation.**

### 3.12 · 11-expenses.md — la mieux vieillie, mais cœur §18 faux

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| RPC unique `approve_expense_with_journal(p_expense_id,p_approved_by)` | Disparue. Chaîne réelle : `submit_expense_v2` (idempotency) → `approve_expense_v3` (PIN manager serveur) → `reject_expense_v1` → `pay_expense_v1` (`useExpenseActions.ts:27-109`) | 🔴 |
| Workflow simple Pending→Approved→Paid | Multi-étapes à seuils + **SOD** (snapshot-at-submit, `{step, of_total}`, `ApprovalTimeline`, exception super-admin `20260706000023`) | 🔴 |
| 3 statuts (draft = UI-only) | `draft` est un vrai statut DB (`ExpenseStatusBadge.tsx:26`) | 🟠 |
| Crédit hardcodé 1110/1120, VAT 1180 | Résolu via `accounting_mappings` (`EXPENSE_PETTY_CASH` 1111 / `EXPENSE_BANK` 1112) | 🟠 |
| `expenses.approve` suffit | + re-auth PIN manager (EF `verify-manager-pin`) | 🟠 |

**Toujours exact :** catégorie → compte, approbation avant compta, séparation approbation/paiement, bucket `expense-receipts`, `tax_amount`=0, colonnes et perms `expenses.*`.
**Verdict : moyennement fiable — §17-18 induiraient un dev en erreur.**

### 3.13 · 12-cash-register-shift.md — divergence la plus risquée

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| « `close_shift` ne crée PAS d'écriture comptable » (répété ~5×) | **Inverse de la réalité** : `close_shift_v2` émet auto un JE de variance si écart≠0 (DR/CR `SHIFT_CASH_VARIANCE_INCOME` 4910 / `_EXPENSE` 5910) (`20260606000015:106-142`). Seul le dépôt banque reste manuel | 🔴 |
| Aucun Z-report, « pas de certification » | Système complet : table `z_reports`, `_build_zreport_snapshot`, `sign_zreport_v2` (PIN+lockout), `void_zreport_v2`, buckets storage (`20260606000011..023`, `20260710000062`) | 🔴 |
| Signature `close_shift(p_session_id,p_user_id,p_counted_cash,p_closing_cash_details,p_notes)` | `close_shift_v2(p_session_id,p_counted_cash,p_notes,p_idempotency_key)` | 🟠 |
| Réconciliation 3-way (cash/QRIS/EDC) | Variance **cash** uniquement dans v2 | 🟠 |

**Toujours exact :** cycle open/recounting/closed, 1 session par (user,terminal), seuils variance, multi-caissier + auto-recovery.
**Verdict : fiable sur les invariants métier, dangereusement fausse sur le couplage comptable.**

### 3.14 · 13-promotions-discounts.md — moteur inversé client→serveur

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| « Moteur 100 % client, pas de RPC d'évaluation » | **Faux** : `evaluate_promotions_v2` (`20260710000091`) appelé par `useEvaluatePromotions.ts` | 🔴 |
| Table `promotion_usage` + RPC `record_promotion_usage` + `current_uses` | Inexistantes. Réel : `promotion_applications` (`20260511000002`), comptage par JOIN orders non-voided | 🔴 |
| Colonnes `max_uses_total`/`current_uses` | Réel : `max_uses` + `max_uses_per_customer` (S57, `20260710000089`) | 🔴 |
| `promotionEngine.ts`/`promotionMatchers.ts`/`promotionCalculators.ts` | Aucun n'existe | 🔴 |
| « Combos NON éligibles, pricing figé » | S57 : combos validés ET pricés serveur (`_resolve_combo_price_v1` dans v17) | 🟠 |
| Plafond advisory, race « acceptable » | Gate atomique `pg_advisory_xact_lock` → `promo_cap_exceeded` (v17 + `pay_existing_order_v11`) | 🟠 |

**Verdict : non fiable au-delà de la taxonomie des 4 types.**

### 3.15 · 14-reports-analytics.md — architecture config-driven fictive

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| `ReportsConfig.tsx` (57 reports) + switch/case + 60+ `{Report}Tab.tsx` | Composant générique `ReportPage.tsx` + 1 page/rapport + 1 hook/rapport (`features/reports/`) | 🔴 |
| Services sur des **vues** | Chaque hook appelle un RPC `get_*_vN` gaté (`useProfitLoss.ts`, `useSalesByHour.ts`…) | 🔴 |
| RPCs `get_sales_comparison`, `get_reporting_dashboard_summary`, `calculate_vat_payable`, `get_vat_by_category` | Aucune trouvée ; remplacées par famille `_vN`+`has_permission` (S50) | 🔴 |
| EF `calculate-daily-report` = pièce centrale | **N'existe pas** ; EF réelle = `generate-pdf` (~17 templates `_shared/pdf-templates/`) | 🔴 |
| Export client jsPDF + xlsx | PDF server-side (`generate-pdf`, bucket `reports-exports`) ; CSV domaine `buildCsv` (`packages/domain/src/reports/csv.ts`) ; pas d'Excel | 🔴 |
| « Aucune matview cron » | `mv_pl_monthly`/`mv_sales_daily`/`mv_stock_variance` + pg_cron + REVOKE (`20260517000070/071`) | 🟠 |
| Gating purement UI | Gates serveur `_v2` + `reports.financial.read` (S50) | 🟠 |

**Manques :** `get_gross_margin_by_product_v1` (S57), `get_payments_by_method_v2` (timezone), rapports Cash Flow/Basket/Perishable/Stock Variance/Recipe Cost.
**Verdict : Partie II à réécrire intégralement ; Partie I (7 axes, invariants UX, drill-down) encore juste.**

### 3.16 · 15-production-recipes.md — « ne fait pas » contredit

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| Inserts client séparés, RPC atomique « non utilisée » | `useRecordProduction.ts` appelle **`record_production_v1`** atomique (stock + JE via trigger `tr_20_je_emit`) | 🔴 |
| JE posé par service TS `postProductionJournalEntry` | Trigger DB | 🔴 |
| « Ne supporte PAS les sous-recettes » (backlog) | Implémenté (`20260519000001`, `_000006` cascade sub-recipe) | 🔴 |
| « Pas de versioning des recettes » | Implémenté : `recipe_version_fk`, `useRecipeVersions`, `duplicate_recipe_v1` (`20260519000005/000082`) | 🔴 |
| « `quantity_waste` ne déduit rien » | `p_quantity_waste` intégré serveur | 🔴 |
| « Pas de % boulanger » | `useBakerRecipeMode.ts` existe | 🟠 |
| Forçage négatif via `inventory.adjust` | Flag `allow_negative_stock` + `_resolve_recipe_consumption_v1` (S48/#122) | 🟠 |

**Manques :** yield variance, lots (`lot_id`), batch production, planning/calendrier, valorisation `production_in` au coût réel.
**Verdict : technique inversée + backlog périmé (3 features « absentes » sont livrées). À réécrire.**

### 3.17 · 16-display-customer.md — canal et features fictifs

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| `BroadcastChannel('appgrav-lan'/'appgrav-pos')` + `displayBroadcast.ts` | Canal réel **`'breakery-cart'`** via `useCartBroadcast` (`useCartBroadcast.ts:4`) | 🔴 |
| Messages `CART_UPDATE`/`ORDER_STATUS`/`PROMOTION_UPDATE`/`CONFIG_UPDATE` | Deux types : `cart_update` et `payment_complete` (S57) | 🔴 |
| Mode Idle + carrousel `display_promotions`/`display_content` | Tables/composants référencés nulle part ; cart vide → empty-state brandé (`CustomerDisplayView.tsx:251-262`) | 🔴 |
| Store `useDisplayStore` piloté LAN | Inexistant ; vue alimentée par `useCartStore` via `useCartBroadcastReceiver` | 🔴 |
| Bannière ready via LAN | `OrderQueueTicker` + `useDisplayOrders`/`useDisplayRealtime` (Supabase Realtime) | 🟠 |
| Route publique simple | Modèle kiosk JWT (`useKioskAuth` + `PairDevicePrompt`) non décrit | 🟠 |

**Manques :** broadcast `payment_complete` S57 (merci/monnaie 8 s, masqué ≠ cash).
**Verdict : non fiable — moitié du contenu décrit une architecture disparue.**

### 3.18 · 17-tablet-ordering.md — INSERT brut → RPC idempotent

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| `createTabletOrder()` = INSERT direct orders+items | RPC **`create_tablet_order_v2`** idempotent `p_client_uuid` + table `tablet_order_idempotency_keys` (`useCreateTabletOrder.ts:19-25`, `20260602000010..012`) | 🔴 |
| PIN gate `PinVerificationModal` au mount | Gate `useAuthStore.isAuthenticated` + rôle waiter/`sales.create` (`TabletLayout.tsx:10-26`) | 🔴 |
| Client LAN (heartbeat, `TABLET_ORDER_NEW`, ACK) | Pas de LAN ; statut via `useTabletOrderStatusListener` (Realtime) ; pilule online/offline via `useTabletOffline` | 🔴 |
| Cart = hook local « NOT a Zustand store » | Store Zustand `tabletCartStore` (`TabletLayout.tsx:5,17`) | 🟠 |
| « Pas d'offline / queue locale » (backlog Critical) | Offline existe : `useTabletOffline`/`useTabletMenuCache`/`OfflineBanner` + test | 🟠 |
| Sélection table par numéro | `FloorPlanView` (plan de salle) non décrite | 🟡 |

**Verdict : squelette métier OK, toute la mécanique technique à réécrire.**

### 3.19 · 18-mobile-shell.md — module fantôme

Aucune contrepartie dans le code : pas de `capacitor.config.ts` (grep `capacitor` = 0 dans apps/), pas de `MobileLayout`/`MobileLoginPage`/`useMobileStore`/`mobileRoutes.tsx` (Glob = 0), pas de PWA `usePWAInstall`, EF `set-user-pin` inexistante. **La fiche documente un module qui n'existe pas au S57** (retiré, jamais construit en V3, ou vivant hors repo). 🔴 global.
**Verdict : documentation fantôme — à archiver ou marquer « module inexistant » jusqu'à preuve du contraire.**

### 3.20 · 19-settings-configuration.md — surface décrite ≫ surface réelle

| Affirmation fiche | État réel (preuve) | Sév. |
|---|---|---|
| ~24 routes settings (tax, payments, KDS, printing, LAN, devices, floorplan…) | **9 routes réelles** : general, inventory, holidays, templates/email, templates/receipt, permissions, security, accounting, expense-thresholds + hub (`routes/index.tsx:884-956`) | 🔴 |
| RPC `update_role_permissions` | N'existe pas | 🔴 |
| « 42 pages, 30 composants » + `SettingsLayout` | 9 pages ; pas de SettingsLayout dédié (hub) | 🟠 |
| Perms `settings.view`/`settings.network`, `accounting.vat.manage` | `settings.read`/`.update`/`.holidays.manage`/`.kiosk.manage` ; compta sans `vat.manage` | 🟠 |
| EFs `auth-user-management`, `send-test-email` | Inexistantes | 🟠 |
| Audit à `/settings/audit` | Sous Reports (`AuditPage.tsx`) | 🟠 |

**Manques :** SettingsHubPage, templates Email/Receipt, Holidays, Accounting settings (clôture annuelle S56), Expense Thresholds.
**Verdict : concepts OK, cartographie périmée.**

### 3.21 · 00-modules-index.md — périmé mais honnête

| Affirmation | État réel | Sév. |
|---|---|---|
| Colonne « Doc » = TBD pour modules 06-21 | Les fiches existent toutes (06→19) | 🟠 |
| Numérotation V2 (08=Production, 12=Accounting, 14=Reporting, 15=Settings) | V3 : 15=Production, 10=Accounting, 14=Reports, 19=Settings — confusion croisée | 🟠 |
| « 16 Edge Functions » ; « 211+ migrations » ; arbo mono-app | 14 EF réelles ; migrations jusqu'à `20260710000096` ; monorepo | 🟡 |

**Toujours exact :** carte mermaid des dépendances inter-modules ; disclaimer V2/V3 explicite (l.5).
**Verdict : correctifs légers suffisent.**

---

## 4. Plan d'action proposé (à valider avant exécution)

Aucune modification n'a été faite — tout ce qui suit attend votre feu vert.

**Étape 0 — Bannières d'avertissement (rapide, faible risque, forte valeur).**
Prépendre en tête des 20 fiches une bannière type :
`> ⚠️ STALE (audit 2026-07-03) : fiche vérifiée S13, code à S57. Partie II (référence technique) NON FIABLE — chemins V2, RPCs/EFs renommés ou fictifs. Voir docs/workplan/audits/2026-07-03-modules-reference-divergence-audit.md §3.x avant tout usage.`
Adapter par fiche (ex. 18-mobile : « module inexistant »). Corrige immédiatement le risque « référence canonique mensongère » sans réécrire.

**Étape 1 — Annoter la ligne « Module reference (canonical) » de CLAUDE.md** pour signaler l'état stale et pointer cet audit (une phrase).

**Étape 2 — Corriger `00-modules-index.md`** (colonne Doc, 14 EF, volumes, note de mapping V2→V3 des numéros).

**Étape 3 — Statuer sur `18-mobile-shell.md`** : archiver (`git mv` vers un `archive/`) ou banner « module inexistant ». Question ouverte : le mobile shell vit-il dans un autre repo/branche, ou est-il abandonné ?

**Étape 4 — Réécriture progressive des fiches (chantier, par priorité de risque) :**
1. `12-cash-register-shift` (affirmation comptable inversée — risque financier)
2. `04-kds-kitchen` + `16-display-customer` (Partie II entièrement fausse)
3. `07-purchasing-suppliers`, `09-b2b-wholesale`, `13-promotions-discounts` (architectures disparues)
4. `01-auth-permissions`, `03-payments-split`, `02-pos-cart-orders`
5. Le reste (05, 06, 08, 10, 11, 14, 15, 17, 19, 02b) — Partie II seulement.
Chaque réécriture = 1 sous-tâche vérifiée contre migrations + code, en s'appuyant sur les tableaux §3 ci-dessus comme checklist.

## 5. Hors périmètre / non touché

- Le code (apps/, packages/, supabase/) — l'audit ne juge que la doc ; aucune divergence relevée n'implique un bug code.
- Les zones legacy `docs/objectif travail/` et `docs/Design/` (overlap connu avec `reference/`) — hors scope de cette demande, à traiter dans une curation générale.
- Les specs/plans datés `docs/workplan/` et `docs/superpowers/` — historique append-only, exact par construction.
