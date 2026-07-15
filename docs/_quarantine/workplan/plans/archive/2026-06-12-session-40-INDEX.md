# Session 40 — INDEX : Reports close-out — les 9 cards « Soon » du hub

> Spec : [`2026-06-12-session-40-spec.md`](../../specs/archive/2026-06-12-session-40-spec.md)
> Plan : [`2026-06-12-session-40-plan.md`](2026-06-12-session-40-plan.md)
> Branche : `swarm/session-40` (base `master` @ `e3ec866`)

**Note de reprise** : la session d'exécution initiale a crashé (API 529 Overloaded, 2026-06-11 ~16:52 UTC) en plein milieu de la task A1 — les 5 fichiers migrations A1 + le squelette pgTAP étaient écrits localement mais **rien n'était appliqué au cloud ni committé**. La reprise (2026-06-12) a tout re-vérifié contre le schéma cloud réel avant apply.

## 1. Waves & statut

| Wave | Contenu | Statut | Commits |
|---|---|---|---|
| A1 | Trigger RBAC audit + Daily Sales + Purchase ×3 (migrations `_010.._015`) + pgTAP T1-T12 | ✅ | `a2f6b04`, fix T1 `d9aaf76` |
| A2 | Staff + Production ×2 + Price/Permission Changes (migrations `_016.._020`) + pgTAP T13-T22 + types regen | ✅ | `f3aa767` |
| B1 | Daily Sales + Staff Performance (hooks/pages/smokes) | ✅ | `d9f3485` |
| B2 | Purchase Items / by Date / by Supplier ×3 | ✅ | `c165840` |
| B3 | Production Report / Efficiency + Price Changes + Permission Change Log ×4 | ✅ | `910f00e` |
| C | Wiring : 9 routes + 9 sidebar + hub 0 Soon + smoke hub | ✅ | `4421d36`, corrective gate `9e69ee5` |
| D | pattern-guardian (13/14, P11 fermé `_022`) + sweeps ✅ + E2E 4/4 + INDEX + CLAUDE.md + PR | ✅ | `e8de80e`, `c2268e9` |

Reviews : spec-reviewer Wave A ✅ (1 défaut de test T1 vacueux → corrigé `d9aaf76`) ; spec-reviewer Wave B ✅ (shapes hooks ↔ RPC exacts ×9, 0 prop pdf, 5 notes LOW — 1 fixée DEV-S40-B-02) ; pattern-guardian 13/14 — voir §4.

## 2. Migrations

Bloc NAME `20260624000010..022` (13 migrations, cloud versions clock-assignées convention S36 ; base vérifiée via `list_migrations`, prior max NAME `20260623000012`) :

| # | Nom | Contenu |
|---|---|---|
| `_010` | `create_audit_role_permissions_trigger` | trigger AFTER INSERT/DELETE sur `role_permissions` → `audit_logs` `role.permission_granted`/`revoked` (payload role_code+permission_code) ; fonction SECURITY DEFINER REVOKEd PUBLIC/anon, pas de GRANT (trigger-only) |
| `_011` | `create_get_daily_sales_v1_rpc` | gate `reports.sales.read` ; summary + by_day ; clamp 366j ; P0001 end<start |
| `_012` | `create_get_purchase_items_v1_rpc` | gate `reports.inventory.read` ; lignes plates LIMIT 1000 + truncated ; filtre `p_supplier_id` |
| `_013` | `create_get_purchase_by_date_v1_rpc` | agrégat par order_date ; received/pending splits |
| `_014` | `create_get_purchase_by_supplier_v1_rpc` | share_pct + avg_lead_days ; cancelled compté mais exclu du total |
| `_015` | `fix_get_daily_sales_v1_refund_only_days` | **corrective** DEV-S40-A1-01 (FULL OUTER JOIN jours-refunds) |
| `_016` | `create_get_staff_performance_v1_rpc` | gate `reports.sales.read` ; 5 CTEs (served/items/voids/refunds/discounts/cancelled) UNION staff ids |
| `_017` | `create_get_production_report_v1_rpc` | gate `reports.inventory.read` ; value = qty × cost_price courant |
| `_018` | `create_get_production_efficiency_v1_rpc` | variance ratio DB exposé ×100 ; waste_rate_pct |
| `_019` | `create_get_price_changes_v1_rpc` | gate `reports.financial.read` ; LAG sur historique complet per-product de `audit_logs` `product.update` ; LIMIT 501/truncated |
| `_020` | `create_get_permission_changes_v1_rpc` | log RBAC 4 actions ; LIMIT 501/truncated |
| `_021` | `fix_get_permission_changes_v1_gate` | **corrective** DEV-S40-C-01 (gate `audit_log.read` → `reports.audit.read`) |
| `_022` | `assert_alter_default_privileges_s40` | **corrective** DEV-S40-D-01 (pattern-guardian P11 — ré-assertion `ALTER DEFAULT PRIVILEGES`) |

