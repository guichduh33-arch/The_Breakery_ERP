# Session 63 — INDEX (2026-07-06)

**Chantier :** Vague 2 — Dashboard BO réel (fiche 14 D2.1).
**Branche :** `swarm/session-63` (base `83cc3440` = master post-#151).
**Spec :** `docs/superpowers/specs/2026-07-06-s63-dashboard-overview-design.md` (commit `492fbb7c`).
**Plan :** `docs/superpowers/plans/2026-07-06-s63-dashboard-overview.md` (commit `ae0ca4bc`).
**Exécution :** subagent-driven (implémenteur + reviewer par tâche, revue finale de branche).

## Livré

- **RPC `get_dashboard_overview_v1`** (migrations **`20260710000113`** + **`20260710000114`** fix in-place) — lecture pure, gate `reports.read`, trio S20, bucketing `business_config.timezone`, définition « commande valide » miroir de `get_daily_sales_v1` dans les **6 sections** (le `_114` ajoute le prédicat `paid_at IS NOT NULL` manquant au bloc payment_methods — finding Important de revue, plan-mandated) ; B2B compté au paiement seulement ; `revenue_today` net des refunds ; `avg_basket` = brut÷commandes (miroir `aov`) ; série 30 j **continue** (generate_series, jours vides à 0) ; top 5 produits par revenu hors lignes annulées ; paiements du jour depuis `order_payments` (bucketing `op.paid_at`, rattachés aux commandes valides).
- **Hook `useDashboardOverview`** (polling 60 s, staleTime 30 s, classifieur 42501→`permission_denied`) + **`Dashboard.tsx` câblé** : KPIs réels, état « accès restreint » structurel (pas de KPI row ni `role=alert`), « Last updated » = `generated_at` serveur, prop `data?` de test conservée (`data === undefined` désactive le hook).
- **5 panneaux** (`features/dashboard/components/`) : `RevenueTrendChart` (LineChart 30 j, empty si série toute à 0), `RevenueByTypeDonut` (donut + labels FR-EN des 4 types), `HourlySalesChart` (BarChart 0-23 complété client), `TopProductsList` et `PaymentMethodsList` (listes, part % avec garde total>0) — palette `chartColors.ts` existante, zéro hex neuf.
- **Tests :** pgTAP **`dashboard_overview` 14/14 live** (delta-based, DB non vide ; exclusions voided/`b2b_pending`/ligne annulée, bord timezone 01:00 locale, série 30 points, 42501, ACL anon) ; smoke `Dashboard.test.tsx` **8/8** (11/11 au filtre avec la suite B2B préexistante) ; typecheck 6/6 ; suite monorepo verte au closeout.
- **Types regénérés** (+1 ligne additive `get_dashboard_overview_v1`) ; `_114` taggé `[types-noop]` (signature inchangée).
- **Money-path intouchée** : RPC de lecture pure, aucun RPC de vente modifié (ancre `s44_money_gates` non requise ; v17/v11/fire_v4 hors périmètre).

## Commits

| Commit | Contenu |
|---|---|
| `492fbb7c` | spec |
| `ae0ca4bc` | plan |
| `b865e5b6` | T1 — migration `_113` + suite pgTAP + regen types |
| `d5e14706` | T1 fix revue — migration `_114` paid_at guard `[types-noop]` |
| `8583d371` | T2 — hook + câblage KPIs + état restreint + smoke tests |
| `78a42a60` | T3 — 5 composants panneaux + câblage + 2 tests |

## Déviations

- **DEV-S63-01** : Task 1 (DB/MCP) exécutée par le **contrôleur** et non un subagent — les implémenteurs n'ont pas les tools MCP supabase (pattern `sdd-subagent-tooling`, précédent S62-T2) ; revue de tâche normale maintenue (2 rounds).
- **DEV-S63-02** : 3 corrections de seed pgTAP vs le code du plan, exigées par des contraintes live que le plan ignorait : `chk_order_items_cancel_consistency` (cancelled_at/reason/by), `chk_orders_void_consistency` (voided_by/void_reason), trigger `fn_create_je_for_refund` (ligne JE PB1 0/0 interdite → `tax_refunded` 0→1000, total inchangé). Adjugées légitimes en revue.
- **DEV-S63-03** : migration **`_114`** non prévue au plan — fix du finding Important de la revue T1 (le bloc payment_methods du plan omettait `paid_at IS NOT NULL` alors que la Global Constraint « commande valide » le mandatait ; la contrainte globale gouverne).
- **DEV-S63-04** : polyfill **`ResizeObserver`** centralisé dans `apps/backoffice/vitest.setup.ts` (hors liste de fichiers du brief T3, **non déclaré** par l'implémenteur — détecté en revue) : requis par recharts `ResponsiveContainer` en jsdom, feature-detected, miroir d'un stub déjà dupliqué dans 6 suites. Adjugé cascade légitime ; le défaut est la non-déclaration, pas le code.

## Finding Important de la revue finale — décision propriétaire due

- **I-1 (hérité de la spec, PAS un bug d'implémentation)** : **les voids même-jour double-pénalisent le net** de `revenue_today` et `revenue_30d`. Le lineage void (`20260704000018`) pose `status='voided'` ET insère un refund `is_full_void=true` : la commande sort du brut (correct) et son refund est soustrait quand même → une vente 50k payée puis voidée le jour même compte −50k au lieu de 0. **Biais partagé verbatim avec `get_daily_sales_v1` depuis S40** (le miroir était mandaté par la spec §3.2 — patcher le seul dashboard casserait la cohérence voulue). **Fix proposé (session future)** : `AND NOT r.is_full_void` dans les CTEs refunds des **deux** RPCs + pin pgTAP — change le sens de « net » sur deux surfaces à la fois, décision propriétaire requise.

## Dettes (D-1..D-12)

- **D-1** : T05 (`avg_basket`) recalcule avec la même formule/prédicat que le RPC — auto-miroir, ne détecterait pas un bug partagé de borne de date.
- **D-2** : pas de pin de régression « refund sur jour sans commande » dans `revenue_30d` (bug historique de `get_daily_sales_v1` corrigé par `20260624000015` ; la construction generate_series l'évite structurellement, mais sans assertion).
- **D-3** : `MAX(oi.name_snapshot)` comme nom du top produit — en cas de rename intrajour, prend l'alphabétiquement plus grand, pas le plus récent.
- **D-4** : pas de T15 pinnant le fix `_114` (une commande `paid` sans `paid_at` avec paiement ne doit PAS apparaître dans payment_methods) — le 14/14 démontre la non-régression, le fix n'est vérifié que par lecture.
- **D-5** : le greeting ne se recalcule plus au clic refresh (l'ancien compteur `internalRefresh` a été retiré par la réécriture — impact : franchissement matin/après-midi page ouverte sans re-render).
- **D-6** : `PaymentMethodsList` — la somme des parts % arrondies peut faire ≠ 100 (33/33/33).
- **D-7** : les stubs ResizeObserver per-file des 6 suites reports sont désormais redondants avec le setup global (coexistence vérifiée sans conflit — nettoyage futur).
- **D-8** : warnings stderr recharts « width(0)/height(0) » dans les tests Dashboard — conséquence attendue du polyfill no-op en jsdom ; bénin, accepté (les silencer exigerait de mocker ResponsiveContainer).
- **D-9** : ~6 scans non-sargables d'`orders` par appel du RPC sous polling 60 s (le prédicat `(paid_at AT TIME ZONE tz)::date` ne peut pas utiliser `idx_orders_paid_at`) — pattern maison hérité de `_094`, mais ce RPC est le seul pollé. Fix quand ça pèse : pré-range sargable sur `paid_at` + fusion des 4 sections « aujourd'hui » en un scan.
- **D-10** : `PaymentMethodsList` affiche les valeurs brutes de l'enum (`cash`, `qris`, `store_credit`) là où le donut a un mapping de labels — le smoke test pinne la forme brute, MAJ des deux ensemble.
- **D-11** : `formatTime` — le try/catch est mort (`new Date(bad)` ne throw pas) : un `generated_at` invalide rendrait « Invalid Date » au lieu de `--:--` ; garder via `Number.isNaN(d.getTime())`.
- **D-12** : `aria-live="polite"` englobe « Last updated » → annonce lecteur d'écran à chaque poll de 60 s ; déplacer l'aria-live ou n'annoncer qu'au refresh manuel.

## Actions utilisateur

Aucune nouvelle. (Rappel S60 toujours ouvert : template print-bridge externe à MAJ pour `promotions[]`.)
