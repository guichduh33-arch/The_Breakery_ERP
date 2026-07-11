# Ruflo — Claude Code Configuration

## Rules

- Do what has been asked; nothing more, nothing less
- NEVER create files unless absolutely necessary — prefer editing existing files
- NEVER create documentation files unless explicitly requested
- NEVER save working files or tests to root — this is a pnpm/turbo monorepo: code goes in `apps/{pos,backoffice}/src`, `packages/{domain,supabase,ui,utils}/src`, or `supabase/{functions,migrations,tests}`. Co-locate tests in `__tests__/` next to the code.
- ALWAYS read a file before editing it
- NEVER commit secrets, credentials, or .env files
- Keep files under 500 lines
- Validate input at system boundaries

## Active Workplan

> Per-session history (S13→S49: specs, plans, INDEX files, numbered deviations) lives in
> `docs/workplan/{specs,plans}/` and `docs/superpowers/{specs,plans}/`, with merged sessions
> under `archive/`. **Do not duplicate that history here** — link to the dated file instead.
> Plans/specs are dated, append-only history: never rewrite a past plan; create a new dated file.

- **In flight — Refonte module Reports POS (`apps/pos/src/features/reports`, PAS le BO), par lots :** chaque lot = 1 RPC serveur **lecture pure** gaté `reports.sales.read` (mêmes gardes P0001 + tz WITA `business_config`), **périmètre partagé avec l'Overview** (`status IN (paid,completed)`, hors `b2b`/`is_historical_import`/produit `is_test`) → les KPI réconcilient entre onglets ; export CSV par vue ; money-path v17/v11/v5 **non touché**. Branches empilées, 1 PR/lot. **Lot A** ✅ mergé master (#189) — `get_pos_sales_overview_v1` (`_146`, Overview KPIs + fix graphe tz WITA + flag `products.is_test`). **Lot B** draft #190 — `get_pos_payment_breakdown_v1` (`_147`, encaissé par mode). **Lot C** draft #191 — `get_pos_voids_refunds_v1` (`_148`, voids/refunds + remises/comps, avant/après cuisine). **Lot D** draft #192 — `get_pos_sessions_report_v1` (`_149`, onglet Sessions/Z-report : 1 ligne/tiroir remplace les compteurs open/close « 4≠2 », réconciliation 3-volets **figée** depuis `audit_logs` `shift.close` ; onglet Activity → flux ventes). **Lot E** (PR à ouvrir) — `get_pos_order_type_category_mix_v1` (`_150`, mix par `order_type` dine_in/take_out/delivery **réconcilie exactement l'Overview** + performance par catégorie ligne-à-ligne hors annulées/cadeaux-promo). **Reste** : **Lot F** — marge/COGS Option A (migration money-path-isolée + revue opus). Chaque lot : pgTAP live + smoke POS + typecheck + build verts, types **greffés** (DEV-S69-03).
- **In flight:** rien — **CRUD customer categories + prix négocié B2B LIVRÉS (S69)** : fiches **08 D2.1** (page catégories devient un vrai CRUD, ferme D-W6-CUSTCAT-01) et **09 B1.1** (prix négocié par client) fermées — table `customer_product_prices` + perm `customer_prices.manage` + `create_b2b_order_v5` (résolution serveur négocié > catégorie > retail). Restent ouverts : **Vague 2 ✅ complète** (le seul chantier restant, **cycle de livraison B2B, est ANNULÉ** — décision propriétaire 2026-07-10 : pas de **livraison motorisée** B2B, les clients pros **retirent leur commande sur place** ; **E2E nightly ✅ LIVRÉ S71**) · **Vague 3** (spec « mise en prod » — **REPORTÉE**, décision propriétaire 2026-07-07 : « attendre la fin totale du développement » ; snapshot COGS ; QC réception ; mode hors-ligne). **S70 livrée** (fiche 12 D2.4 — rapport BO « écarts par caissier », lecture pure). **S71 livrée** (E2E nightly Playwright : 12 specs vertes en run combiné 26 passed/2 fixmes/0 failed + cron `0 22 * * *` armé, cf. Merged latest). **Prochaine session (S72)** : Vague 2 soldée (cycle de livraison B2B annulé le 2026-07-10) ; restent la **Vague 3** (REPORTÉE, décision 2026-07-07), la **Description v1.3** et l'inventaire ⚫ non-câblé résiduel. Dettes S70 : `docs/workplan/plans/2026-07-08-session-70-INDEX.md` (D-1..D-3, dont **D-1 : mock smoke `total_short` positif vs RPC négatif — render-only** ; **D-3 : écarts QRIS/carte via `audit_logs` `shift.close`, session pré-S67 → volets NULL/0**). Dettes S69 : `docs/workplan/plans/2026-07-08-session-69-INDEX.md` (D-1..D-5, dont **D-3 : générateur de types MCP divergent — `get_stock_levels_v1` périmé côté DB, fns internes `_*`, types greffés sur master pour éviter le drift** ; **D-4 : `create_b2b_order_v5` sur produit soft-deleted sans prix négocié → `no_data_found` brut, edge UI-inatteignable**). Dettes S68 : `docs/workplan/plans/2026-07-08-session-68-INDEX.md` (D-1..D-5, dont **D-4 : rendu live du template `b2b_invoice` via l'EF non invoqué end-to-end** — vérifié structurellement, à exercer au 1ᵉʳ usage ; **D-1 : `isPending` partagé désactive tous les boutons PDF pendant un fetch**) ; dettes S67 : INDEX S67 (D-1..D-8, dont **D-1 : volet carte `card`+`edc` jamais testé avec de vraies lignes `order_payments`** et **D-8 : grille d'ouverture client-only, pas de RPC d'open**) ; dettes S66 : INDEX S66 (D-1..D-5 + **finding F-1 : le lockout `_verify_pin_with_lockout` des RPCs PIN-in-arg ne persiste pas les échecs — l'exception qui suit annule l'UPDATE du compteur ; touche les 6 RPCs S38, seul le chemin EF compte durablement**) ; dettes S65 : INDEX S65 (D-1..D-8 ; D-9 ✅ soldée S66) ; dettes S64 : INDEX S64 (D-1..D-7, dont **enforcement serveur des méthodes désactivées** — l'EF accepte toujours les 6) ; dettes S63 : INDEX S63 (D-1..D-12 ; I-1 ✅ fixé S64).
- **Deferred (S51+) :** dettes « cutover sain » non soldées (#129) — POS-view `security_invoker` (casserait la cascade CASHIER/waiter), privatisation bucket `product-images`, `search_path` des fn INVOKER, Leaked Password Protection (manuel), secret repo optionnel `SUPABASE_ANON_KEY` pour les tests anon-path de la CI live-RPC (le secret `SUPABASE_SERVICE_ROLE_KEY` est présent depuis 2026-06-27 ; le `fetch failed` du job venait du fallback localhost `VITE_SUPABASE_URL`, corrigé S58 — cf. rapport T4) ; follow-ups S51 — `quote_order_pricing_v1` (reçu pré-paiement, si divergence constatée), isolation subagents.
- **Merged (latest):** **S71 — E2E nightly Playwright : infra + réparation spec-par-spec + cron (branche `swarm/session-71`, 2 plans).** Chantier **Vague 2** « E2E nightly » livré. **Plan 1** (infra) : webServer build-in-CI (les 2 apps servies en local contre le backend dev V3, pas de staging hébergé), **users E2E dédiés** (`0e2e0000-…-001` owner/ADMIN + `…-002` cashier/CASHIER, migration **`20260710000141`** additive+idempotente, PINs jamais commités), `scripts/e2e/provision-pins.sql` (PINs depuis secrets CI + **seed d'un shift ouvert** idempotent), workflow `playwright-e2e.yml`. **Plan 2** (réparation, **exécution sub-agent-driven**) : les **12 specs vertes en run combiné** — **26 passed / 2 skipped (fixmes) / 0 failed** — puis **cron nightly armé `0 22 * * *`** (`workflow_dispatch` conservé). Login unifié sur `openPosSession`/`openBackofficeSession` + **login résilient au rate-limit** (`fixtures/auth.ts` : observe `auth-verify-pin`, sur 429 attend la fenêtre Retry-After et rejoue — indispensable car l'EF est limité ~3/min/IP et le nightly enchaîne 12 logins depuis 1 IP). Réécritures `opname-finalize`/`po-receive`/`complete-order` sur le DOM réel ; fixes sélecteurs `s39` (`status-pills`), `s41` (nav `link` pas `tab`), `kiosk` (`.or()` + `display-pair-prompt`), `stock-inventory` T4 (bouton ligne « View »), versions RPC `s43` (`fire_v4`/`pay_v11`). **2 `test.fixme` documentés** = 2 findings app pour le propriétaire (hors périmètre gelé) : **s44 T3** void-order EF 422 sur commande firée non payée ; **s43 T2** `/tablet/order` exige `sales.create` dans les perms du login, bloqué par une **dérive de schéma EF** (`_shared/permissions.ts` lit `user_permission_overrides` avec `user_id`/`override_type` périmés vs `user_profile_id`/`is_granted` live → override ignoré du login ; `has_permission()` DB correct). **Contrainte money-path/app tenue** : diff Plan 2 = uniquement `tests/e2e/**` + `scripts/e2e/**` + `.github/workflows/**`. Revue finale **opus** READY TO MERGE (2 Important I1 throw-on-exhaust / I2 retry-budget traités sur-le-champ). **Action utilisateur post-merge** : poser 3 secrets repo (`VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`). Déviations DEV-S71-P2-01..06 + dettes D-1..D-4 dans l'INDEX `docs/workplan/plans/2026-07-09-session-71-INDEX.md`.
- **Previously merged (S70):** **S70 — Rapport des écarts de caisse par caissier (branche `swarm/session-70`).** **Fiche 12 D2.4 fermée** (répond au scénario « manque récurrent le mardi ») : nouveau RPC **lecture pure** `get_cashier_variance_v1(p_start_date, p_end_date)` (migration **`20260710000140`**, `plpgsql STABLE SECURITY DEFINER`, gate **`reports.read`** 42501, garde `invalid_date_range` P0001, tz `business_config id=1`) agrège `pos_sessions` groupées par **`opened_by`** (propriétaire du tiroir — un shift fermé par un manager reste attribué au caissier, PAS `closed_by` comme la fiche le suggérait) sur **3 volets** : écart **cash** depuis la colonne figée `pos_sessions.variance_total`, écarts **QRIS/carte** depuis les **`audit_logs` `shift.close`** (`metadata->>'variance_qris'/'variance_card'`, `LEFT JOIN LATERAL`) — jamais recalculés depuis `order_payments` (stables même si des commandes sont annulées post-clôture) ; enveloppe `{ cashiers[], totals }` triée par `cash.total_short` ASC + **matrice cash par jour de semaine** (le signal « mardi »). Trio S20 complet (ligne `ALTER DEFAULT PRIVILEGES` ajoutée en fix pattern-guardian, miroir `_138`/`_139`). **BO** : hook `useCashierVariance` (42501→`permission_denied`) + page `CashierVariancePage` (miroir `SalesByStaffPage` : table 3 volets + `—` volet non compté + matrice dow + **export CSV**, pas de PDF v1) + route/sidebar/tuile gatées `reports.read`. **Zéro écriture DB, aucune migration destructive, money-path v17/v11/v5/fire_v4/`_record_sale_stock_v1` NON modifiés** (ancre **`s44_money_gates` 12/12** re-passée live, `num_failed=0`). pgTAP **`cashier_variance` 14/14 live** (attribution opened_by incl. manager-close, tz, QRIS depuis metadata incl. session pré-S67 NULL, filtre fenêtre, gate anon+no-perm) ; smoke BO 3/3. Types **greffés** (DEV-S69-03). Revue subagent-driven (task-reviewer T5 spec ✅+Approved ; pattern-guardian 13/14 PASS, 1 MEDIUM fixé). Déviations DEV-S70-01..02 + dettes D-1..D-3 dans l'INDEX `docs/workplan/plans/2026-07-08-session-70-INDEX.md`.
- **Earlier merged (S69):** **S69 — CRUD Customer Categories + prix négocié par client B2B (branche `worktree-session-69`).** Ferme fiches **08 D2.1** et **09 B1.1**. **Volet A (hors money-path)** : RPCs CRUD `customer_categories` (`create/update/delete_customer_category_v1`, migration **`20260710000135`** — invariant défaut, delete bloqué si clients rattachés `category_in_use`, soft-delete idempotent ; ⚠️ fix revue : gardes NULL `p_is_default`/discount/multiplier) + RPCs overrides catégorie `upsert/delete_product_category_price_v1` (**`_136`**, gate `customer_categories.update`) ; BO : `CategoryFormModal` + `CustomerCategoriesPage` en CRUD réel (ferme D-W6-CUSTCAT-01), `PricingTab` overrides `custom` éditables. **Volet B (sous garde money-path)** : table **`customer_product_prices`** `(customer,product,price)` + perm **`customer_prices.manage`** (**`_137`**, RLS auth_read + lockdown DML) + RPCs `upsert/delete_customer_product_price_v1` (**`_138`**) ; helper interne **`_resolve_b2b_line_price_v1`** (négocié client > prix catégorie > retail) + **`create_b2b_order_v4 → v5`** (**`_139`**, corps LIVE v4 verbatim + **exactement 3 edits** : 2 lectures prix → résolution serveur, garde `price_unresolved` P0002, audit `v5-s69` ; DROP v4, GRANT authenticated) — le `unit_price` client est **ignoré**, credit-check et facturation sur le prix résolu ; BO : `NegotiatedPricesSection` sur la fiche client + prefill modal B2B + `useCreateB2bOrder` repointé v5. **POS et money-path POS (`complete_order_with_payment_v17`) inchangés.** Décisions propriétaire 2026-07-08 : prix par CLIENT · B2B seulement · overrides type `custom` · delete bloqué si rattachés · les 2 volets · perm dédiée. pgTAP live : `customer_category_crud` **17/17**, `product_category_prices` **9/9**, `customer_product_prices_rls` **12/12**, **`b2b_negotiated_price` 5/5** ; ancres re-vertes v5 : **`b2b_settlement` 14/14**, `b2b_display_aware_stock` 3/3, `b2b_order_flag_aware` A/B/C, `b2b_foundation` 15/15, `b2b_invoice` blocs 2+4, **`s44_money_gates` 12/12 (POS non touché)** ; smokes BO 6/6·5/5·5/5. Types **greffés sur master** (DEV-S69-03 : générateur MCP divergent — évite le drift `get_stock_levels_v1`/fns internes). Suite monorepo verte (typecheck 7/7, build 3/3, `pnpm test` exit 0 avec env VITE — 767 tests). Revue subagent-driven (1 reviewer/tâche ; T7 money-path en **opus** : « byte-identique hors 3 edits »). Déviations DEV-S69-01..04 + dettes D-1..D-5 dans l'INDEX `docs/workplan/plans/2026-07-08-session-69-INDEX.md`.
- **Earlier merged (S50–S68) — pointeurs ; détail complet dans chaque INDEX daté `docs/workplan/plans/*-session-NN-INDEX.md`** (déviations DEV-SNN-*, dettes D-*, ancres pgTAP). En bref, de la plus récente à la plus ancienne : **S68** facture PDF B2B (série annuelle `INV/YYYY/NNNNN`, `orders.invoice_number`, `create_b2b_order_v4`, template EF `b2b_invoice`) · **S67** clôture caisse comptage 3-volets cash/QRIS/carte + comptage par coupure opt-in (`close_shift_v5`, `denominations.ts`) · **S66** PIN manager sur gros écart de clôture (`close_shift_v4`, seuils `business_config.shift_variance_pin_threshold_*`) · **S65** workspace `apps/print-bridge` (contrat V2 octet-exact + scan réseau) + CRUD BO LAN Devices · **S64** moyens de paiement configurables (`business_config.enabled_payment_methods`, `useEnabledPaymentMethods` fail-open) + fix I-1 voids même-jour · **S63** dashboard BO réel (`get_dashboard_overview_v1`, lecture pure) · **S62** purges actées (mesh LAN mort, `print_queue` droppée, PWA, `rbac.update`) + plafond ardoise serveur (`customers.retail_credit_limit`, `attach_tab_customer_v1`) · **S61** findings S58 F-2/F-5 (`_record_sale_stock_v1` P0002, allowlist `import_catalog_v1`) + décommissionnement léger péremption (cron off, purge UI, `stock_lots` dormant) · **S60** 6 quick wins money-path (ardoise payable `/pos/debts`, `close_shift_v3` note-écart enforced, promo nommées sur ticket, `kds_bump_order_v1`) · **S59** vague 1 lot 1 (F-1 P0 dernier-admin `is_active`, F-4 P1 expense-VAT foldé, `create_tablet_order_v3` +`p_notes`, KDS câblé) · **S58** vague 0 (chaîne d'embauche `list_login_users_v1` anon, PIN 6 chiffres partout, nightly pgTAP trié + quarantaine) · **S57** gouvernance promos/combos serveur (`_resolve_combo_price_v1`, `complete_order_with_payment_v17`, caps `promotions.max_uses*` sous advisory lock) + marge brute (`get_gross_margin_by_product_v1`) — **leçon DEV-S57-02 : tout bump/copie de RPC part du corps live `pg_get_functiondef`, jamais du fichier de migration d'origine** · **S56** UI déférées (annual close, B2B invoices multi-alloc) + `audit_logs` unique surface (vue `audit_log` droppée) · **S55** durcissement EF (idempotency reversals `void_order_rpc_v4`/`cancel_order_item_rpc_v3`, discount-PIN via nonce `discount_authorizations`, `_v16`) · **S54** correctness compta (`check_fiscal_period_open` fail-closed, `close_fiscal_year_v1`, fix leak cumul `get_trial_balance_v3`) · **S53** déduction stock unifiée (`_record_sale_stock_v1`, `create_b2b_order_v3` display-aware, `pay_existing_order_v11` flag-aware) · **S52** B2B per-invoice settlement (`b2b_payment_allocations`, `record_b2b_payment_v2`, `cancel_b2b_order_v1`) · **S50/S51** prix-ligne canonique serveur (`complete_order_with_payment_v15`, `_resolve_line_price_v1`, `useTaxRate` lit `business_config.tax_rate`) + tranche intégrité 2a-i. Historique S50 vague 1 « cutover sain » (#129 : gates 5 RPCs financiers `_v2`, fuites `audit_log`/MV fermées) et antérieur (S13→S49, #122 négatif-stock, #125 dispatch/print, #124 route-split) dans `docs/workplan/` + archive [`docs/workplan/2026-06-26-claude-md-workplan-archive.md`](docs/workplan/2026-06-26-claude-md-workplan-archive.md).
- **⚠️ Migration-bookkeeping caveat (toujours actif, hérité #122) :** un `supabase migration repair` d'un subagent a abîmé le bookkeeping cloud `schema_migrations` (~400 lignes clock-stamped supprimées ; max `20260629000012`) — schéma réel intact, workflow MCP `apply_migration` non affecté ; non reconstruit.
- **Latest on `master`:** PRs **#162–#165** (2026-07-07, sessions parallèles à S67) — table dine-in obligatoire + transfert tracé `transfer_order_table_v1` (migrations `_121`/`_122` + garde `fire_v4`), extras produits SFG (#163), customer display split (#164), fix routage skills. ⚠️ **collision de NAME-block `_121`/`_122` avec S67, résolue en renumérotant S67 en `_125..128`** (cf. DEV-S67-07 dans l'INDEX S67). Avant : #157/#160/#161 (design vagues A/B/C — a11y/tokens/cohérence), #156 (S66)…#132 — détail par PR dans l'archive workplan.
- **Migrations:** numbering is monotonic. Check `supabase/migrations/` for the highest NAME-block before picking the next. Cloud `version`s are clock-assigned (S36+ convention); local file names use the NAME-block. Always regen types after a schema change (see Build & Test). **Jamais de `BEGIN;`/`COMMIT;` dans le corps d'une migration** — MCP `apply_migration` wrappe déjà dans une transaction ; un COMMIT interne la termine prématurément et affaiblit l'atomicité (leçon S58).
- **Next-session source:** `docs/workplan/remise-a-plat/00-INDEX.md` (vagues 0→3 + décisions + règle money-path) et les sections D des fiches `NN-*.md`. L'ancien backlog-by-module est archivé (`docs/_archive/backlog-by-module-fige-S14-S30/`, priorités périmées — ne plus trier dedans).
- **Execution skill:** invoke `superpowers:subagent-driven-development` (or `superpowers:executing-plans`) before running a phase — one subagent per isolated phase, parallelizable per Wave.
- **Module reference (canonical):** [`docs/workplan/remise-a-plat/`](docs/workplan/remise-a-plat/) — fiches réel-vs-demandé par module (code vérifié `5b0fa92`, 2026-07-04). `docs/reference/04-modules/` est STALE (S13) et ne fait plus foi ; hiérarchie de vérité complète dans `docs/README.md`. Chapitres reference dangereux (01/03/07/08/09/10) **supprimés** le 2026-07-04 — régénération depuis le code en Phase 3.

## Project Conventions (The Breakery ERP)

### Critical patterns — don't break these
- **DB target is Supabase cloud, NOT local Docker** — As of 2026-05-14, Docker / local supabase stack is **retired** on this machine. All migrations, RPCs, pgTAP tests, and types regen run against the V3 dev project on the cloud: **`ikcyvlovptebroadgtvd`** (`the-breakery-v3-dev`, region `ap-southeast-1`, Pro plan $10/mo) — dashboard: <https://supabase.com/dashboard/project/ikcyvlovptebroadgtvd>. Apply migrations via `mcp__claude_ai_Supabase__apply_migration`, run SQL via `execute_sql`, regen types via `generate_typescript_types`. **DO NOT run** `pnpm db:reset`, `supabase start`, `supabase db reset`, or `bash supabase/tests/run_pgtap.sh` — they require Docker and will fail. Prod (ref `abjabuniwkqpfsenxljp`) is V2 monolith and incompatible with V3 migration lineage.
- **PIN auth fetch wrapper** — the `auth-verify-pin` EF issues HS256 JWTs that GoTrue (ES256) can't validate via the default header. The Supabase client uses a custom fetch wrapper that injects the PIN JWT on every request via `setSupabaseAccessToken` (in `packages/supabase`). Never bypass with raw `Authorization` headers or `auth.setSession`.
- **Realtime channel names must be unique per mount** — StrictMode double-mounts components and shared channel names collide silently. See `apps/pos/src/features/kds/hooks/useKdsRealtime.ts`.
- **`packages/domain` is IO-free** — no `fetch`, no Supabase, no React. Pure TS, unit-testable.
- **Order writes go through RPCs** — never raw inserts. The POS POSTs the `process-payment` EF (`apps/pos/src/features/payment/hooks/useCheckout.ts`), which server-side calls the current money-path RPC `complete_order_with_payment_v17` (`supabase/functions/process-payment/index.ts`) — the POS never calls it directly ; le PIN discount est vérifié in-EF et transporté par un nonce `discount_authorizations` (S55, plus de PIN en arg SQL) ; **les combos sont validés ET pricés serveur** via le helper interne `_resolve_combo_price_v1` (S57 — composition vs `combo_groups`, surcharges facturées) et **les plafonds promo** (`promotions.max_uses`/`max_uses_per_customer`) sont hard-gatés sous advisory lock dans v17 et `pay_existing_order_v11`. Other order RPCs: `pay_existing_order_v11` (S53 flag-aware, S57 cap-gated), `fire_counter_order_v4`, `create_tablet_order_v3` (S59, +`p_notes`), `pickup_tablet_order` (unversioned), `evaluate_promotions_v2` (S57, filtre advisory des caps), `mark_item_served` (unversioned), `void_order_rpc_v4` / `cancel_order_item_rpc_v3` (S55, idempotency replay, EF-only). B2B order/AR RPCs: `create_b2b_order_v5` (S53 display-aware, S68 assigns `invoice_number`, S69 server-resolves the line price — negotiated > category > retail — via `_resolve_b2b_line_price_v1`, client `unit_price` ignored), `record_b2b_payment_v2`, `cancel_b2b_order_v1`, `adjust_b2b_balance_v2`, `get_pos_b2b_debts_v3`, `reconcile_b2b_balance_v1` (+ append-only `b2b_payment_allocations`). They handle JE triggers, loyalty, promotions, table state atomically. **Sale-time stock deduction (S53 P1.4)** : les 3 RPCs de vente (`complete_order_with_payment_v17`, `create_b2b_order_v5`, `pay_existing_order_v11`) déduisent via l'unique helper interne **`_record_sale_stock_v1`** (flag-aware + display isolation) — plus aucun `INSERT INTO stock_movements` brut en flux de vente. **RPC versions bump nearly every session — always verify the live version in `supabase/migrations/` + the call-site before relying on a number.**
- **Audit-trail = table `audit_logs` UNIQUEMENT (S56)** — la vue compat `audit_log` (singulier) et son trigger INSTEAD-OF sont **droppés** (`_087`/`_088`). Vocabulaire canonique : `entity_type`/`entity_id`/`metadata`/`actor_id`/`created_at`. Deux colonnes JSONB voulues : `metadata` (contexte free-form — cible de tous les writers RPC) et `payload` (diff before/after, S19) — **ne pas fusionner**. Jamais d'INSERT direct depuis app code ; les RPCs SECURITY DEFINER écrivent. Lecture BO via `get_audit_logs_v1/_v2` (RLS `admin_read`). Suite garde-fou : `supabase/tests/audit_consolidation.test.sql`.
- **`stock_movements` is an append-only ledger** — RLS revokes UPDATE/DELETE for `authenticated`. All writes go through SECURITY DEFINER RPCs (`record_stock_movement_v1` primitive ; `adjust_stock_v1`, `receive_stock_v1`, `record_incoming_stock_v1`, `waste_stock_v1`, future `*_transfer_v1` / `record_production_v1` / `finalize_opname_v1`). Never `INSERT INTO stock_movements` directly from app code or tests.
- **`stock_movements.unit` is NOT NULL** — any direct insert (tests, fixtures, RPCs) must populate `unit`. The `record_stock_movement_v1` primitive auto-resolves from `products.unit` if NULL is passed — don't bypass it. See migration `20260516000019_fix_record_stock_movement_v1_unit.sql`.
- **`stock_movements` section constraint is movement-type-aware** — `transfer_in/out` require both `from_section_id` AND `to_section_id` ; `adjustment*`, `waste`, `incoming`, `purchase`, `sale*`, `production*`, `opname*` require at least one (relaxed in migration `20260516000020`). Don't tighten without re-checking all RPCs.
- **`stock_movements.unit_cost` is per BASE unit** — receive must convert BOTH qty (×factor) AND cost (÷factor) to the base unit before recording; `purchase_order_items.unit_cost` stays per purchase unit (supplier price). All readers do `qty × cost`. Fixed 2026-06-20 (`receive_purchase_order_v2` + backfill, PR #103).
- **Inventory RPCs accept `p_idempotency_key UUID`** — replay returns the existing movement row instead of doubling it. Always pass one from the client on retry-able mutations.
- **RPC versioning is monotonic** — never edit a published `_vN` signature. Create `_vN+1` and `DROP FUNCTION ... vN(<old args>)` in the same migration if replacing. See `20260516000019` (drop original `record_stock_movement_v1` then recreate with `unit`).
- **Supabase auto-grants EXECUTE on public functions to `anon`** — `REVOKE ALL FROM PUBLIC` does NOT cancel it. Always add an explicit `REVOKE EXECUTE ... FROM anon` on admin-only RPCs to enforce gate intent at the role level (defense in depth). See S19 migration `20260523000022` for an example.
- **Anon GRANT defense-in-depth (S20)** — `REVOKE ALL FROM anon ON public.*` is the project-wide default for tables, views, AND functions, future-proofed via `ALTER DEFAULT PRIVILEGES FOR ROLE postgres`. Critical caveat: `REVOKE EXECUTE ... FROM anon` on functions is INSUFFICIENT on its own — `anon` inherits EXECUTE through PUBLIC membership via the `=X/postgres` ACL entry. Future REVOKE-on-functions migrations MUST also `REVOKE EXECUTE ... FROM PUBLIC` and `ALTER DEFAULT PRIVILEGES FOR ROLE postgres ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`. See S20 migrations `20260524000020..031`. `supabase_admin`-owned extension objects (pgtap: `pg_all_foreign_keys`, `tap_funky`, pgtap helper functions) are platform-managed and not user-revocable — pgTAP suite excludes them. If a future feature legitimately needs anon (public landing-page RPC, embeddable widget), grant explicitly per-object with `COMMENT ON FUNCTION ... IS 'anon-callable: <reason>'`.
- **PIN / auth secrets en header HTTP, jamais en body JSON (S25)** — Any EF that consumes a manager PIN or other validation secret MUST read it from a dedicated HTTP header (e.g., `x-manager-pin`), NEVER from the JSON body. Rationale : request bodies get logged by default in PostgREST access logs, pgaudit, reverse proxies, and Supabase function logs ; headers are far less commonly captured. Hard cutover pattern : drop the body field in the SAME commit as the header read — no dual-mode fallback unless the EF has uncontrolled external callers (rare on this project, only POS calls these EFs). Reference : S25 `refund-order` migration body `manager_pin` → header `x-manager-pin` (`supabase/functions/refund-order/index.ts`). Sweep **DONE** : `void-order` + `cancel-item` hardened S34/PR #53 ; `kiosk-issue-jwt` verified compliant S36 (DEV-S36-A-01) ; all three read `x-manager-pin` from the header.
- **Idempotency 2-flavors selon la sémantique (S25)** — Two distinct patterns coexist on this project ; pick the right one for the flow :
  1. **HTTP `x-idempotency-key` header (EF retry safety)** — For HTTP requests where the client may legitimately retry (flaky network, double-click, React-Query auto-retry). The client generates a UUID v4 (`crypto.randomUUID()` stored in a `useRef` so it survives re-renders), sends it via header. The EF reads via `getIdempotencyKey(req)` from the shared helper `supabase/functions/_shared/idempotency.ts` (1 export, validates UUID regex, returns `string | null`) and propagates it as `p_idempotency_key` arg to the RPC. Reference : S25 `refund-order` EF + `refund_order_rpc_v2` (the RPC already had the arg from S13, only the EF + POS wiring was missing).
  2. **RPC arg `p_client_uuid` / `p_idempotency_key` (idempotence sémantique métier)** — For RPCs where idempotency is intrinsic to the business flow (e.g., "this cart, this tap" for tablet, "this payment record" for B2B, "this stock movement record" for inventory). The arg is REQUIRED at the RPC level (NOT NULL CHECK) and used as the primary key of a **dedicated** idempotency-keys table (never as a nullable column on the business table — isolation makes REVOKE simpler and avoids polluting the metric tables). Concurrency race handled via PK `unique_violation` catch + re-read. References : `create_tablet_order_v3(p_client_uuid)` with `tablet_order_idempotency_keys` (S25, bumped v3 S59), `record_b2b_payment_v2(p_idempotency_key)` with `b2b_payments.idempotency_key UNIQUE` (S24, bumped v2 S52), `record_stock_movement_v1` & family (S12). Replay returns the result of the first successful execution — by convention, RPCs return either the exact same value or an envelope `{ ..., idempotent_replay: true }` so callers can audit.

### Git
- Branches: `swarm/session-N` for ongoing session work, `feat/<scope>` or `fix/<scope>` for focused PRs. For phased plans, prefer `swarm/session-N` and squash-merge per phase.
- Commits: conventional commits (`feat(scope): …`, `fix(scope): …`, `test(scope): …`, `docs(scope): …`, `refactor(scope): …`). Co-author Claude when AI-assisted.

### Garde-fou anti-dérive documentaire (checklist fin de session)
> Issu de l'audit de gouvernance 2026-07-09 (`docs/workplan/audits/2026-07-09-audit-general-gouvernance.md`). But : qu'un lecteur (humain ou agent) ouvrant un fichier isolé sache en 1 seconde s'il fait foi.
```
FIN DE SESSION Sxx — avant merge :
□ CLAUDE.md « In flight » / « Merged (latest) » mis à jour (nouvelle session).
□ remise-a-plat : bandeau « Mise à jour Sxx » ajouté aux fiches touchées
   (verdicts C-Bx.x réconciliés avec le bandeau, pas seulement le header).
□ Aucune version RPC EN DUR ajoutée dans un skill/agent — nom non-versionné
   + « vérifier CLAUDE.md/migrations » (les money-path bumpent quasi chaque session).
□ Préfixe MCP écrit = mcp__claude_ai_Supabase__ (jamais le plugin désactivé).
□ Nouveau lien inter-doc = chemin RELATIF vérifié depuis l'emplacement final.
□ Aucun fichier « à créer » cité comme source vivante s'il n'existe pas.
□ Types regen commit si migration (cause #1 de CI cassée).
□ Fichier > 500 lignes ? scinder.
```
**Contrôle trimestriel** (grep de dérive V2, hors `_archive/` et docs datées) : `abjabuniwkqpfsenxljp`, `AppGrav`, `breakery-platform`, `vite-plugin-pwa`, `Capacitor`, `complete_order_with_payments` (pluriel), `PIN à 4`, `audit_log ` (singulier), `mcp__plugin_supabase` → toute occurrence = à corriger. Linkcheck `docs/**/*.md` (hors `_archive/`) : 0 lien mort en zone vivante.

## Agent Comms (SendMessage-First Coordination)

Named agents coordinate via `SendMessage`, not polling or shared state.

```
Lead (you) ←→ architect ←→ developer ←→ tester ←→ reviewer
              (named agents message each other directly)
```

### Spawning a Coordinated Team

```javascript
// ALL agents in ONE message, each knows WHO to message next
Agent({ prompt: "Research the codebase. SendMessage findings to 'architect'.",
  subagent_type: "researcher", name: "researcher", run_in_background: true })
Agent({ prompt: "Wait for 'researcher'. Design solution. SendMessage to 'coder'.",
  subagent_type: "system-architect", name: "architect", run_in_background: true })
Agent({ prompt: "Wait for 'architect'. Implement it. SendMessage to 'tester'.",
  subagent_type: "coder", name: "coder", run_in_background: true })
Agent({ prompt: "Wait for 'coder'. Write tests. SendMessage results to 'reviewer'.",
  subagent_type: "tester", name: "tester", run_in_background: true })
Agent({ prompt: "Wait for 'tester'. Review code quality and security.",
  subagent_type: "reviewer", name: "reviewer", run_in_background: true })

// Kick off the pipeline
SendMessage({ to: "researcher", summary: "Start", message: "[task context]" })
```

### Patterns

| Pattern | Flow | Use When |
|---------|------|----------|
| **Pipeline** | A → B → C → D | Sequential dependencies (feature dev) |
| **Fan-out** | Lead → A, B, C → Lead | Independent parallel work (research) |
| **Supervisor** | Lead ↔ workers | Ongoing coordination (complex refactor) |

### Rules

- ALWAYS name agents — `name: "role"` makes them addressable
- ALWAYS include comms instructions in prompts — who to message, what to send
- Spawn ALL agents in ONE message with `run_in_background: true`
- After spawning: STOP, tell user what's running, wait for results
- NEVER poll status — agents message back or complete automatically

## Swarm & Routing

Reach for a multi-agent swarm (3+ agents) on: new features, cross-module refactors, API changes, security, performance. Use a single agent (or none) for: 1–2 line fixes, docs, config changes, questions.

| Task | Suggested agents |
|------|------------------|
| Bug fix | researcher, coder, tester |
| Feature | architect, coder, tester, reviewer |
| Refactor | architect, coder, reviewer |
| Security | security-architect, security-auditor |

> Optional tooling: the `claude-flow` / `ruflo` CLI (`npx @claude-flow/cli@latest …`) and its MCP coordination/memory tools (`memory_store`, `memory_search`, `swarm_init`, `agent_spawn`, `hooks_route`) are available — discover schemas via `ToolSearch("keyword")` if a task needs cross-session memory or hook routing. Day-to-day work uses the Agent + SendMessage team above and the project skills below.

## Agents

**Generic types** (any string works as a custom type): `coder`, `reviewer`, `tester`, `planner`, `researcher`, `system-architect`, `backend-dev`, `security-architect`, `security-auditor`, `performance-engineer`, `pr-manager`, `release-manager`, the coordinators (`hierarchical-coordinator`, `mesh-coordinator`, `adaptive-coordinator`), etc.

### Project agents & skills (The Breakery — adaptés au projet)

The repo versions a **specialized team** (PR #55). **Agents** (`.claude/agents/*.md`) are spawnable via the Agent tool ; **skills** (`.claude/skills/<name>/SKILL.md`) auto-trigger via their frontmatter `description` ONLY (the harness matches the prompt against it — `pathPatterns`/`promptSignals` are inert metadata, kept as documentation ; descriptions rewritten "pushy" with FR+EN trigger phrases 2026-07-07). Each points back to this CLAUDE.md as the source of truth and verifies the real schema (migrations/MCP) before asserting a fact.

**Agents** (`.claude/agents/`) :
- `pos-specialist` (sonnet) — `apps/pos/`
- `backoffice-specialist` (sonnet) — `apps/backoffice/`
- `db-engineer` (sonnet) — `supabase/migrations/` + RPCs (versioning, REVOKE pairs, MCP V3)
- `edge-functions-engineer` (sonnet) — `supabase/functions/` (PIN header, idempotency, rate-limit)
- `pattern-guardian` (sonnet, **read-only**) — reviews a diff vs the Critical patterns above
- `test-engineer` (sonnet) — pgTAP/Vitest/smoke + baseline env-gated
- `session-coordinator` (**opus**) — orchestration `swarm/session-N` (spec→plan→waves→closeout)

**Skills** (`.claude/skills/`, auto-triggered) :
- `stock-management` — inventory/recipes/production/WAC/lots
- `accounting` — COA/JE/PB1 NON-PKP/fiscal/GL/TB · `b2b-credit` — AR/credit-limit/b2b_payments
- `reports-exports` — report RPCs/PDF/CSV/Z-report/drill-down · `expense-governance` — thresholds/SOD/multi-step
- `products-catalog` — products CRUD/variants/categories · `orders` — lifecycle/list v2/edit-items/void/refund
- `security-auth` — RLS/REVOKE/perms/PIN-JWT/rate-limit · `breakery-ui-kit` — conventions `packages/ui`
- `db-migrations` — migration/RPC hygiene (versioning monotone/REVOKE trio/types-regen/cloud-MCP, miroir agent `db-engineer`) · `edge-functions` — discipline EF Deno (PIN-header/idempotency 2-saveurs/fetch-wrapper PIN-JWT/hard-cutover, miroir agent `edge-functions-engineer`) — **ajoutés 2026-07-07** pour combler les 2 trous de complémentarité (domaines les plus casse-CI sans skill auto-déclenché)

Design : `docs/superpowers/specs/2026-05-31-agents-skills-team-design.md` (spec) + `docs/superpowers/plans/2026-05-31-agents-skills-team.md` (plan). `.gitignore` versions the root `.md` files of `.claude/agents/` ; the ruflo subfolders stay ignored.

### Plugin skill routing (MANDATORY — invoke BEFORE acting)

Plugin skills under-trigger by default. On this project, route these task shapes to their plugin skill **before** any other action (their descriptions live in the plugin cache and can't be tuned — this table is the trigger) :

| Si la tâche est… | Invoque D'ABORD |
|---|---|
| Nouvelle feature / « ajoute / crée / construis X » | `superpowers:brainstorming` puis `feature-dev:feature-dev` |
| Bug, test rouge, comportement inattendu (« ça marche pas », « pourquoi ça fait ça ») | `superpowers:systematic-debugging` |
| Implémenter une feature/bugfix (après brainstorm/plan) | `superpowers:test-driven-development` |
| Exécuter un plan daté (`docs/workplan/plans/*.md`) | `superpowers:subagent-driven-development` ou `superpowers:executing-plans` |
| « C'est fini / ça passe / prêt à merger » — avant toute affirmation de succès | `superpowers:verification-before-completion` puis `superpowers:requesting-code-review` |
| Branche terminée, décider merge/PR/cleanup | `superpowers:finishing-a-development-branch` |
| Revue du diff courant / d'une PR | `code-review` intégré (`/code-review`, PR → `/review`) |
| Simplifier/refactorer du code récent sans changer le comportement | `simplify` intégré (`/simplify`) |
| Question sur une lib/framework/SDK (React, Supabase, Tailwind…) | `find-docs` (Context7) — jamais de mémoire d'entraînement |
| Nouvelle UI visuelle (pas POS) | `frontend-design:frontend-design` (POS → `pos-design-craft` local) |
| CLAUDE.md à auditer/mettre à jour | `claude-md-management:*` |
| Créer/modifier une skill | `skill-creator:skill-creator` |

Le tableau complète (ne remplace pas) la règle superpowers « 1% de chance qu'une skill s'applique → invoque-la ».

## Build & Test

- ALWAYS run tests after code changes
- ALWAYS verify build succeeds before committing
- This project uses **pnpm 9.15** + **turbo** — never `npm`

### Local commands (no Docker required)
```bash
pnpm build && pnpm test     # turbo run build / turbo run test --concurrency=1
pnpm typecheck               # turbo run typecheck
```

### DB workflow — Supabase cloud staging (Docker retired 2026-05-14)
All DB operations target the cloud V3 dev project `ikcyvlovptebroadgtvd`. **Do NOT run** `pnpm db:reset`, `supabase start`, or `bash supabase/tests/run_pgtap.sh` — Docker is gone.

| Operation | MCP tool | Notes |
|---|---|---|
> ⚠️ Le serveur MCP Supabase actif est le **connecteur claude.ai** (préfixe `mcp__claude_ai_Supabase__`) — le plugin `supabase@claude-plugins-official` (préfixe `mcp__plugin_supabase_supabase__`) est présent en cache mais **désactivé** (2026-07-07). Si le préfixe change, chercher les outils via ToolSearch("supabase apply migration").

| Apply migration | `mcp__claude_ai_Supabase__apply_migration` | `project_id='ikcyvlovptebroadgtvd'`, `name` in snake_case, body = SQL. Wrapped in transaction. |
| Run SQL (incl. pgTAP) | `mcp__claude_ai_Supabase__execute_sql` | Use `BEGIN ... ROLLBACK` envelope for pgTAP. Extension `pgtap` already enabled. |
| Regen types | `mcp__claude_ai_Supabase__generate_typescript_types` | Returns `{ types: "..." }` — write to `packages/supabase/src/types.generated.ts` and commit. |
| Check drift | `mcp__claude_ai_Supabase__list_migrations` | Compares `supabase_migrations.schema_migrations` to local. |
| Direct psql (rare) | `postgresql://postgres.ikcyvlovptebroadgtvd:<URL_ENCODED_PWD>@aws-1-ap-southeast-1.pooler.supabase.com:5432/postgres` | Always go through the pooler — `db.<ref>.supabase.co` has no DNS A record. |

Dashboard: <https://supabase.com/dashboard/project/ikcyvlovptebroadgtvd>

### Targeted iteration (much faster than full suite during phase work)
```bash
pnpm --filter @breakery/supabase test inventory     # Vitest live RPC tests
pnpm --filter @breakery/backoffice test inventory   # BO smoke + unit
pnpm --filter @breakery/domain test inventory       # pure-TS unit
```

After Supabase schema changes (new migration via MCP `apply_migration`), **always** regen types via `mcp__claude_ai_Supabase__generate_typescript_types`, write to `packages/supabase/src/types.generated.ts`, and commit. A missing regen is the #1 cause of broken CI on this repo.

### Inventory phase test layout
- pgTAP (DB): `supabase/tests/inventory.test.sql` (steady-state suite) + `supabase/tests/inventory_phase1_complete.test.sql` (phase 1 acceptance — T1-T15+).
- Vitest live RPC: `supabase/tests/functions/inventory-*.test.ts` (per-phase, one file per RPC family).
- Domain unit: co-located `__tests__/` in `packages/domain/src/inventory/`.
- BO smoke/unit: co-located `__tests__/` in `apps/backoffice/src/features/inventory*/`.
