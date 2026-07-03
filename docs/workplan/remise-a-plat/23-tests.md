# Module 23 — Qualité & tests

> ⚠️ **Mise à jour S58 (2026-07-04, `swarm/session-58`)** : **D1 + D2 (triage) livrés** — 28/33 suites re-vertes (16 réparées), 3 quarantaines datées (`supabase/tests/_quarantine/`), 2 rouges assumées tests intacts (`users` F-1, `expenses` F-4) ; le job live-RPC est réparé (cause réelle : fallback `localhost:54321` faute de `VITE_SUPABASE_URL` exportée — ni clé ni secret) ; drift types nul + comparaison normalisée `--schema public` ; dette CLAUDE.md corrigée. C-B1.2 passe de 🟠 à ≈✅ (2 tripwires documentés). Détail : session INDEX S58. Le reste de la fiche reste daté `5b0fa92`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 23. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel sur les flux critiques
> **Verdict global de l'analyse :** La doc est fidèle sur la chaîne PR (bloquante et verte) mais **surclame sur le nightly** : les parcours navigateur « chaque nuit » échouent toutes les nuits en ~10 s (environnement de staging jamais provisionné), et la batterie DB complète nightly est actuellement rouge (33 suites sur 131 en échec + drift de types + job live-RPC en erreur réseau).

## A. Ce qui fonctionne réellement (code vérifié)

- **CI PR/push bloquante et verte** (`.github/workflows/ci.yml`) : garde anti-re-CREATE de `has_permission` (l.39-63), **gate types-regen** (nouvelle migration sans regen de `types.generated.ts` = échec, escape hatch `[types-noop]`, l.77-103), lint full non-bloquant (dette ~250 erreurs, l.105-112), **lint-ratchet bloquant** sur fichiers touchés (l.128-144), typecheck, tests unitaires (TZ épinglée `Asia/Jakarta`, l.162), build, artefacts coverage+dist. Derniers runs verts (ex. 28660964213, 2026-07-03). [CI]
- **Smoke pgTAP bloquant à la PR** (`.github/workflows/pgtap-pr.yml`) : 9 suites critiques (REVOKE/money-flow : `ci_smoke`, `security*`, `financial_rpc_perm_gates`, `products_cost_price_guard`…) exécutées contre le cloud V3 dev via pooler, `continue-on-error: false` (l.35), déclenché seulement si la PR touche `supabase/**`. Derniers runs verts (54 s). [CI]
- **Batterie pgTAP : 131 fichiers de suites** dans `supabase/tests/*.test.sql` (comptés), couvrant money-path (`canonical_line_price`, `combo_sale`, `s44_money_gates`), promos (`promotion_usage_caps`), compta (`close_fiscal_year_v1`, `trial_balance_v3_cumulative`), sécurité (`security_leak_guard`, `security_anon_grants`), stock, B2B… [DB]
- **Vitest live-RPC : 62 fichiers** dans `supabase/tests/functions/*.test.ts` (process-payment, auth-verify-pin rate-limit, generate-pdf, inventory-*, promotions-*…). [DB/EF]
- **Tests unitaires/smoke apps + packages : ~467 fichiers** — 138 dans `apps/pos/src`, 202 dans `apps/backoffice/src`, 127 dans `packages/*` (dont 39/41 composants `@breakery/ui` testés, focus-trap des modales inclus). [Unit]
- **Suite E2E Playwright : 12 specs** dans `tests/e2e/` (complete-order, pos-login-order, opname-finalize, po-receive, s44-money-path…), config `playwright.config.ts` (projets pos/backoffice, retries 2, serial). Workflow nightly `.github/workflows/playwright-e2e.yml` (cron 22:00 UTC + dispatch). [E2E — voir écart C-B1.3]
- **Nightly DB** (`.github/workflows/pgtap-nightly.yml`) : job pgTAP complet via pooler + job `live-rpc-vitest` (fail-fast si `SUPABASE_SERVICE_ROLE_KEY` absent, l.93-96) + job `drift-checks` (types vs DB live, comptage `schema_migrations` informatif). Commentaire auto sur issue de suivi en cas d'échec (l.49-66). [CI]
- **Secrets CI réellement présents** (vérifié `gh secret list`) : `V3_DEV_PG_POOLER_URL` (2026-05-16) et `SUPABASE_SERVICE_ROLE_KEY` (**2026-06-27** — la note « secret manquant » de CLAUDE.md est périmée).

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 — Chaque PR déclenche vérification du code, tests, compilation ; rien ne passe si c'est rouge.
- B1.2 — Batterie DB : « plus d'une centaine de vérifications vertes sur l'environnement réel » (prix serveur, plafonds promo, verrous financiers).
- B1.3 — Parcours complets automatisés (connexion, vente, réception) « tournent chaque nuit dans un vrai navigateur ».
- B1.4 — Contrôle qualité à cliquet interdisant toute nouvelle dégradation.

