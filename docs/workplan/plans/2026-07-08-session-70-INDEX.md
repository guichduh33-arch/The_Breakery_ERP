# Session 70 — Rapport des écarts de caisse par caissier (fiche 12 D2.4) — INDEX

**Branche :** `swarm/session-70` (base master `1b1e68eb`)
**Spec :** [`docs/superpowers/specs/2026-07-08-s70-cashier-variance-report-design.md`](../../superpowers/specs/2026-07-08-s70-cashier-variance-report-design.md)
**Plan :** [`docs/superpowers/plans/2026-07-08-s70-cashier-variance-report.md`](../../superpowers/plans/2026-07-08-s70-cashier-variance-report.md)
**Exécution :** subagent-driven (7 tasks — T1-T3 contrôleur MCP, T4-T6 subagents, T7 closeout).

## Livré

**Fiche 12 D2.4 fermée** — un rapport Back-Office **lecture pure** agrège les écarts de clôture de shift par caissier, avec ventilation par jour de semaine, répondant au scénario « manque récurrent le mardi ». **Zéro écriture DB, money-path intouchée, aucune migration destructive.**

### DB — RPC lecture pure (migration `20260710000140`)
- **`get_cashier_variance_v1(p_start_date date, p_end_date date) RETURNS jsonb`** — `plpgsql STABLE SECURITY DEFINER`, gate **`reports.read`** (42501 si absent ou `auth.uid()` NULL), garde `invalid_date_range` P0001, tz depuis `business_config id=1`. Agrège `pos_sessions` groupées par **`opened_by`** (le propriétaire du tiroir, pas `closed_by` — un shift fermé par un manager reste attribué au caissier). Enveloppe `{ generated_at, start_date, end_date, timezone, cashiers[], totals }` ; chaque caissier porte 3 volets `cash`/`qris`/`card` + matrice `dow_cash`, trié par **`cash.total_short` ASC** (plus gros manque cumulé en tête).
- **Sources gelées** (rapport stable dans le temps) : l'écart **cash** vient de la colonne figée `pos_sessions.variance_total` ; les écarts **QRIS/carte** viennent des `audit_logs` `shift.close` (`metadata->>'variance_qris'`/`variance_card`, via `LEFT JOIN LATERAL`) — jamais recalculés depuis `order_payments` (qui dériveraient si des commandes sont annulées post-clôture). Un volet non compté (`counted_qris`/`counted_card` NULL) est exclu de la somme.
- **Trio S20** : `REVOKE ALL … FROM PUBLIC, anon` + `GRANT EXECUTE … TO authenticated` + `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` + `COMMENT` (la ligne ALTER ajoutée en fix pattern-guardian, miroir des sœurs `_138`/`_139`). Vérifié live : `anon` EXECUTE=false, `authenticated`=true.

### BO — page Reports
- **`useCashierVariance(start, end)`** (`features/reports/hooks/`) — wrap TanStack Query, `staleTime 60_000`, mappe 42501 → `permission_denied`. Types exportés `CashierVarianceReport`/`CashierVarianceRow`/`DowCell`.
- **`CashierVariancePage`** (`pages/reports/`) — miroir de `SalesByStaffPage` : table par caissier (3 volets, `—` pour un volet non compté, variance colorée `text-danger`/`text-success`) + matrice « Cash variance by day of week » (le signal « manque le mardi ») + **export CSV** du résumé (pas de PDF en v1). État vide « No closed shifts ».
- **Wiring** : route `reports/cashier-variance` (gate `reports.read`, après `sales-by-staff`), entrée sidebar (icône `Wallet`), tuile ReportsIndex (icône `Banknote`) — gate `reports.read` cohérent partout.