REVOKE pair S25 canonique sur les 9 RPCs + ré-assertion dans les 2 correctives. Types regen committé (`f3aa767`, +44 lignes, 9 entrées RPC). **Aucune nouvelle table, aucune nouvelle permission.**

## 3. Déviations

| ID | Sévérité | Description |
|---|---|---|
| DEV-S40-A1-01 | **medium, fixée** | `get_daily_sales_v1` 1er jet (plan verbatim) perdait les refunds des jours sans commande (LEFT JOIN depuis `valid_orders`) → `summary.refund_total` sous-compté. Détecté par pgTAP T5 (refund seedé sur CURRENT_DATE, orders sur J-1/J-2). Corrective `_015` FULL OUTer JOIN ; shape inchangé ; les jours refund-only émettent `order_count=0`. Conséquence : la numérotation A2 du plan (`_015.._019`) a glissé vers `_016.._020`. |
| DEV-S40-A1-02 | informational | `role_permissions` possède une colonne `is_granted` : un UPDATE de cette colonne ne serait PAS audité par le trigger (INSERT/DELETE only, conforme plan). Vérifié : aucun code applicatif n'écrit `role_permissions` aujourd'hui (matrix BO read-only, grants via migrations) — pas de chemin UPDATE existant. À revisiter si un RBAC editor write-mode arrive. |
| DEV-S40-A1-03 | informational, fixée | pgTAP T1 du 1er jet était vacueux (`after >= before` + `ON CONFLICT DO NOTHING`) — trouvé par le spec-reviewer Wave A. Durci en DELETE préalable + INSERT frais + `= before + 1` (`d9aaf76`). |
| DEV-S40-A2-01 | informational | Colonne discount des orders = `discount_amount` (le plan disait `discount`). |
| DEV-S40-A2-02 | informational | `production_records.production_date` est **timestamptz** (le plan affirmait DATE) → bucketing tz via `business_config.timezone` comme les autres reports. |
| DEV-S40-A2-03 | informational | `yield_variance_pct` (GENERATED) stocke un **ratio** `(actual-expected)/expected`, pas un pourcentage malgré son nom → exposé ×100 dans `get_production_efficiency_v1` pour que les champs `*_pct` du report soient de vrais %. |
| DEV-S40-C-01 | **medium, fixée** | Gate RPC `get_permission_changes_v1` : le plan disait `audit_log.read` (ADMIN+) mais demandait aussi de copier le gate de l'AuditPage — qui est `reports.audit.read` (MANAGER+) ; `audit_log.read` n'existe d'ailleurs pas dans le union `PermissionCode` front. Désalignement front/DB détecté à la livraison Wave C (un MANAGER aurait vu la page mais pris un 42501). Corrective `_021` aligne le RPC sur `reports.audit.read` ; pgTAP T21 (CASHIER 42501) / T22 (MANAGER happy) adaptés et re-vérifiés live. |
| DEV-S40-C-02 | informational | Hub : 26 liens actifs après promotion (17 pré-existants + 9), le plan en prédisait 27. Smoke hub asserte 26. |
| DEV-S40-C-03 | informational | Sidebar : nouveau sous-groupe nommé « Purchase reports » (3 entrées) créé plutôt que de forcer les reports purchase dans « Inventory reports » — miroir du groupement du hub. |
| DEV-S40-B-01 | informational | Smokes B2/B3 : pattern erreur via flag module-level mutable dans la factory `vi.mock` (le `vi.doMock` + dynamic import de B1 ne se propage pas à travers le cache ES modules) — comportement testé équivalent. |
| DEV-S40-B-02 | informational, fixée (CSV) | Spec-review Wave B LOW : le CSV Purchase by Supplier exportait `avg_lead_days` null comme `0` (la table affiche « — ») → fixé en passant `null` (cellule vide via `formatCell`). Notes LOW restantes non bloquantes : drill-down `served_by` disponible mais non pris sur Staff Performance (S41+ one-liner) ; queryKey `'production'` au lieu de `'production-report'` (cosmétique, sans collision) ; badge Δ% hausse=rouge (choix implémenteur) ; format CSV Old Price texte vs New Price idr-round100 sur Price Changes. |
| DEV-S40-D-01 | **medium, fixée** | pattern-guardian P11 : les 12 migrations S40 portaient les 2 lignes REVOKE function-level mais omettaient la 3ᵉ ligne canonique `ALTER DEFAULT PRIVILEGES … REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` (no-op runtime depuis le sweep S20 — DEV-S25-1.A-02 — mais garde-fou exigé). Fermé par une corrective unique `_022` (pattern S25 `_013`). ACL vérifiées post-fix : `anon` EXECUTE = false sur les 10 fonctions, `authenticated` = true sur les 9 RPCs. |
| DEV-S40-D-02 | informational | `authenticated` détient techniquement EXECUTE sur la fonction trigger `audit_role_permissions_changes` (grant par défaut Supabase, non annulé par le REVOKE PUBLIC/anon) — sans effet : PostgreSQL interdit l'invocation directe d'une fonction `RETURNS TRIGGER` (0A000). |
| DEV-S40-D3-01 | informational | E2E T2 utilise une fenêtre 90 jours pour maximiser la couverture du seed. |
| DEV-S40-D3-02 | informational | CSV validé via `waitForEvent('download')` + taille fichier > 0. |
| DEV-S40-D3-03 | informational | E2E T4 accepte l'empty state — l'audit trail permission_changes peut être vide sur la fenêtre 30j par défaut du dev DB (grant/revoke live couverts par pgTAP T1/T2/T22). |
| DEV-S40-D3-04 | informational | `playwright.config.ts` étendu (testMatch backoffice) pour inclure le spec S40. |
| DEV-S40-A-04 | informational (spec-review LOW) | `_012` : l'ordre du tableau `lines` n'est pas garanti SQL (tri dans la CTE interne seulement) ; `summary.total_value` ne couvre que les ≤1000 lignes retournées quand truncated ; `_019`/`_020` n'ont pas le clamp 366j (bornés LIMIT 501, fidèle au template du plan) ; `_019` calcule un `day` inutilisé ; `_014` round-trip timestamptz inutile mais correct (cols DATE). Aucun bloquant. |

