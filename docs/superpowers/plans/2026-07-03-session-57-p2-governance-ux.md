# Session 57 — Plan d'exécution : P2 restant (gouvernance promos/combos, UX POS/BO, outillage, marge brute)

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` — un subagent par tâche, parallélisable par vague. Spec : [`2026-07-03-s57-p2-governance-ux-design.md`](../specs/2026-07-03-s57-p2-governance-ux-design.md) (toutes les décisions A-D1…E-D4 y sont tranchées — les respecter, dévier = numéroter DEV-S57-NN).

**Goal:** Solder P2.1/P2.3/P2.4/P2.5/P2.6 de l'audit 2026-06-27 sur `swarm/session-57`.

**Architecture:** Vague 1 = DB (2 agents parallèles, plages de migrations réservées) → regen types (contrôleur) → Vague 2 = frontend/outillage (5 agents parallèles, fichiers disjoints) → Vague 3 = ancres + revue pattern-guardian + closeout.

## Contraintes globales (toutes tâches)

- DB = Supabase cloud `ikcyvlovptebroadgtvd` via MCP (`apply_migration`, `execute_sql` BEGIN…ROLLBACK pour pgTAP). **Jamais** `supabase start`/`db reset`/Docker.
- RPC versioning monotone : bump vN+1 + DROP vN même migration ; REVOKE PUBLIC+anon explicites ; ⚠️ v17 **DOIT** `GRANT EXECUTE TO authenticated`.
- `git add` ciblé fichier par fichier (jamais `-A` — cf. DEV-S56-05) ; commits conventionnels co-signés.
- Fichiers < 500 lignes ; tests co-localisés `__tests__/` ; pas de nouveau fichier doc non demandé.

---

## Vague 1 — DB (2 agents parallèles)

### Tâche 1a — Chantier A DB : combo server-side + plafonds promo (db-engineer)

**Migrations réservées : `20260710000089..092` (+ `_095` si fix).** Décisions A-D1→A-D8, A-D10.

- `_089` : `ALTER TABLE promotions ADD COLUMN max_uses INT NULL, ADD COLUMN max_uses_per_customer INT NULL` (+ CHECK > 0).
- `_090` : `_resolve_combo_price_v1(p_combo_product_id uuid, p_components jsonb) RETURNS numeric` — SECURITY DEFINER STABLE, `SET search_path = public, pg_temp`, REVOKE PUBLIC+anon+authenticated. Valide : chaque composant ∈ `combo_group_options` du combo (sinon `combo_invalid_component`), min_select/max_select/is_required par `combo_groups` (sinon `combo_group_violation`) ; retourne `combo_base_price + Σ surcharge`. S'inspirer de `_resolve_line_price_v1` (`20260710000063`).
- `_091` : `evaluate_promotions_v2` = v1 + check advisory des caps (count `promotion_applications` JOIN `orders` non-voided ; per-customer seulement si `p_customer_id` non NULL) ; DROP v1 même migration ; mêmes GRANT/REVOKE que v1.
- `_092` : `complete_order_with_payment_v17` = v16 (`20260710000086`) avec : (1) lignes combo pricées/validées via `_resolve_combo_price_v1` (remplace base+modifiers pour les combos — les `product_modifiers` non-combo restent inchangés) ; (2) gate dur caps avant l'INSERT `promotion_applications` : `pg_advisory_xact_lock(hashtext(v_promotion_id::text))` → re-count → `RAISE EXCEPTION 'promo_cap_exceeded'` ; DROP v16 ; **GRANT EXECUTE TO authenticated** ; REVOKE anon+PUBLIC.
- EF `supabase/functions/process-payment/index.ts` : repoint v17, redeploy MCP `deploy_edge_function`.
- **A-D8** : vérifier si `pay_existing_order_v11` / `create_b2b_order_v3` acceptent des `combo_components` ; si oui bump v12/v4 avec le helper (migration `_095`), sinon le dire dans le rapport.
- **pgTAP** : `supabase/tests/combo_server_pricing.test.sql` (surcharge facturée ; composant hors-groupe rejeté ; min/max/required ; non-combo inchangé) + `supabase/tests/promotion_usage_caps.test.sql` (cap global atteint ; per-customer ; anonyme → global seul ; void libère ; NULL = illimité). Ancres re-passées : `combo_sale`, `combo_fire_pay`, `sale_flag_aware`, `discount_auth_nonce`.
- **Produit pour la suite** : codes d'erreur `combo_invalid_component`, `combo_group_violation`, `promo_cap_exceeded` (consommés Tâche 2a) ; colonnes caps (consommées Tâche 2e).

### Tâche 1b — Chantier B DB : gross margin + payments tz (db-engineer)

**Migrations réservées : `20260710000093..094` (+ `_096` si fix).** Décisions B-D1→B-D4.

- `_093` : `get_gross_margin_by_product_v1(p_start_date text, p_end_date text, p_category_id uuid DEFAULT NULL) RETURNS jsonb` — SECURITY DEFINER, `SET search_path = public, pg_temp`, gate `has_permission('reports.financial.read')`, clamp 366 j, bornes via `business_config.timezone` (pattern `get_daily_sales_v1` `20260624000011`), REVOKE PUBLIC+anon, GRANT authenticated. Source : `order_items` × `orders` (statuts `paid`/`completed`, `voided_at IS NULL`, POS + B2B) × `products.cost_price` (WAC courant). Revenu HT net PB1. Retour `{summary:{revenue,cogs,margin,margin_pct}, by_product:[{product_id,name,category_name,qty,revenue,cogs,margin,margin_pct}], by_category:[…]}`. COMMENT caveat « WAC courant, pas snapshot à la vente ».
- `_094` : `get_payments_by_method_v2` = v1 (`20260602130010`) avec bornes + buckets `AT TIME ZONE business_config.timezone` ; DROP v1 ; GRANT/REVOKE identiques.
- **pgTAP** : `supabase/tests/gross_margin_by_product.test.sql` (calcul margin/margin_pct ; borne tz — vente 23h30 Makassar comptée le bon jour ; voided exclu ; gate refusé sans permission) + tests tz `payments_by_method` (même vente frontière minuit UTC/Makassar bucketée pareil dans les deux rapports).
- **Produit pour la suite** : signatures v1 gross-margin + v2 payments (consommées Tâche 2d).

### Checkpoint contrôleur (fin Vague 1)
- Regen types MCP → `packages/supabase/src/types.generated.ts`, commit unique.
- `pnpm typecheck` vert avant de lancer la Vague 2.

---

## Vague 2 — Frontend & outillage (5 agents parallèles, fichiers disjoints)

### Tâche 2a — POS UX (pos-specialist) — décisions C-D1→C-D5
- `PosLoadError` (nouveau, partagé POS) : ton erreur + CTA Retry→`refetch` ; branché sur `isError` avant l'empty-state dans `ProductGrid.tsx`, `TabletProductGrid.tsx`, `KdsBoard.tsx` ; `useProducts`/`useKdsOrders` exposent `isError`/`refetch`.
- `useReconnectInvalidate` (nouveau hook KDS) : invalidate au retour online/reconnexion realtime ; monté par la page KDS.
- Cibles tactiles : `CartLineRow.tsx:147,227` `h-8 w-8`→`h-11 w-11` ; `ProductGrid.tsx:88` `h-9`→`h-11` ; mesurer `QuantityStepper` (`packages/ui`) — si < 44 px, corriger là-bas + vérifier le rendu BO.
- Broadcast : `useCartBroadcast.ts` + `useCartBroadcastReceiver.ts` + `CDActiveCartView.tsx` : type `payment_complete` `{total, change, method}` émis au succès checkout (`useCheckout.ts`/`SuccessModal.tsx`), écran merci/monnaie ~8 s puis welcome, monnaie masquée si ≠ cash.
- Copy checkout des nouveaux codes v17 : `combo_group_violation`, `combo_invalid_component`, `promo_cap_exceeded`.
- **Tests** : smokes `PosLoadError` (×3 surfaces), receiver `payment_complete`, mapping copy.

### Tâche 2b — BO UX (backoffice-specialist) — décisions D-D1→D-D4
- `ReportPage.tsx` : prop `emptyState` (rend `EmptyState` de `packages/ui` quand vide) ; passer les ~30 `pages/reports/*.tsx` (supprimer les `<td>` muets).
- Parité : `Sidebar.tsx` += `production-yield`, `margin-watch`, `cost-spend`, `operating-expenses` (+ entrée Security groupe Settings, gate `settings.security.manage`) ; `ReportsIndexPage.tsx` += section Marketing (cohort/segments/promo-roi/birthday, gates `reports.read`).
- `useUrlState.ts` (nouveau, `apps/backoffice/src/hooks/`) : dates ISO + onglet ; convertir les pages reports uniquement.
- Micro-fix D-D4 : `PermissionGate` (`accounting.read`) sur la route index accounting (`routes/index.tsx:522`) — flaguer DEV-S57.
- **Tests** : `Sidebar.test.tsx`, `ReportsIndexPage.smoke.test.tsx` mis à jour ; unit `useUrlState` ; 1 smoke report avec `emptyState`.
- **Ne touche PAS** : `pages/reports/GrossMargin*` (Tâche 2d), `CustomerDetailPage` (2e).

### Tâche 2c — Outillage (coder) — décisions E-D1→E-D3
- `package.json` racine : `db:types` → `supabase gen types typescript --db-url "$SUPABASE_DB_URL" --schema public` ; `db:start/stop/reset` → `echo "Docker retiré 2026-05-14 — DB = Supabase cloud V3 (cf CLAUDE.md)" && exit 1`.
- `.github/workflows/ci.yml` : nouveau step **bloquant** `lint-ratchet` — `git diff --name-only origin/master...HEAD -- '*.ts' '*.tsx'` → `pnpm eslint` sur ces fichiers (0 fichier = skip OK) ; le step lint full-repo existant reste `continue-on-error: true`.
- `eslint.config.mjs` : `max-lines: ['warn', {max: 500, skipBlankLines: true, skipComments: true}]`.
- **Vérif** : le ratchet passe sur la branche courante (les fichiers S57 doivent être lint-clean — sinon corriger les fichiers S57, pas la règle).

### Tâche 2d — BO reports P2.6 (backoffice-specialist) — décision B-D5
- `hooks/useGrossMargin.ts` + `pages/reports/GrossMarginPage.tsx` (pattern `ReportPage`, filtres date + catégorie via `useUrlState` si déjà mergé, sinon useState + note) ; carte hub `ReportsIndexPage` **section Financial** + entrée sidebar (coordonner : 2b ajoute d'autres entrées — éditer après merge de 2b ou rebase) ; `ExportButtons` CSV via `buildCsv` ; drill-down produit ; caveat UI « coût = WAC courant ».
- `hooks/usePaymentsByMethod.ts` → v2.
- **Tests** : smoke `GrossMarginPage`, unit hook.
- **Dépend de** : types regen Vague 1. **Séquencer après 2b** (mêmes fichiers Sidebar/ReportsIndexPage) — lancer 2d quand 2b a commité.

### Tâche 2e — PromotionForm + CustomerDetail (coder) — décisions A-D9, E-D4
- `packages/ui/src/components/PromotionForm.tsx` (804 l.) : split en sous-composants co-localisés (< 500 l. chacun) **+ champs `max_uses`/`max_uses_per_customer`** (nullable, aide « vide = illimité ») câblés au save BO.
- `apps/backoffice/src/pages/customers/CustomerDetailPage.tsx` (590 l.) : extraire panels co-localisés.
- **Tests** : unit `PromotionForm` (caps posés/omis) ; smoke `CustomerDetailPage` inchangé fonctionnellement.
- **Droppable** si la session déborde (spec E-D4) — les caps A-D9 sont alors ajoutés sans refactor.

---

## Vague 3 — Ancres, revue, closeout (contrôleur + agents)

1. **Ancres pgTAP** : money-path (`sale_stock_unification` 12, `combo_sale`, `combo_fire_pay`, `modifier_ingredient_deduction`, `reversal_idempotency`, `discount_auth_nonce` 6, `sale_flag_aware`), `security` 20/20 (test-engineer, MCP BEGIN…ROLLBACK).
2. `pnpm typecheck` + `pnpm build` + suites Vitest/smokes ciblées.
3. **pattern-guardian** sur le diff de branche (read-only) ; fixes éventuels.
4. INDEX `docs/workplan/plans/2026-07-03-session-57-INDEX.md` (livré, migrations, tests, déviations DEV-S57-NN, follow-ups) ; bump CLAUDE.md Active Workplan ; PR `swarm/session-57` → `master`.

## Risques connus

- v17 sans `GRANT EXECUTE TO authenticated` = money-path morte (caveat S51) — vérifié par ancre pgTAP + smoke EF.
- Collision Sidebar/ReportsIndexPage entre 2b et 2d → séquencement imposé (2d après 2b).
- `evaluate_promotions_v2` : tout caller POS/EF référençant `evaluate_promotions_v1` par nom doit être repointé (grep obligatoire Tâche 1a).
- Ratchet lint : si un fichier S57 est sale, corriger le fichier — ne pas affaiblir la règle.