## Tests
- **pgTAP `cashier_variance` 14/14 live** (T1-T14) : longueur du tableau, tri par manque cumulé, total/short/short_count/over_count/worst cash, attribution `opened_by` (incl. shift fermé par manager), QRIS depuis metadata audit (incl. session pré-S67 sans clés → NULL), card à 0, matrice dow (mardi 2 sessions −80 000), grand totaux, `invalid_date_range` P0001, gate 42501 (sans perm + anon).
- **Smoke BO `CashierVariancePage.smoke` 3/3** : rendu 1 caissier (`—` QRIS, titre dow), état vide « No closed shifts », loading.
- **Ancre money-path `s44_money_gates` 12/12 live** (`num_failed=0`) — preuve que le rapport lecture pure n'a rien touché à `complete_order_with_payment_v17` / `pay_existing_order_v11` / `create_b2b_order_v5` / `fire_counter_order_v4` / `_record_sale_stock_v1`.
- **Suite monorepo** : typecheck 3/3, build 3/3 (exit 0). `pnpm --filter @breakery/app-backoffice test` : **210 passed, 1 skipped** après fix DEV-S70-03 (le seul échec S70 réel — le comptage de tuiles — corrigé et re-vert dans la passe complète). ⚠️ Un run complet a vu flaker `general-ledger.smoke` (S26b, sans rapport avec S70) sous forte pression de ressources (collect 1663 s / environment 611 s) — **passe 4/4 en isolation** (flake env-gated pré-existant, hors diff S70).
- Revue : pattern-guardian 13/14 patterns PASS (1 MEDIUM fixé : ligne ALTER DEFAULT PRIVILEGES) ; task-reviewer T5 spec ✅ + Approved.

## Déviations
- **DEV-S70-01** — la suite pgTAP `cashier_variance` seed dans une **fenêtre historique isolée (mars 2025, vérifiée vide de sessions closes)** plutôt que `CURRENT_DATE-30` : le DB dev est non vide (4 sessions closes réelles dans la fenêtre courante) et l'enveloppe structurée par caissier ne se prête pas au delta-diff propre du pattern `dashboard_overview`. Les caissiers seedés réutilisent 3 profils existants (Test Cashier / Waiter Demo / Manager Demo comme fermeur ≠ A).
- **DEV-S70-02** — types **greffés** sur le fichier master (générateur MCP divergent, DEV-S69-03 : il droppe `get_stock_levels_v1` et expose les fns internes `_*`) ; seul le bloc `get_cashier_variance_v1` (4 lignes additives) inséré.
- **DEV-S70-03** — l'ajout de la tuile ReportsIndex a cassé l'assertion de comptage exact de `ReportsIndexPage.smoke.test.tsx` (`32 → 33 active card links`) ; test bumpé + commentaire amendé (« +1 Cashier Variance S70 »). Non anticipé par le plan (Task 5 listait 4 fichiers ; ce 5ᵉ est un test de garde du nombre de tuiles) — attrapé par la suite monorepo complète en closeout.
- **DEV-TASK6-01** (mineur) — le vrai nom de package pnpm est `@breakery/app-backoffice` (pas `@breakery/backoffice` comme le plan l'écrivait) ; commande de test réelle `pnpm --filter @breakery/app-backoffice test CashierVariancePage`.

## Dettes (D-1..)
- **D-1** — le mock du smoke `CashierVariancePage.smoke` utilise `cash.total_short` **positif** alors que le RPC réel renvoie un total_short négatif (somme des négatifs). Sans impact : c'est un smoke de rendu, aucune assertion ne dépend de ce signe. À normaliser si le smoke gagne des assertions de valeur.
- **D-2** — v1 volontairement hors périmètre (spec) : pas d'export PDF, pas de ventilation dow pour QRIS/carte (cash seulement), pas de drill-down session, pas d'alerte, pas de colonnes matérialisées (nécessiteraient un bump `close_shift_v6` — hors « lecture pure »).
- **D-3** — le rapport dépend de `audit_logs` `shift.close` pour les écarts QRIS/carte : une session close **avant S67** (pas de clés `variance_qris`/`variance_card` dans metadata) rend ces volets à NULL/0 pour cette session (couvert par le test, comportement voulu — dégradation propre).

## Commits
```
2a6c48c6 feat(reports): get_cashier_variance_v1 — cashier shift variance aggregation
71c8c135 chore(types): regen for get_cashier_variance_v1 — grafted
d93f7e2f test(reports): cashier_variance pgTAP — 14/14
af7fe753 feat(reports): useCashierVariance hook
391c4ef2 feat(reports): Cashier Variance page + route + sidebar + index tile
aa9a7fa8 test(reports): CashierVariancePage smoke — 3/3
cf30d099 fix(reports): add ALTER DEFAULT PRIVILEGES to trio (pattern-guardian)
```