## 4. Critères d'acceptation & tests

- pgTAP `supabase/tests/s40_reports.test.sql` **22/22 PASS** via cloud MCP (exécuté en BEGIN/ROLLBACK ; T1 re-durci puis re-vérifié ; T21/T22 re-vérifiés post-`_021`).
- BO : smokes des 9 pages 18/18 + smoke hub (26 liens, 0 Soon) ; **full sweep BO 146/147 fichiers / 472/473 tests** (1 skip pré-existant), 0 régression.
- Sweeps transverses domain / UI / POS : ✅ exit 0 (aucune régression).
- `pnpm typecheck` : 6/6 packages PASS.
- spec-reviewer Wave A : ✅ conforme (après fix T1) ; spec-reviewer Wave B : ✅ ; pattern-guardian : **13/14 PASS** (P11 ×12 MEDIUM → tous fermés par `_022`, DEV-S40-D-01) ; E2E `tests/e2e/s40-reports.spec.ts` **T1-T4 4/4 PASS** (commit `c2268e9`, captures `test-results/s40-t1..t4.png` non committées — convention S39 tests/e2e only ; login partagé beforeAll, rate-limit 3/min/IP).
- Hub Reports : **0 card « Soon »** — les 25 modules reports sont tous actifs.

## 5. Hors scope S41+

- Wiring `aging_buckets` → `view_ar_aging` (décision S39 maintenue).
- Stubs `purchase`/`history` ProductDetail ; sections/modifiers consumers ; PAT-01/02 ; POS-16/17 ; F-010..013/019..024 ; BO-08 ; BO-21.
- Dé-flakage `variant-select-modal` + `journal-entries` (DEV-S39-D2-01).
- Audit du chemin UPDATE `role_permissions.is_granted` si un RBAC editor write-mode est livré (DEV-S40-A1-02).
- Compare toggle + UnifiedReportFilters extra dims sur les 9 nouveaux reports (parité avec S29/S30 différée).
- Vague D+ backlog : Scheduled email TASK-14-008, Unusual Transactions TASK-14-013, Custom report builder TASK-14-007.