### B2. Annoncé « À venir »
- B2.1 — Couvrir les écrans de rapports (pages sans test de base).
- B2.2 — Seuils de couverture par module.
- B2.3 — Tests visuels par comparaison de captures.
- B2.4 — Mutualiser les jeux de données de test (fixtures).
- B2.5 — Surveillance de la performance avec alerte.

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | PR : lint+tests+build bloquants | `ci.yml` vert et bloquant (typecheck/tests/build/ratchet/types-gate) + `pgtap-pr.yml` bloquant sur les PRs DB. Nuances : lint full-repo non-bloquant (par design ratchet) ; le smoke pgTAP ne se déclenche pas sur une PR front-only (filtre paths) | ✅ CONFORME |
| B1.2 | 100+ vérifications DB **vertes** sur l'env réel | 131 suites existent et tournent contre le cloud, mais le **nightly complet du 2026-07-02 est rouge : 33/131 fichiers en échec** (accounting, combo_sale, s44_money_gates, promotions_bogo, zreports…) ; le vert n'est démontré que sur le sous-ensemble smoke PR (9 suites) et les ancres re-passées en session | 🟠 PARTIEL |
| B1.3 | Parcours navigateur chaque nuit | Workflow + 12 specs existent, mais **échec toutes les nuits en 8-13 s** (runs 28625338279, 28551955260…) : les secrets `STAGING_POS_URL`/`STAGING_BO_URL`/`E2E_PIN_*` n'existent pas (repo n'a que 2 secrets) et aucun hébergement front staging n'est actif (étapes Vercel `if: false` dans `staging-deploy.yml:150-174`). Les specs n'ont jamais tourné en nightly | 🔴 MANQUANT |
| B1.4 | Cliquet anti-dégradation | lint-ratchet bloquant (`ci.yml:128-144`), inauguré vert en S57 | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Gate types-regen (`ci.yml:77-103`) + drift-check nightly des types contre la DB live — la doc ne mentionne pas cette protection anti-drift.
- 🔵 Garde `has_permission` (`ci.yml:39-63`) — verrou historique spécifique non décrit.
- 🔵 TZ CI épinglée Asia/Jakarta (`ci.yml:162`) — protège les tests d'horaires de promo.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
- **Réparer le drift de types** : le job `drift-checks` échoue (« types.generated.ts is stale relative to the live DB schema »). Regénérer via MCP `generate_typescript_types`, committer, et vérifier que la sortie du CLI (`supabase gen types --db-url`) est bien byte-comparable à celle du MCP (si non : normaliser la comparaison dans le workflow). Done : job drift vert.
- **Diagnostiquer le job live-RPC** : il échoue en `TypeError: fetch failed` (réseau/clé — pas des assertions). Vérifier la validité de `SUPABASE_SERVICE_ROLE_KEY` (rotation des clés API Supabase ?) et l'URL en dur `https://ikcyvlovptebroadgtvd.supabase.co` (`pgtap-nightly.yml:76`). Done : suite Vitest s'exécute (même avec échecs de tests, plus d'erreur fetch). ⚠️ à confirmer en DB live/dashboard.
- **Mettre à jour CLAUDE.md** : la dette « secret repo SUPABASE_SERVICE_ROLE_KEY (bloque la CI live-RPC) » est périmée — le secret existe depuis le 2026-06-27 ; le blocage actuel est un échec réseau/clé, pas un secret manquant.

### D2. Chantiers moyens (1 session, plan requis)
- **Triage des 33 suites pgTAP rouges du nightly** : liste exacte extraite du run 28616370303 (accounting, accounting_account_id_exposed, bakery_reports, catalog_import, category_station_remap, combo_reversal, combo_sale, complete_order_v10_display, counter_fire, customers_pii_gate, discount_auth_nonce, expenses, f6_sub_recipes, idempotency_hardening, inventory, inventory_f1_lots, inventory_production, kds_extensions, loyalty_transactions_append_only, m9_reports_hardening, modifier_ingredient_deduction, order_discount_gate, orders_list_v1, promotions_bogo, purchasing_po, reports, reports_pnl_bs_cf, reversal_idempotency, s44_money_gates, sale_flag_aware_deduction, update_product_v1, users, zreports). Hypothèse probable : staleness d'ancres vs schéma post-S56/S57 (précédent : 3 staleness réparées en S56) — mais `combo_sale`, `s44_money_gates` et `discount_auth_nonce` sont des ancres money-path : à traiter en priorité. Done : nightly pgTAP vert ou liste d'exclusions assumée et datée.
- **Étendre le smoke PR aux ancres money-path** : ajouter `canonical_line_price`/`combo_sale`/`promotion_usage_caps` au sous-ensemble `pgtap-pr.yml` une fois réparées (le scénario doc « un changement promo casse un combo → bloqué à la PR » n'est garanti aujourd'hui que si la PR touche `supabase/**`).
- **Couverture des écrans de rapports (B2.1)** : générer des smoke tests par page sur le modèle `ReportPage.emptyState.smoke.test.tsx`.

### D3. Chantiers lourds (spec dédiée avant code)
- **Remettre le E2E nightly en état de marche** : dépend entièrement du provisionnement staging (module 24 D3) — hébergement des fronts + secrets `STAGING_*_URL`/`E2E_PIN_*` + seed users (cf. `.github/workflows/STAGING_SETUP.md`). Tant que ce n'est pas fait, envisager un fallback « E2E contre `pnpm dev` local dans le runner CI » (les specs supportent déjà `E2E_BASE_URL=http://localhost:5173`, `playwright.config.ts:25`) — spec courte pour trancher.
- **Seuils de couverture (B2.2), tests visuels (B2.3), fixtures mutualisées (B2.4), perf-budgets (B2.5)** : chantiers distincts, chacun à cadrer.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- **B1.3 à requalifier immédiatement** : remplacer « tournent chaque nuit dans un vrai navigateur » par « suite E2E écrite (12 parcours) et planifiée, en attente de l'environnement d'essai hébergé » — la formulation actuelle décrit un dispositif qui n'a jamais produit un run vert.
- **B1.2 à nuancer** : « plus d'une centaine de suites, dont un noyau sécurité/money-path vert et bloquant à chaque PR ; le passage complet nocturne est en cours de stabilisation ».

## E. Dépendances croisées

- **Module 24 (Mises à jour & exploitation)** : le E2E nightly (C-B1.3) est bloqué par la chaîne staging (hébergement fronts + secrets) — même racine que l'écart majeur du module 24.
- **Module 22 (design system)** : le lint-ratchet et le garde-fou modale vivent dans la même CI ; les smoke tests de rapports (D2) s'appuient sur `ReportPage`.
- **Tous les modules métier** : les 33 suites rouges du nightly touchent compta, combos, promos, stock, z-reports — leur triage doit être coordonné avec les propriétaires de ces modules (risque de vraies régressions masquées, pas seulement de la staleness).
