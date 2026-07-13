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

- **Refonte module Reports POS ✅ SOLDÉE (S74, 2026-07-12) (`apps/pos/src/features/reports`, PAS le BO), par lots :** chaque lot = 1 RPC serveur **lecture pure** gaté `reports.sales.read` (mêmes gardes P0001 + tz WITA `business_config`), **périmètre partagé avec l'Overview** (`status IN (paid,completed)`, hors `b2b`/`is_historical_import`/produit `is_test`) → les KPI réconcilient entre onglets ; export CSV par vue ; money-path v17/v11/v5 **non touché**. Branches empilées, 1 PR/lot. **Lots A→G ✅ TOUS mergés master** : **A** (#189) `get_pos_sales_overview_v1` (`_146`) · **B** (#190) `get_pos_payment_breakdown_v1` (`_147`) · **C·D·E** (#193) `get_pos_voids_refunds_v1` (`_148`) + `get_pos_sessions_report_v1` (`_149`, Sessions/Z-report 1 ligne/tiroir, réconciliation 3-volets figée `audit_logs` `shift.close`) + `get_pos_order_type_category_mix_v1` (`_150`, réconcilie exactement l'Overview) · **F·G Products + Activity** (#194, 2026-07-11) `get_pos_top_products_v1` (`_151`) + `get_pos_activity_v1` (`_152`) ; l'onglet **Activity a ensuite été scindé Sales | Journal par S72** (journal d'audit, cf. Merged latest). **Fix Overview ✅ MERGÉ master** (#207, 2026-07-12) : `_153` `items_sold`+`by_day` (body-only, appliqué cloud — vérifié live ; garde S50 passée via `[types-noop]`, le regen ne diffère que par le bruit partitions `pos_events_2026_*` exclu par la greffe) + page/graphe Overview refaits en dashboard, Overview 6/6 + reports 42/42 verts. **Lot Margin/COGS ✅ MERGÉ master** (#208, 2026-07-12, dernier lot — S74) : `get_pos_margin_v1` (`_160`, lecture pure, **gate `reports.financial.read`** — pas sales.read, miroir du gate marge BO) — COGS = **WAC courant** `products.cost_price` (caveat permanent UI ; snapshot COGS reste Vague 3), périmètre ≡ Overview (réconciliation `revenue_ttc` assertée pgTAP T7), promo-gift comptés en COGS avec revenue 0, compteur `products_without_cost` + badge, onglet permission-filtré + route `/pos/reports/margin`, CSV ; pgTAP 13/13 live, reports 10 fichiers/49 tests verts, pattern-guardian 14/14. Plan : `docs/workplan/plans/2026-07-12-session-74-margin-plan.md`. Chaque lot : pgTAP live + smoke POS + typecheck + build verts, types **greffés** (DEV-S69-03).
- **In flight :** rien — **S75 ✅ MERGÉE master** (2026-07-13 : #210 squashé dans la branche lot 1 puis #209 squashé master `dcff3abc`, cf. Merged latest). Précédent : **CRUD customer categories + prix négocié B2B LIVRÉS (S69)** : fiches **08 D2.1** (page catégories devient un vrai CRUD, ferme D-W6-CUSTCAT-01) et **09 B1.1** (prix négocié par client) fermées — table `customer_product_prices` + perm `customer_prices.manage` + `create_b2b_order_v5` (résolution serveur négocié > catégorie > retail). Restent ouverts : **Vague 2 ✅ complète** (le seul chantier restant, **cycle de livraison B2B, est ANNULÉ** — décision propriétaire 2026-07-10 : pas de **livraison motorisée** B2B, les clients pros **retirent leur commande sur place** ; **E2E nightly ✅ LIVRÉ S71**) · **Vague 3** (spec « mise en prod » — **REPORTÉE**, décision propriétaire 2026-07-07 : « attendre la fin totale du développement » ; snapshot COGS ; QC réception ; mode hors-ligne). **S70 livrée** (fiche 12 D2.4 — rapport BO « écarts par caissier », lecture pure). **S71 livrée** (E2E nightly Playwright : 12 specs vertes en run combiné 26 passed/2 fixmes/0 failed + cron `0 22 * * *` armé, cf. Merged latest). **S72 livrée** (journal d'audit opérationnel POS, cf. Earlier merged). **S73 livrée** (refonte Settings POS + BO, 3 lots, cf. Previously merged — ferme la fiche 19 tuiles Soon ; **B5 NPWP reporté**). **S74 livrée** (2026-07-12 : fix Overview #207 + lot Margin/COGS #208 — la **refonte Reports POS est soldée**, cf. bullet Reports ci-dessus). **S75 livrée et mergée** (2026-07-13 : Floor Plan BO + KDS Configuration, PRs #209/#210 — cf. Merged latest). **Prochaine session (S76)** : Vague 2 soldée (cycle de livraison B2B annulé le 2026-07-10) ; restent la **Vague 3** (REPORTÉE, décision 2026-07-07), la **Description v1.3** et l'inventaire ⚫ non-câblé résiduel. Dettes S70 : `docs/workplan/plans/2026-07-08-session-70-INDEX.md` (D-1..D-3, dont **D-1 : mock smoke `total_short` positif vs RPC négatif — render-only** ; **D-3 : écarts QRIS/carte via `audit_logs` `shift.close`, session pré-S67 → volets NULL/0**). Dettes S69 : `docs/workplan/plans/2026-07-08-session-69-INDEX.md` (D-1..D-5, dont **D-3 : générateur de types MCP divergent — `get_stock_levels_v1` périmé côté DB, fns internes `_*`, types greffés sur master pour éviter le drift** ; **D-4 : `create_b2b_order_v5` sur produit soft-deleted sans prix négocié → `no_data_found` brut, edge UI-inatteignable**). Dettes S68 : `docs/workplan/plans/2026-07-08-session-68-INDEX.md` (D-1..D-5, dont **D-4 : rendu live du template `b2b_invoice` via l'EF non invoqué end-to-end** — vérifié structurellement, à exercer au 1ᵉʳ usage ; **D-1 : `isPending` partagé désactive tous les boutons PDF pendant un fetch**) ; dettes S67 : INDEX S67 (D-1..D-8, dont **D-1 : volet carte `card`+`edc` jamais testé avec de vraies lignes `order_payments`** et **D-8 : grille d'ouverture client-only, pas de RPC d'open**) ; dettes S66 : INDEX S66 (D-1..D-5 + **finding F-1 : le lockout `_verify_pin_with_lockout` des RPCs PIN-in-arg ne persiste pas les échecs — l'exception qui suit annule l'UPDATE du compteur ; touche les 6 RPCs S38, seul le chemin EF compte durablement**) ; dettes S65 : INDEX S65 (D-1..D-8 ; D-9 ✅ soldée S66) ; dettes S64 : INDEX S64 (D-1..D-7, dont **enforcement serveur des méthodes désactivées** — l'EF accepte toujours les 6) ; dettes S63 : INDEX S63 (D-1..D-12 ; I-1 ✅ fixé S64).
- **Deferred (S51+) :** dettes « cutover sain » non soldées (#129) — POS-view `security_invoker` (casserait la cascade CASHIER/waiter), privatisation bucket `product-images`, `search_path` des fn INVOKER, Leaked Password Protection (manuel), secret repo optionnel `SUPABASE_ANON_KEY` pour les tests anon-path de la CI live-RPC (le secret `SUPABASE_SERVICE_ROLE_KEY` est présent depuis 2026-06-27 ; le `fetch failed` du job venait du fallback localhost `VITE_SUPABASE_URL`, corrigé S58 — cf. rapport T4) ; follow-ups S51 — `quote_order_pricing_v1` (reçu pré-paiement, si divergence constatée), isolation subagents.
- **Merged (latest):** **S75 — Floor Plan BO + KDS Configuration (PRs #209 lot 1 + #210 lot 2 empilée, mergées master 2026-07-13 — les 2 dernières tuiles « Planned » du hub Settings : le hub n'a plus AUCUNE tuile Soon/Planned).** **Lot 1 Floor Plan** : `table_sections` + `restaurant_tables.section_id` + backfill du hack `sort_order>=100` + **6 RPCs CRUD** gatés `tables.create/update/delete` (S11) — writes **RPC-only** (policies S11 `perm_create`/`perm_update` droppées), gardes `table_occupied` (commande vive keyed `orders.table_number`) / `section_in_use` / seats 1-20, migrations `_161` + `_162` (**DEV-S75-01** : RLS lecture élargie aux inactives, soft-deleted masqués) + `_164` (grants-consistency, findings pattern-guardian) ; page BO `/backoffice/settings/floor-plan` (Deactivate/Reactivate = flip `is_active` via update RPC — réversible ; Delete séparé gaté `tables.delete`) ; POS/tablette groupés par **vraies sections** (`bucketTablesBySection`, occupancy/transfert intouchés). **Lot 2 KDS Configuration** : 3 colonnes `business_config.kds_*` (défauts 5/10/5, gardes entier 1..120 + warning<urgent, **ERRCODE 22023** = convention live, migration `_163` regreffée **corps live** DEV-S57-02, appliquée via runner API-from-file — 22 Ko > limite MCP) + catégorie RPC `kds` ; hook POS **`useKdsConfig`** (fallback silencieux défauts, NULL traité absent) consommé par KdsOrderCard/useKdsAlarm/KdsBoard ; **chips StationFilter enfin câblés** (`products → categories.kds_station`, item NULL passe tous les chips ; fix latent `CategoryFormDialog` : kitchen/pastry/bakery violaient le CHECK → hot/cold/bar/prep/expo) ; page BO `/backoffice/settings/kds` (validation client warning<urgent + **ordre de save anti-22023**). pgTAP **24/24** + **13/13** live (re-verts closeout), types **greffés**, root typecheck+build verts, money-path intouché (pattern-guardian : 0 HIGH, 2 MEDIUM soldés `_164`). INDEX : `docs/workplan/plans/2026-07-12-session-75-INDEX.md` (DEV-S75-01..08, dettes D-1..D-11 dont **D-3 : un onglet section POS disparaît à 0 table active dans le fetch — à exposer propriétaire** ; **D-1 héritée : légende `reserved` toujours sans producteur**).
- **Previously merged (S73):** **Refonte modules Settings POS + BO, 3 lots empilés (branche `swarm/session-73-settings`).** Source : audit validé propriétaire 2026-07-11 (`docs/workplan/audits/settings-pos-bo-audit.md`). **Lot 1 POS** : verrou `settings.update` effectif sur **tous** les onglets POS Settings (P0 : Printing était éditable sans permission), onglet **Automation supprimé** (Printing = surface unique des auto-toggles), rename « Customer Display », badges de portée **org vs terminal**, URL imprimante éditable sur le seul onglet Printing, **presets de remise câblés** dans les modals de remise cart + ligne (`pos_discount_presets` via prop `DiscountModal`). **Lot 2 org DB** (`_159`) : 4 colonnes `business_config` (`display_footer_message`, `display_slogan`, `pos_auto_print_receipt`, `pos_auto_open_drawer`) + catégories RPC `customer_display`/`printing` (CREATE OR REPLACE depuis le corps live, DEV-S57-02) ; le POS lit la copy display + auto-toggles depuis l'org (localStorage droppé, hard cutover) ; pages BO Customer Display + Printing ; types **greffés** (DEV-S69-03). **Lot 3 BO** : hub **zéro tuile Soon en cul-de-sac** (liée/implémentée/retirée ; Floor Plan + KDS Config visibles « Planned (dedicated session) », tuiles Security/Accounting gatées, tuile Settings History → `/backoffice/reports/audit?action=setting.update`, AuditPage lit `?action=`), pages **POS Configuration** (`pos_presets`) + **Notifications** (`notification_templates`, update-only, gate d'édition `notifications.send` = la policy RLS write), **General durci** (currency/timezone selects ISO/IANA, `tax_rate`+seuils `_pct` affichés en % — stockage décimal [0,1] inchangé, **garde anti-régression assertée** : save 25 % → `p_value: 0.25`), sidebar Payment Methods, **dictionnaire typé** `packages/supabase/src/settings-keys.ts` (9 catégories, test de conformité no-dup) + doc `docs/reference/settings-authority-model.md` (org DB fait foi ; terminal localStorage `pos:settings` = printerUrl/deviceCode/defaultOrderType). Money-path non touché. 15 tâches, chacune revue (spec + qualité) Approved. Détail : INDEX `docs/workplan/plans/2026-07-11-session-73-settings-INDEX.md`.
- **Earlier merged (S72):** **Journal d'audit opérationnel POS, 5 lots (branche `swarm/session-72-pos-audit-journal`).** L'onglet Activity devient un **vrai journal d'audit** : chaque manipulation opérateur, par terminal, immuable, résiliente offline **sans perte ni doublon**. **Lot 1** (`_154`/`_155`/`_156`) : **`pos_devices`** (token opaque localStorage, auto-provision `unknown`, nommage manager `register_pos_device_v1`) + **`pos_events`** **partitionnée par mois** (purge = DROP partition ; partitions 2026_07..09 + DEFAULT) **append-only strict** (RLS SELECT `reports.audit.read`, REVOKE DML, trigger UPDATE/DELETE → `0A000`), enum `pos_event_type` 34 valeurs, idempotence `UNIQUE (client_event_id, occurred_at)` + **`record_pos_events_v1`** (ingest batch `ON CONFLICT DO NOTHING`, write authentifié). **Lot 2** (`apps/pos/src/features/audit/`) : outbox **IndexedDB** (fallback localStorage jsdom) + `emitPosEvent` **fire-and-forget qui ne jette jamais** (enveloppe figée à l'émission, lazy-import supabase — DEV-S72-05) + `PosEventOutboxMount` (flush mount/online/30 s, toutes routes POS) ; fraude d'abord : `cash_drawer_opened` (vente + **manuel**), `session_opened`, `payment_failed`. **Lot 3** : émission fine additive (emits APRÈS `set`, reducers purs) — cartStore (order_opened/item_added/qty/removed_pre_fire/voided_post_fire/order_type/table/discounts), paiement (method_selected/started/completed), cuisine (`sent_to_kitchen` post-succès fire, `kitchen_bumped`), held (order_held/resumed), reçus (printed/**reprinted**). **Lot 4** (`_157`) : **`get_pos_events_v1`** keyset `(occurred_at,id) DESC` (filtres types/device/actor/order, facettes+total page 1, gate `reports.audit.read`) + UI **Sales | Journal** (chips famille, selects terminal/opérateur, **timeline par ticket**, signaux de contrôle **rouges**, WITA, scroll infini, CSV). **Lot 5** (`_158`, même signature) — **« source unique » réinterprétée (DEV-S72-06)** : dériver les chiffres financiers du flux client = régression de confiance → le journal fusionne **à la lecture** gestes client ∪ **outcomes serveur** (`sale_completed` ← orders **réconcilie exactement l'Overview (asserté)**, `order_voided` type synthétique reader-only, `refund_issued` partiels, `session_opened` **dédupé**/`session_closed`) ; onglets financiers inchangés sur les tables money-path ; lignes dérivées `payload.source='server'` + badge UI. **Money-path byte-identique** : ancre **`s44_money_gates` 12/12 re-passée au closeout (`num_failed=0`)**, pattern-guardian **14/14 × 2** en cours de session + revue de branche au closeout. pgTAP live : `pos_events` **9/9** · `pos_events_reader` **13/13** (re-verte post-`_158`) · `pos_events_unified` **8/8** (dont réconciliation exacte). POS : outbox 9/9, journal+activity 11/11, reports 41/41, typecheck 7/7, build vert. Types **greffés** (DEV-S69-03). ⚠️ Suite POS complète : flakiness timeout **pré-existante** sous charge parallèle (D-5 — jeu non-déterministe, tout passe en isolation). Déviations DEV-S72-01..08 + dettes D-1..D-7 (dont **D-1 : types enum non émis** — login/logout/manager_pin_used/paid_in-out… candidats lot sécurité ; **D-2 : partitions/purge manuelles**, candidat pg_cron) dans l'INDEX `docs/workplan/plans/2026-07-11-session-72-INDEX.md`.
- **Earlier merged (S71):** E2E nightly Playwright livré (Vague 2) — 12 specs vertes en run combiné (26 passed/2 fixmes/0 failed), cron `0 22 * * *` armé, users E2E dédiés (migration `20260710000141`), login résilient au rate-limit (`fixtures/auth.ts`, EF ~3/min/IP). **Restent actifs** : 2 findings app hors périmètre (s44 T3 void-order EF 422 ; s43 T2 **dérive schéma EF** `_shared/permissions.ts` — lit `user_id`/`override_type` périmés vs `user_profile_id`/`is_granted` live) + **action utilisateur : poser 3 secrets repo** (`VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`). Détail complet : INDEX `docs/workplan/plans/2026-07-09-session-71-INDEX.md`.
- **Earlier merged (S70):** Rapport écarts de caisse par caissier (fiche 12 D2.4) — RPC lecture pure `get_cashier_variance_v1` (migration `_140`, gate `reports.read`, attribution **`opened_by`** pas `closed_by`, volets QRIS/carte depuis `audit_logs` `shift.close`) + page BO `CashierVariancePage` + matrice cash/jour de semaine. pgTAP 14/14, money-path non touché. Détail : INDEX `docs/workplan/plans/2026-07-08-session-70-INDEX.md`.
- **Earlier merged (S69):** CRUD customer categories + prix négocié par client B2B (fiches 08 D2.1 + 09 B1.1) — table `customer_product_prices`, perm `customer_prices.manage`, `_resolve_b2b_line_price_v1` (négocié > catégorie > retail), `create_b2b_order_v5` (migrations `_135..139`) ; le `unit_price` client est ignoré (voir Critical patterns). pgTAP 17/17·9/9·12/12·5/5 + ancres v5 re-vertes, POS/money-path POS inchangés. Détail : INDEX `docs/workplan/plans/2026-07-08-session-69-INDEX.md`.
- **Earlier merged (S50–S68) — pointeurs ; détail complet dans chaque INDEX daté `docs/workplan/plans/*-session-NN-INDEX.md`** (déviations DEV-SNN-*, dettes D-*, ancres pgTAP). En bref, de la plus récente à la plus ancienne : **S68** facture PDF B2B (série annuelle `INV/YYYY/NNNNN`, `orders.invoice_number`, `create_b2b_order_v4`, template EF `b2b_invoice`) · **S67** clôture caisse comptage 3-volets cash/QRIS/carte + comptage par coupure opt-in (`close_shift_v5`, `denominations.ts`) · **S66** PIN manager sur gros écart de clôture (`close_shift_v4`, seuils `business_config.shift_variance_pin_threshold_*`) · **S65** workspace `apps/print-bridge` (contrat V2 octet-exact + scan réseau) + CRUD BO LAN Devices · **S64** moyens de paiement configurables (`business_config.enabled_payment_methods`, `useEnabledPaymentMethods` fail-open) + fix I-1 voids même-jour · **S63** dashboard BO réel (`get_dashboard_overview_v1`, lecture pure) · **S62** purges actées (mesh LAN mort, `print_queue` droppée, PWA, `rbac.update`) + plafond ardoise serveur (`customers.retail_credit_limit`, `attach_tab_customer_v1`) · **S61** findings S58 F-2/F-5 (`_record_sale_stock_v1` P0002, allowlist `import_catalog_v1`) + décommissionnement léger péremption (cron off, purge UI, `stock_lots` dormant) · **S60** 6 quick wins money-path (ardoise payable `/pos/debts`, `close_shift_v3` note-écart enforced, promo nommées sur ticket, `kds_bump_order_v1`) · **S59** vague 1 lot 1 (F-1 P0 dernier-admin `is_active`, F-4 P1 expense-VAT foldé, `create_tablet_order_v3` +`p_notes`, KDS câblé) · **S58** vague 0 (chaîne d'embauche `list_login_users_v1` anon, PIN 6 chiffres partout, nightly pgTAP trié + quarantaine) · **S57** gouvernance promos/combos serveur (`_resolve_combo_price_v1`, `complete_order_with_payment_v17`, caps `promotions.max_uses*` sous advisory lock) + marge brute (`get_gross_margin_by_product_v1`) — **leçon DEV-S57-02 : tout bump/copie de RPC part du corps live `pg_get_functiondef`, jamais du fichier de migration d'origine** · **S56** UI déférées (annual close, B2B invoices multi-alloc) + `audit_logs` unique surface (vue `audit_log` droppée) · **S55** durcissement EF (idempotency reversals `void_order_rpc_v4`/`cancel_order_item_rpc_v3`, discount-PIN via nonce `discount_authorizations`, `_v16`) · **S54** correctness compta (`check_fiscal_period_open` fail-closed, `close_fiscal_year_v1`, fix leak cumul `get_trial_balance_v3`) · **S53** déduction stock unifiée (`_record_sale_stock_v1`, `create_b2b_order_v3` display-aware, `pay_existing_order_v11` flag-aware) · **S52** B2B per-invoice settlement (`b2b_payment_allocations`, `record_b2b_payment_v2`, `cancel_b2b_order_v1`) · **S50/S51** prix-ligne canonique serveur (`complete_order_with_payment_v15`, `_resolve_line_price_v1`, `useTaxRate` lit `business_config.tax_rate`) + tranche intégrité 2a-i. Historique S50 vague 1 « cutover sain » (#129 : gates 5 RPCs financiers `_v2`, fuites `audit_log`/MV fermées) et antérieur (S13→S49, #122 négatif-stock, #125 dispatch/print, #124 route-split) dans `docs/workplan/` + archive [`docs/workplan/2026-06-26-claude-md-workplan-archive.md`](docs/workplan/2026-06-26-claude-md-workplan-archive.md).
- **⚠️ Migration-bookkeeping caveat (toujours actif, hérité #122) :** un `supabase migration repair` d'un subagent a abîmé le bookkeeping cloud `schema_migrations` (~400 lignes clock-stamped supprimées ; max `20260629000012`) — schéma réel intact, workflow MCP `apply_migration` non affecté ; non reconstruit.
- **Latest on `master`:** PRs **#209 + #210** (mergées 2026-07-13, S75) — Floor Plan BO + KDS Configuration (#210 squashé dans la branche lot 1 puis #209 squashé master, cf. Merged latest ; le fail lint-ratchet du 1ᵉʳ run #209 venait d'erreurs **préexistantes** des fichiers de test touchés — assertions inutiles + `() => {}` — corrigées via génériques testing-library + `vi.fn()`) ; avant : **#208** (2026-07-12, S74) — lot Margin/COGS, **refonte Reports POS soldée** (cf. bullet Reports) ; #207 (2026-07-12) fix Overview ; avant : PRs **#189–#195, #200, #202** (2026-07-11) — refonte Reports POS lots A→G + S72 journal d'audit (cf. Merged latest), #200 lint-ratchet S72 soldé, **#202 fix CI** : `supabase/tests/package-lock.json` fantôme **supprimé** (dependabot le voyait comme un projet npm autonome → `ERR_PNPM_OUTDATED_LOCKFILE` sur chaque bump ; seul `pnpm-lock.yaml` racine fait foi), `pgtap-smoke` **skippé pour dependabot** (pas d'accès aux secrets Actions), **timeout CI 15→25 min** (la suite tourne 11-22 min selon runner, 2 runs verts tués le 2026-07-11). Avant : #162–#165 (2026-07-07, table dine-in + transfert `transfer_order_table_v1`, extras SFG, customer display split ; ⚠️ collision NAME-block `_121`/`_122` résolue en renumérotant S67 en `_125..128`, cf. DEV-S67-07), #157/#160/#161 (design), #156 (S66)…#132 — détail par PR dans l'archive workplan.
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
