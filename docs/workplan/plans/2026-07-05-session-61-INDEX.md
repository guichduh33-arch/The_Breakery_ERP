# Session 61 — INDEX (2026-07-05)

> **Branche :** `swarm/session-61` (base `abb4564` = master post-S60) · **Plan :** [`../../superpowers/plans/2026-07-05-session-61-f2-f5-decommission-peremption.md`](../../superpowers/plans/2026-07-05-session-61-f2-f5-decommission-peremption.md)
> **Scope acté avec le propriétaire :** findings S58 restants **F-2** + **F-5**, plus le **décommissionnement léger péremption** (fiche 06 D3.1, décision propriétaire 2026-07-04).
> **Méthode :** subagent-driven-development — 1 implémenteur + 1 reviewer par tâche, revue finale de branche (fable). Ledger : `.superpowers/sdd/progress.md` §Session 61.

## Tâches livrées

| # | Tâche | Commit | Migration | Tests | Revue |
|---|---|---|---|---|---|
| T1 | **F-2** — contrat P0002 des gardes d'insuffisance de `_record_sale_stock_v1` : ERRCODE `P0002` sur les 2 gardes (avant : P0001, classé `no_open_session` par l'EF) + garde display **inconditionnelle** (`allow_negative_stock` ne s'applique jamais à la vitrine — la CHECK `display_stock_quantity_check` interdisait déjà le négatif, l'échec sortait en 23514 brut) | `0fd851d` | `20260710000107` (in-place corps live, signature inchangée, ACLs S53 survivantes vérifiées) | nouvelle suite `display_oversell_contract` 4/4 (RED 3/4 avant) ; 6 ancres re-passées : unification 15/15, flag_aware 6/6, display_symmetry 8/8, b2b_display 3/3, pay_existing 3/3, combo_sale 12/12 | Approved, 0 finding |
| T2 | **F-5** — allowlist stations d'`import_catalog_v1` alignée sur la CHECK live `categories_dispatch_station_check` : `bakery`→`display` (2 occurrences seules patchées dans un corps de ~470 lignes, vérifié ligne à ligne) — catégorie `display` importable, `bakery` rejetée en validation au lieu de crasher en 23514 | `9d9646f` | `20260710000108` (in-place corps live) | `catalog_import` 31→33 asserts (T30 display persisté, T31 bakery `invalid_dispatch_station` en dry-run), RED 2/33 → GREEN 33/33 | Approved, 2 Minors (D-3/D-4) |
| T3 | **Décommissionnement léger péremption** (06 D3.1) : cron `mark_expired_lots_hourly` désactivé (`cron.alter_job active:=false`, jobid par nom, vérifié live) ; purge frontend BO — pages ExpiringStock + PerishableTurnover, routes+lazy imports, 2 entrées sidebar + icônes, tuile ReportsIndex, `ExpiringLotsBadge`/`useExpiringLots`/`usePerishableTurnover`, terme expiring d'`AlertsBadge` (total = low+reorder), panneaux expiring des 2 pages produit, `'perishable_turnover'` de l'union `useGeneratePdf`, tests associés (3 cascades adjugées + suppression du smoke drilldown orphelin). **Aucun DROP** : `stock_lots`, `get_expiring_lots_v1`, `mark_expired_lots_hourly` (fonction) et le template PDF EF restent dormants | `dfc4d81` | `20260710000109` (idempotente, réversible `active:=true`) | typecheck 6/6, backoffice 203 fichiers/721 tests, build 2/2 — exit 0 | Approved, 1 Minor (commentaire, fixé au closeout) |

## Vérification closeout (T4)

- Ancre money-path **`s44_money_gates` 12/12** re-passée live (v17/v11/fire_v4 **non modifiés** par la branche).
- **Types no-drift** : dump `generate_typescript_types` identique à `packages/supabase/src/types.generated.ts` (signatures inchangées, aucun commit de types).
- **Suite monorepo complète exit 0** (typecheck 6/6, build 2/2, `pnpm test` OK).
- **Revue finale de branche (fable) : READY TO MERGE** — 0 Critical/Important. Blast radius F-2 raisonné sur les 3 appelants (EF process-payment mappe déjà P0002→`insufficient_stock` 409 ; POS `classifyCheckoutError` traite P0002 comme l'ancien P0001 ; BO B2B classe sur le texte du message, inchangé). Aucun chemin qui réussissait avant n'échoue maintenant.

## Dettes documentées (aucune bloquante)

| # | Sév. | Dette | Origine |
|---|---|---|---|
| D-1 | Quick win futur | `classify()` de `useCreateB2bOrder.ts` ne matche pas « Insufficient display stock » → modal B2B affiche le message brut (pré-existant S53, pas une régression S61) — ajouter le match | Revue finale |
| D-2 | Minor | `display_oversell_contract` T4 : `lives_ok` sans assert sur `display_stock.quantity=3` (le commentaire d'en-tête promet la valeur) — promouvoir en `is()` au prochain passage | Revue finale |
| D-3 | Minor | `catalog_import.test.sql` T30 : `set_config('breakery.t30_valid', …)` posé mais jamais lu (l'assert de persistance qui suit est plus fort) — vestige à purger ou promouvoir en 3ᵉ assert | Revue T2 |
| D-4 | Style | `_108` ne re-asserte pas le trio REVOKE/GRANT contrairement au précédent `20260629000013` sur la même fonction (defense-in-depth de style ; les ACLs survivent au REPLACE dans les deux ordres de replay) | Revue T2 |
| D-5 | Cosmétique | Grilles `lg:grid-cols-2` à enfant unique après retrait des panneaux expiring (`ProductStockPage`/`ProductDashboardPage`) — colonne droite vide en desktop | Revue finale |
| D-6 | Info | Restes dormants assumés du décommissionnement : table `stock_lots`, RPCs `get_expiring_lots_v1`/`mark_expired_lots_hourly`, template PDF `perishable_turnover` côté EF `generate-pdf`, champ `expiring_lots` du payload `get_product_dashboard` (type TS conservé). Réactivation = `cron.alter_job(active:=true)` + re-câblage UI | Plan T3 |

## Actions utilisateur

- Aucune nouvelle. (Rappel S60 toujours ouvert : template du print-bridge externe à mettre à jour pour `promotions[]`.)

## Impact docs

- `00-INDEX.md` §3 : F-2/F-5 soldés (plus aucun finding S58 ouvert hors F-3 — attendu de test corrigé dès S58) ; Vague 2 « Décommissionnement péremption/FIFO » soldée S61.
- Fiches 05/06 : notes de mise à jour S61 en tête.
- `CLAUDE.md` : Active Workplan bumpé (S61 merged, next-session repointée).
