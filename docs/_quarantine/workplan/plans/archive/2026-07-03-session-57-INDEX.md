# Session 57 — INDEX : P2 restant (gouvernance promos/combos, UX POS/BO, outillage, marge brute)

- **Date** : 2026-07-03 · **Branche** : `swarm/session-57`
- **Spec** : [`docs/superpowers/specs/2026-07-03-s57-p2-governance-ux-design.md`](../../superpowers/specs/2026-07-03-s57-p2-governance-ux-design.md)
- **Plan** : [`docs/superpowers/plans/2026-07-03-session-57-p2-governance-ux.md`](../../superpowers/plans/2026-07-03-session-57-p2-governance-ux.md)
- **Ouverture** : triage P2 par 5 agents lecture-seule (P2.1/P2.3/P2.4/P2.5/P2.6) croisant audit §7, backlog-by-module et code réel.

## Objectif

Solder la vague P2 de l'audit intégral 2026-06-27 (P2.2 soldé S56) : fermer les failles serveur combo/promo (T1/catalogue), livrer les correctifs UX POS (P2.3) et BO (P2.4), réparer l'outillage (P2.5), ajouter la marge brute par produit + le fix fuseau Payment-by-Method (P2.6).

## Livré

### Chantier A — P2.1 : combos serveur + plafonds promo (T1 fermé)
1. **`_resolve_combo_price_v1`** (`_090`) : helper interne SECURITY DEFINER STABLE (REVOKE PUBLIC+anon+authenticated) qui **valide la composition** (appartenance `combo_group_options`, min/max par `combo_groups` → `combo_invalid_component`/`combo_group_violation`, ERRCODE 23514) **et price** (`combo_base_price + Σ surcharge`) en un passage. Ferme le revenue leak A-D1 : les surcharges d'options combo sont désormais **facturées** (elles étaient affichées au client mais ignorées du total serveur).
2. **`complete_order_with_payment_v16 → v17`** (`_092`, DROP v16, ⚠️ GRANT authenticated préservé) : lignes combo pricées/validées via le helper dans les 2 boucles (les `product_modifiers` du combo restent résolus par `_resolve_line_price_v1`, inchangés) ; **gate dur plafonds** `pg_advisory_xact_lock(hashtext(promo_id))` + re-count avant l'INSERT `promotion_applications` (`promo_cap_exceeded`). Fix incident : `rpc_version` bloqué à `'v15'` dans 2 audit_logs depuis `_074`/`_086` → `'v17'`.
3. **Plafonds promo** (`_089`) : `promotions.max_uses` / `max_uses_per_customer` (INT NULL = illimité, CHECK > 0) — comptage sur `promotion_applications` JOIN `orders` non-voided (un void **libère** l'usage). **`evaluate_promotions_v1 → v2`** (`_091`, DROP v1, filtre advisory des caps ; commande anonyme → cap per-customer non applicable, global toujours actif ; `pay_existing_order_v11` repointé in-place). **`_095`** : fix — `_091` avait copié le corps v1 **historique** (`_082`) lisant `customers.tier_id`, colonne inexistante (la v1 live avait été patchée cloud-only) → lookup `category_id` seul, `customer_tier_ids` reste vestigial.
4. **EF `process-payment`** repointée v17 + mapping `combo_invalid_component`/`combo_group_violation`/`promo_cap_exceeded` (409), redéployée. Hook POS `useEvaluatePromotions` → v2. **A-D8** : `pay_existing_order_v11`/`create_b2b_order_v3` ne re-pricent aucun combo → pas de bump.
5. **UI** : champs plafonds dans `PromotionForm` (onglet Conditions, vide = illimité, rejet ≤ 0), câblés au save BO (round-trip édition vérifié).

### Chantier B — P2.6 : marge brute + fuseau Payment-by-Method
6. **`get_gross_margin_by_product_v1`** (`_093`) : revenue HT (`order_items.line_total`, net PB1) − COGS (`products.cost_price` **WAC courant** — caveat en COMMENT + UI, snapshot-à-la-vente → backlog P3) ; POS+B2B `paid`/`completed` non-voided, `is_cancelled` exclu ; bornes `business_config.timezone` ; clamp 366 j ; gate `reports.financial.read` ; retour `{period, summary, by_product[], by_category[]}` trié margin desc.
7. **`get_payments_by_method_v1 → v2`** (`_094`, DROP v1) : bucketing UTC en dur → `business_config.timezone` (bornes sargables, borne haute exclusive — corrige aussi la perte de la fraction 23:59:59.x de v1). ACL vérifiée live avant apply (GRANT authenticated explicite — l'hypothèse « pas de GRANT dans v1 » du premier jet était fausse et aurait cassé le rapport BO).
8. **BO** : `useGrossMargin` + **`GrossMarginPage`** (ReportPage + emptyState, filtres via `useUrlState`, caveat WAC visible, CSV `buildCsv`, drill-down produit, carte hub Financial + sidebar + route gatées `reports.financial.read`) ; `usePaymentsByMethod` + smoke repointés v2 (la page était cassée sur dev entre le DROP v1 et ce repoint).

### Chantier C — P2.3 : UX POS
9. **États d'erreur** : `isError` branché avant l'empty-state sur `ProductGrid`, `TabletProductGrid`, `KdsBoard` via le composant existant `ErrorState` (rouge + « Réessayer » → refetch ; réutilisation au lieu du `PosLoadError` prévu — anti-doublon). La cuisine ne peut plus confondre « erreur de chargement » et « aucune commande ».
10. **Reconnect KDS** : hook canonique `@/lib/useReconnectInvalidate` monté par la page KDS (invalidate au retour online — KDS était la seule surface realtime sans ce filet).
11. **Cibles tactiles caisse** : remove/discount `CartLineRow` 32→44 px, recherche 36→44 px, `QuantityStepper` (`packages/ui`) 32→44 px (zéro usage BO vérifié).
12. **`payment_complete` affichage client** : nouveau type broadcast `{total, change, method}` émis par `SuccessModal` (couvre fast-path et split), écran « Merci » 8 s puis welcome, monnaie masquée si ≠ cash, rétro-compatible (type inconnu ignoré par un ancien récepteur). + copy checkout des 3 nouveaux codes serveur.

### Chantier D — P2.4 : UX BO
13. **Empty-states** : prop `emptyState` sur `ReportPage` + ~18 pages reports converties (`EmptyState` seulement si `!isLoading && !error && vide`) ; états financiers (P&L/CashFlow/BS/PB1) et dashboards gardent leur structure KPI (déviation assumée).
14. **`useUrlState`** (+`useUrlBoolean`) : filtres date/compare des reports dans l'URL (`replace:true`, défauts prunés, pas de boucle) ; PB1 (mois/année) hors périmètre.
15. **Parité sidebar↔hub** : +4 reports en sidebar (production-yield, margin-watch, cost-spend, operating-expenses — gates = routes), +section Marketing au hub (4 cartes), +entrée **Security** en sidebar (gate `settings.security.manage`). **D-D4** : `PermissionGate accounting.read` sur la route index accounting (finding §6.3 soldé).

### Chantier E — P2.5 : outillage
16. **Scripts `db:*`** : `db:start/stop/reset` → stub explicite `exit 1` (Docker retiré) ; `db:types` → `supabase gen types --db-url` (pooler).
17. **Lint-ratchet CI bloquant** : eslint sur les fichiers `**/src/**` du diff PR (parité `pnpm lint` ; `supabase/` hors scope eslint — déviation assumée) ; step lint full-repo reste informatif ; règle `max-lines` 500 en warn. **Ratchet inauguré vert** : 80 erreurs des fichiers du diff soldées (49 auto-fix + 31 manuelles, 0 eslint-disable).
18. **Refactors > 500 l.** : `PromotionForm` 804→175 + 6 sous-fichiers (split pur vérifié bloc à bloc) ; `CustomerDetailPage` 643→316 + 5 panels. `routes/index.tsx`, `cartStore.ts`, `PurchaseOrderDetailPage` → backlog (blast-radius).

## Migrations

| # | Fichier | Notes |
|---|---|---|
| `20260710000089` | `promotions_usage_caps_columns` | max_uses / max_uses_per_customer |
| `20260710000090` | `resolve_combo_price_v1` | helper interne, REVOKE ×3 |
| `20260710000091` | `evaluate_promotions_v2_usage_caps` | DROP v1 + repoint pay_existing v11 in-place |
| `20260710000092` | `complete_order_v17_combo_pricing_promo_caps` | DROP v16, GRANT authenticated ⚠️ |
| `20260710000093` | `create_get_gross_margin_by_product_v1` | gate reports.financial.read |
| `20260710000094` | `bump_get_payments_by_method_v2_timezone` | DROP v1, tz local |
| `20260710000095` | `fix_evaluate_promotions_v2_no_tier_column` | fix corps v1 historique (tier_id) |
| `20260710000096` | `pay_existing_v11_promo_cap_hard_gate` | fix pattern-guardian MEDIUM (TOCTOU caps), in-place P10 |

EF `process-payment` redéployée (v17). Types regénérés (`4cc51e2`).

## Tests (tous verts)

- **pgTAP live (MCP, pattern « flags avant ROLLBACK » — les GUC session sont annulés par le rollback)** : **104 assertions** — nouvelles suites `combo_server_pricing` 5/5, `promotion_usage_caps` 13/13, `gross_margin_by_product` 5/5, `payments_by_method_v2_timezone` 2/2 ; ancres re-passées `bakery_reports` 15/15 (T10-T12 : staleness pré-existante réparée → `get_stock_movements_v2`), `m9_reports_hardening` 2/2, `combo_sale` 12/12, `discount_auth_nonce` 6/6, `canonical_line_price` 13/13, `s44_money_gates` 12/12, `promotions_bogo` 10/10, `sale_flag_aware_deduction` 6/6, `combo_reversal` 3/3.
- **Déférées à la nightly CI** (~52 assertions, chemins couverts indirectement par ce qui précède) : `modifier_ingredient_deduction` 24, `order_discount_gate` 10, `combo_fire_pay` 8, `loyalty_transactions_append_only` 5, `reversal_idempotency` 5.
- **App** : typecheck 6/6 ; **build 2/2** ; ratchet lint exit 0 ; **suite complète monorepo verte** (BO 701/702 dont 1 skip — 1 échec de couture réparé : le smoke hub figeait 32 cartes, la carte Gross Margin de 2d en faisait 33 ; domain 140/140, POS payment/display 71/71, UI 349/349 dont PromotionForm 24).
- **Revues** : 1 relecteur par tâche (7 tâches, verdicts SPEC ✅ / qualité approuvée) ; **pattern-guardian branche** : 1 MEDIUM réel (gate dur caps absent de `pay_existing_order_v11` — TOCTOU multi-caisses) → **fixé `_096`** (miroir exact du bloc `_092`), 13 autres patterns conformes ; **revue finale transverse : READY TO MERGE** (fixer lint sémantiquement neutre, chaîne checkout bout-en-bout cohérente, format `combo_components` aligné POS↔SQL, zéro lien mort sidebar/hub).

## Déviations

| ID | Quoi | Pourquoi | Risque |
|---|---|---|---|
| DEV-S57-01 | **Les subagents n'ont pas les outils MCP Supabase** → protocole « le contrôleur applique » : agents écrivent migrations/tests en local et commitent ; le contrôleur applique au cloud, exécute les pgTAP (boucles d'erreurs renvoyées aux agents) et déploie les EFs. Les deux agents DB ont refusé à juste titre les contournements dangereux (`db push` global, `migration repair`). | Outillage MCP non exposé aux subagents (structurel) | Aucun — protocole efficace, à réutiliser |
| DEV-S57-02 | `_091` copiait le corps v1 **historique** (`_082`, lisant `customers.tier_id` inexistant) au lieu du corps **live** (patché cloud-only, bookkeeping clock-stampé) → cassait dès qu'un `p_customer_id` était fourni ; fix `_095`. **Leçon : tout bump doit partir de `pg_get_functiondef` live, pas du fichier de migration d'origine.** | Drift cloud↔git documenté dans CLAUDE.md, angle mort du process | Corrigé pré-merge, 13/13 vert |
| DEV-S57-03 | Pseudo-UUIDs de fixtures non-hexadécimaux (`cp001`, `cg100`, `cs001`… — p/g/s interdits) dans 3 suites (2 nouvelles + seeds ajoutés aux ancres) → fixés par substitution (`2c36c07`, `2d88514`) | Suites écrites sans exécution (cf. DEV-S57-01) | Corrigé |
| DEV-S57-04 | 1ʳᵉ passe des fixtures 1b : 3 violations de contraintes (session_id requis pour POS, `one_open_session_per_user`, `chk_orders_void_consistency`) + hypothèse ACL fausse sur `_094` (« pas de GRANT explicite dans v1 » — proacl live prouvait le contraire) corrigée par le contrôleur **avant** apply | Écriture sans auto-vérification live | Corrigé (3 boucles de fix) |
| DEV-S57-05 | Ratchet lint sur `**/src/**` au lieu de `*.ts` bruts | `supabase/functions`/`tests` hors de tout tsconfig atteignable — parité exacte avec `pnpm lint` | Assumé, documenté in-code |
| DEV-S57-06 | Fixer lint : 80 erreurs / 32 fichiers soldées (le triage initial n'en voyait que 12/5 — le diff S57 complet a grossi le périmètre) — 0 `eslint-disable`, corrections minimales, tests re-passés | Le ratchet exige des fichiers touchés propres | Aucun (vert) |
| DEV-S57-07 | Réutilisations préférées à la création (2a : `ErrorState` au lieu de `PosLoadError`, hook `useReconnectInvalidate` canonique) ; états financiers/dashboards BO hors `emptyState` (structure KPI à préserver) ; PB1 hors URL-state (mois/année) | Anti-doublon / jugement produit | Validés en revue |
| DEV-S57-08 | Staleness pré-existante `bakery_reports` T10-T12 (signature `get_stock_movements_v1` disparue) réparée → v2 (catégorie DEV-S56-02) | Révélée par le re-run | Aucun (15/15) |

## Follow-ups (backlog)

- **Message cap dédié** : le chemin « cap atteint » non-racé remonte `promo_amount_mismatch` (evaluate v2 filtre la promo en amont) — faire détecter le cap côté EF via evaluate pour une copy propre ; `promo_cap_exceeded` ne sort qu'en course réelle (comportement correct, message perfectible).
- **Combo gap hors-POS (P3)** : `create_tablet_order_v2` / `add_order_item_v1` ne pricent/valident pas les combos (surcharges non facturées sur le chemin tablette) ; `create_b2b_order_v3` ne décompose pas les combos.
- **Snapshot COGS à la vente (P3)** : `order_items.unit_cost` + write `_record_sale_stock_v1` pour une marge exacte historique (v1 = WAC courant, caveat UI).
- Marge : réconciliation `gross_margin.revenue` vs P&L (remises niveau commande non déduites par produit) à documenter utilisateur ; `cost_price` NULL → ligne hors COGS ; format export `margin_pct` (text vs percent) à homogénéiser.
- POS : split multi-tender dont 1ᵉʳ tender non-cash avec monnaie → l'écran client masque la monnaie (SuccessModal l'affiche) ; effet broadcast re-émet sur changement de deps (inoffensif).
- Refactors > 500 restants : `routes/index.tsx` (962), `cartStore.ts`, `PurchaseOrderDetailPage.tsx` ; résorption de la dette lint hors-diff (~110 disable + 88 any) ; template PDF gross-margin ; throws_ok 23514 avec pattern de message.
- Skills `products-catalog`/`orders`/`reports-exports` à rafraîchir (v17/v2/caps/gross-margin).

## Suite

- **P2 : SOLDÉ** (P2.1→P2.6). Prochaine session : P3 (spec FIFO/lots/péremption requise avant code, décision `allow_negative_stock`, cron alertes stock) et/ou reliquat Spec B Phase 2 (Sales + Expenses bulk import) — cf. Active Workplan.
