# Session 54 — INDEX : P1.3 « Correctness compta (T6/C10) »

- **Date** : 2026-07-02
- **Branche** : `swarm/session-54`
- **Spec** : [`docs/superpowers/specs/2026-07-02-fiscal-correctness-design.md`](../../superpowers/specs/2026-07-02-fiscal-correctness-design.md)
- **Plan** : [`docs/superpowers/plans/2026-07-02-fiscal-correctness.md`](../../superpowers/plans/2026-07-02-fiscal-correctness.md)
- **Audit source** : §4 P1.3 (T6, C10) de `docs/workplan/audits/2026-06-27-audit-integral-par-module.md` (clôture annuelle remontée de P2.2 par le workplan)
- **Closeout S53** : PR #136 mergée ; 11 fichiers-poubelle 0-byte de subagents nettoyés à la racine.

## Objectif

Fermer **T6** : garde fiscale fail-closed, clôture annuelle carry-forward → 3200, exclusion `year_close` des rapports de résultat. Les deux items déjà livrés en S51/2a-i (dédup PB1 `_057`, TB v3 cumulative `_061`) sont **vérifiés** — et la vérification TB a révélé un vrai bug (leak du cumul), corrigé.

## Livré

1. **`check_fiscal_period_open` fail-closed** (`_077`, COR in-place) : aucune période couvrante → `RAISE 'period_undefined' P0004` (même ERRCODE que `period_locked`, les 34 call-sites traitent déjà P0004 comme rejet). Le seed N+1 par la clôture annuelle neutralise la « bombe à retardement jan 2028 ».
2. **Fix leak cumul TB v3** (`_078`, COR in-place) : le double LEFT JOIN de `_061` laissait les lignes de JE **draft / futures / sale_void dédupliquées** polluer `cum_debit/cum_credit` (reproduit : 100 posted + 40 draft + 25 future → balance 165 au lieu de 100). Fix : join interne parenthésé `(jel JOIN je ON …filtres…)`. Cas T7 ajouté à la suite.
3. **`close_fiscal_year_v1(p_fiscal_year, p_manager_pin)`** (`_079` permission + `_080` contrainte+RPC) : préconditions 12 périodes `closed`/`locked` (`FOR UPDATE`, sérialise), pas de `year_close` existante ; JE `year_close` datée 31/12 zérotant les classes 4/5/6 (dédup canonique `sale_void`+refund) avec contrepartie **3200 Retained Earnings** (CR profit / DR perte) ; **seed 12 périodes N+1** ; audit `accounting.year.closed` ; gate **`accounting.year.close`** (MANAGER/ADMIN/SUPER_ADMIN) + `_verify_pin_with_lockout` ; REVOKE pair. Zéro activité → pas de JE (`je_id null`). `reference_type='year_close'` ajouté à la CHECK de `journal_entries`. 3300 CYE (non postable) **pas touché** — dérivé live, retombe à 0.
4. **Exclusion `year_close` des rapports** (`_081`, COR in-place ×2) : P&L v2 (WHERE) ; TB v3 **colonnes de période seulement** (ouverture/cumul l'incluent — 3200 porte le report, 4/5/6 rouvrent à 0 ; JE entière exclue toutes classes → invariant Σ intact). **BS v2 : aucun changement requis** (CYE calculé **YTD** → la clôture du 31/12 le remet à 0 ; vérifié delta pré/post identique).

## Migrations

| # | Fichier | Cloud (apply_migration) |
|---|---|---|
| `20260710000077` | `fiscal_guard_fail_closed` | idem |
| `20260710000078` | `fix_trial_balance_v3_cum_leak` | idem |
| `20260710000079` | `seed_accounting_year_close_permission` | idem |
| `20260710000080` | `create_close_fiscal_year_v1` | `create_close_fiscal_year_v1` + `extend_je_reference_type_year_close` (contrainte découverte à l'exécution, foldée dans le fichier local) |
| `20260710000081` | `exclude_year_close_from_pl_tb` | idem |

Types regénérés (`types.generated.ts` : + `close_fiscal_year_v1`, diff 4 lignes).

## Tests (tous verts, MCP execute_sql BEGIN/ROLLBACK, capture temp-table)

- **Nouvelles suites** : `fiscal_guard_fail_closed` 4/4 ; `close_fiscal_year_v1` 19/19 (permission, périodes manquantes/ouvertes, PIN lockout, profit 600 → 3200 CR, JE équilibrée, nets zérotés, seed 2099 12×open, replay, perte+dédup −500 → 3200 DR, zéro-activité, audit ×3, ACL anon, rapports post-clôture T16-T19).
- **Suites étendues** : `trial_balance_v3_cumulative` 6/6 + T7 leak.
- **Ancres re-run** : `pb1_dedup_void_refund` 3/3 ; gates TB/P&L (42501 sans permission) ; sanity P&L juin 2026 réel.
- **App** : typecheck 6/6, build 2/2 (aucun call-site UI changé).

## Décisions / déviations

1. **Leak cumul TB v3 confirmé et corrigé** (le « déjà v3 — vérifier » du workplan était fondé) — bugfix in-place, précédent `_057`.
2. **`year_close` dans la CHECK `journal_entries_reference_type_check`** : découvert à l'exécution (Task 3), appliqué cloud en apply séparé, foldé dans `_080` local (précédent S53 fix-ups).
3. **BS v2 non modifié** : son CYE est YTD — la JE de clôture du 31/12 l'annule d'elle-même. Le `balanced:false` observé sur le dev vient des exercices réels non clôturés (gap préexistant, se résorbe quand on clôturera réellement 2026).
4. **Permission dédiée `accounting.year.close`** (pas de réutilisation de `accounting.period.close`) — clôture annuelle = acte plus lourd, SOD-friendly.
5. **UI différée — DEV-S54-01** : bouton cockpit « Clôture annuelle » + affichage de l'erreur `period_undefined` (backlog module 02-accounting).

## Suite

- **P1.5 (T7)** — durcissement EF restant : rate-limit `auth-change-pin`, idempotency void/cancel, discount-PIN via `verify-manager-pin`, secret dispatch en header.
- **DEV-S54-01** — UI clôture annuelle (cockpit BO) ; **DEV-S52-03** — liste-factures B2B BO : toujours déférés.
