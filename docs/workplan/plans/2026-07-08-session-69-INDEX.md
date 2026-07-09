# Session 69 — INDEX : CRUD Customer Categories + Prix négocié par client B2B (Vague 2)

> **Date :** 2026-07-08 · **Branche :** `worktree-session-69` (base `7b1f6a10` = master post-#171 + spec/plan S69)
> **Spec :** [`docs/superpowers/specs/2026-07-08-s69-customer-categories-negotiated-pricing-design.md`](../../superpowers/specs/2026-07-08-s69-customer-categories-negotiated-pricing-design.md) · **Plan :** [`docs/superpowers/plans/2026-07-08-s69-customer-categories-negotiated-pricing.md`](../../superpowers/plans/2026-07-08-s69-customer-categories-negotiated-pricing.md)
> **Ferme :** fiche **08 D2.1** (CRUD catégories client — la page BO était read-only, dette D-W6-CUSTCAT-01) et fiche **09 B1.1** (« prix négocié par client » B2B).

## Résumé livré

Deux volets d'un même chantier « configuration tarifaire ».

- **Volet A (hors money-path) — CRUD catégories client.** Les RPCs d'écriture manquants sont créés et l'UI BO (`CustomerCategoriesPage`) devient un CRUD réel (create/edit/delete via `CategoryFormModal`, delete **bloqué si des clients sont rattachés**). Les overrides prix par catégorie (`product_category_prices`, type `custom`) deviennent **éditables** dans le `PricingTab` de la fiche client.
- **Volet B (sous garde money-path) — prix négocié par client B2B.** Nouvelle table **`customer_product_prices`** (prix par `(customer, product)`) + permission **`customer_prices.manage`**. La commande B2B **`create_b2b_order_v4 → v5`** résout désormais le prix de ligne **côté serveur** (priorité **négocié client > prix catégorie > retail**, via le helper interne `_resolve_b2b_line_price_v1`) — le `unit_price` envoyé par le client est **ignoré**. UI BO : `NegotiatedPricesSection` sur la fiche client + prefill du modal de commande B2B. **Le POS et la money-path POS (`complete_order_with_payment_v17`) sont inchangés.**

## Décisions actées (propriétaire, brainstorm 2026-07-08)
1. Prix négocié **par CLIENT** (nouvelle table), pas par catégorie — le plus flexible.
2. Appliqué aux **commandes B2B uniquement** (`create_b2b_order_v5`) — la money-path POS reste intacte (pas de risque display/charge mismatch, `get_customer_product_price` et `_resolve_line_price_v1` non modifiés).
3. Overrides catégorie éditables **seulement pour le type `custom`** (les types retail/wholesale/discount_percentage restent calculés).
4. Delete catégorie **bloqué si des clients y sont rattachés** (`category_in_use`, P0001).
5. **Les deux volets** dans la même session.
6. Nouvelle permission `customer_prices.manage` (seedée MANAGER/ADMIN/SUPER_ADMIN) ; lecture `customer_product_prices` en `authenticated` sous RLS.

## Migrations (`_135..139`)
- **`20260710000135`** — RPCs CRUD `customer_categories` : `create_customer_category_v1` / `update_customer_category_v1` / `delete_customer_category_v1` (SECURITY DEFINER, trio REVOKE + GRANT authenticated). Invariant défaut : créer/passer `is_default` désaffecte l'ancien ; **on ne peut pas dé-défaut la dernière** (`default_required`) ; delete du défaut interdit (`cannot_delete_default`) ; delete bloqué si clients rattachés (`category_in_use`) ; soft-delete + re-delete idempotent. Gates perms S13 déjà seedées. **⚠️ Fix revue (`af62fc45`)** : gardes NULL — `p_is_default=NULL` sur le défaut courant → `default_required` (sinon `TRUE AND NOT NULL = NULL` sautait la garde, zéro défaut) ; `p_discount_percentage`/`p_points_multiplier` NULL → erreur typée P0001 (sinon `23502` brut).
- **`20260710000136`** — RPCs `upsert_product_category_price_v1` / `delete_product_category_price_v1` (overrides catégorie, gate `customer_categories.update`, ON CONFLICT upsert sur la PK `(product_id, customer_category_id)`).
- **`20260710000137`** — table **`customer_product_prices`** `(customer_id, product_id, price DECIMAL(12,2) CHECK ≥0, PK composite)` + trigger `set_updated_at` + RLS `auth_read` (`is_authenticated()`) + lockdown DML (REVOKE INSERT/UPDATE/DELETE authenticated, GRANT SELECT) + permission **`customer_prices.manage`** seedée MANAGER/ADMIN/SUPER_ADMIN.
- **`20260710000138`** — RPCs `upsert_customer_product_price_v1` / `delete_customer_product_price_v1` (gate `customer_prices.manage`, trio REVOKE + GRANT authenticated).
- **`20260710000139`** — helper interne **`_resolve_b2b_line_price_v1(customer, product)`** (SQL STABLE SECURITY DEFINER, REVOKE anon+authenticated+PUBLIC — interne uniquement) = `COALESCE(customer_product_prices.price, get_customer_product_price(product, customer), products.retail_price)`. **`create_b2b_order_v5`** = corps **LIVE v4 verbatim** (DEV-S57-02) avec **exactement** 3 changements : les 2 lectures `v_unit_price := (v_item->>'unit_price')` → `_resolve_b2b_line_price_v1(...)` (boucle validation + boucle insert, mêmes valeurs → total credit-check == total facturé) ; garde `invalid_unit_price` → `price_unresolved` (P0002) ; audit `rpc_version` `v5-s69`. **DROP v4**, GRANT authenticated. Tout le reste (credit-check TOCTOU `FOR UPDATE`, JE B2B_AR/SALE_B2B_REVENUE, stock display/recipe-aware via `_record_sale_stock_v1`, `invoice_number` S68, idempotency/replay) **byte-identique**.

## Types regénérés
`packages/supabase/src/types.generated.ts` : 7 nouvelles fonctions + table `customer_product_prices` + rename `create_b2b_order_v4→v5`. **⚠️ DEV-S69-03** : le générateur MCP actif (plugin) produit une sortie **structurellement divergente** du baseline master (fonctions internes `_*` ajoutées, `get_stock_levels_v1` — périmée côté DB mais gardée par le master pour que l'app typecheck — retirée). Un regen brut casserait `useStockLevels.ts` (+ bruit de 200 fns internes dans le diff). **Résolu par greffe** : base = types du master, ajout des seuls deltas S69 → diff **+177/-2 propre**, `get_stock_levels_v1` préservé. Typecheck 7/7 vert.

## BO / POS
- **BO Volet A** : `useCustomerCategoryMutations` (create/update/delete + `classifyCategoryError` couvrant les 9 codes) ; `CategoryFormModal` (select natif `price_modifier_type`, champ discount conditionnel) ; `CustomerCategoriesPage` réécrite en CRUD gaté `customer_categories.create/.update/.delete` (retire le bandeau read-only D-W6-CUSTCAT-01). `PricingTab` : overrides catégorie `custom` éditables (`useUpsert/DeleteCategoryPrice`, product picker réutilisé, delete `ghostDestructive`).
- **BO Volet B** : `useCustomerNegotiatedPrices` (read + `useUpsert/DeleteNegotiatedPrice`) ; `NegotiatedPricesSection` (Card, retail barré vs négocié, add/edit/delete gatés `customer_prices.manage`) montée sur `PricingTab` sous « Negotiated prices (this customer) » ; `useCreateB2bOrder` repointé **v5** + `classify('price_unresolved')` ; `CreateB2bOrderModal` prefill du `unit_price` depuis le prix négocié (sinon retail — **cosmétique, serveur autoritaire**). `permissions.ts` +`customer_prices.manage`.
- **POS** : **inchangé** (chantier BO+DB).

## Tests
- **pgTAP live (nouvelles suites)** : `customer_category_crud` **17/17** (dont 3 régressions du fix NULL) · `product_category_prices` **9/9** · `customer_product_prices_rls` **12/12** (schéma+RLS+lockdown+perm+RPCs+ON CONFLICT) · **`b2b_negotiated_price` 5/5** (ordre négocié 3000 > catégorie 4000 > retail 5000 ; v5 facture le résolu, ignore le client 999999).
- **Ancres money-path re-vertes live (repointées v5)** : **`b2b_settlement` 14/14** (T10 credit-gate P0011, cancel, idempotency, reconcile) · `b2b_display_aware_stock` 3/3 · `b2b_order_flag_aware_stock` A/B/C · `b2b_foundation` **15/15** · `b2b_invoice` blocs 2 (6/6) + 4 (7/7) · **`s44_money_gates` 12/12 (POS `complete_order_with_payment_v17` — non touché, garde de non-régression)**.
- **Smokes BO** : `customer-categories-crud` 6/6 · `pricing-tab-edit` 5/5 · `negotiated-prices` 5/5.
- **Suite monorepo** : typecheck **7/7** · build **3/3** · `pnpm test` — avec env VITE_* (comme la CI) **210/210 fichiers, 767 tests verts** (1 skip). Sans env : baseline env-gated documenté (39 fichiers échouent à l'import de `src/lib/supabase.ts`, 2 tests `lan-devices-kpi` sans lien S69) — **zéro régression S69**.

## Revue (subagent-driven, 1 reviewer indépendant / tâche)
- **Tâches 1-8 : SPEC ✅ + QUALITY approved** après corrections. Findings Important fixés : garde NULL-default (T1), 4 erreurs lint-ratchet (T4). Findings Minor fixés opportunément : couverture `product_not_found`/anon ACL (T2), cast resserré `p_color/p_icon` (T3), branche ON CONFLICT (T6), classify `price_unresolved` (T7), bug pré-existant `products.price`→`retail_price` (T8).
- **Tâche 7 (money-path) — revue opus** : comparaison ligne à ligne v5 vs v4 → « diffère par exactement les 3 edits prévus, tout le reste byte-identique » ; deux-boucles prix cohérentes ; resolver correct. Ready.

## Déviations
- **DEV-S69-01** : `role_permissions.role_code` (colonne réelle) — le plan écrivait `role`. Corrigé à l'apply.
- **DEV-S69-02** : `permissions` PK = `code` (pas de colonne `id`) — test T5 corrigé (`SELECT code` au lieu de `SELECT id`).
- **DEV-S69-03** : greffe des types (cf. § Types) pour éviter le drift du générateur MCP.
- **DEV-S69-04** : preambles pgTAP adaptés au vrai pattern d'auth (`request.jwt.claims` + `user_profiles.employee_code='EMP000'`), pas le `set_auth_as_role('ADMIN')` supposé par le plan.

## Dettes (D-*)
- **D-1** : `slug_taken` sur-couvre une race du flag `is_default` (l'index partiel one-default peut lever `unique_violation` mislabellé `slug_taken`) — Minor, nécessite concurrence réelle.
- **D-2** : `customer_product_prices` RPCs — pas de test négatif P0003 (rôle non privilégié) ni de join `role_permissions` confirmant exactement les 3 rôles ; pas de garde de précision sur `p_price numeric` vs `DECIMAL(12,2)` (héritée du sibling). Minor.
- **D-3** : générateur de types MCP divergent (get_stock_levels_v1 périmé côté DB / fns internes `_*`) — à traiter hors S69 (audit types-vs-DB).
- **D-4** : `create_b2b_order_v5` sur un produit **soft-deleted** sans prix négocié → `get_customer_product_price` lève `no_data_found` brut (au lieu de facturer le prix client comme v4). Edge, inatteignable via l'UI BO ; arguablement plus correct.
- **D-5** : prefill B2B — race async (produit choisi avant résolution de la requête prix négocié → fallback retail, pas de re-sync) + `NegotiatedPriceRow.draft` sans re-sync sur changement de prop. **Cosmétique uniquement** (v5 serveur autoritaire ignore le `unit_price` client).

## Money-path
`create_b2b_order` bumpée **v5** (additif : résolution serveur du prix ; corps v4 byte-identique par ailleurs). **`complete_order_with_payment_v17` / `pay_existing_order_v11` / `fire_counter_order_v4` NON modifiés** (ancre `s44_money_gates` 12/12 `num_failed=0` re-passée live).
