# Session 77 — Nightly vert (critère de sortie n°1 de la remise à plat)

> **Date :** 2026-07-14 · **Branche :** `swarm/session-77` · **Périmètre :** CI/tests uniquement — **money-path intouché** (aucune migration produit, aucun RPC bumpé ; seuls des fichiers de test, le workflow nightly et `types.generated.ts` bougent).
> **Source :** `docs/workplan/remise-a-plat/00-INDEX.md` §5 critère 1 — « Nightly pgTAP vert (ou liste d'exclusions datée et motivée) ». Dernier critère ouvert après S76 (2/3/4/5 ✅).

## Diagnostic (run nightly `29205788484`, 2026-07-12 — rouge chaque nuit, 3 jobs / 3 causes)

### Job `pgtap` — 5 fichiers hard-fail + ~34 `not ok` silencieux
Le job ne compte que les erreurs SQL (`psql -v ON_ERROR_STOP=1`, exit≠0). Les assertions pgTAP rouges (`not ok`) n'affectent pas le code de sortie → **15 fichiers échouent en silence** (le « filet troué » de la fiche 23).

**Hard-fail (erreur SQL, vérifiées dans le log) :**
| Fichier | Erreur | Cause racine |
|---|---|---|
| `close_shift_three_way.test.sql:104` | `function close_shift_v5(...) does not exist` | `close_shift_v6` (`_142`, 2026-07-10) a droppé v5 — vérifié live : seule v6 existe (mêmes 9 args) |
| `idempotency_hardening.test.sql:170` | `function create_tablet_order_v3(...) does not exist` | `create_tablet_order_v4` (`_144`) a droppé v3 — vérifié live |
| `combo_fire_pay.test.sql:33` | `ERROR: table_required_for_dine_in` | garde dine-in ajoutée par `_144` — le seed fire un dine-in sans table valide |
| `pay_existing_flag_aware.test.sql:26` | `ERROR: table_required_for_dine_in` | idem |
| `users.test.sql:324` | `create_user_v1: missing permission users.create` | grants live corrects (ADMIN/SUPER_ADMIN ont `users.create`) — contexte d'impersonation du test à tracer |

**`not ok` silencieux (comptes du run) :** close_shift_pin_gate 8 · close_shift_note_enforced 6 (les deux = drift v5→v6) · combo_migration 3 · users 2 · reports_pnl_bs_cf 2 · pos_voids_refunds 2 · marketing 2 (cron `birthday-notify-daily` absent) · batch_production 2 · settings 1 · recipe_cascade_snapshot 1 · product_variants 1 · po_payments 1 · inventory_phase1_complete 1 · close_shift_three_way 1 · cash_register 1.

### Job `live-rpc-vitest` — tempête de rate-limit au login
~44 fichiers de test définissent chacun leur `loginAs` local contre l'EF `auth-verify-pin` (~3/min/IP) → quasi tous meurent en `{"error":"rate_limited"}`. S71 a déjà résolu ce problème pour Playwright (`fixtures/auth.ts`) ; la suite vitest n'a jamais été alignée. S'y ajoutent : `sign-zreport` → `supabaseKey is required` (secret repo `SUPABASE_ANON_KEY` jamais posé — dette Deferred S51+) et `settings-inventory` → `invalid_credentials` EMP000 (à trier après la fin de la tempête : probablement lockout induit).

### Job `drift-checks` — `types.generated.ts` périmé
La greffe de types S75 a raté les colonnes `business_config.kds_*` (`_163`) — le regen CI ajoute `kds_warning_threshold_minutes` & co. en `+`.

## Lots

- **Lot D — types drift (quick win, indépendant)** : regen MCP → diff prudent (memory : drift étranger possible) → greffe ciblée des colonnes `kds_*` → commit.
- **Lot A1 — 5 hard-fail** : bump des appels de test v5→`close_shift_v6` (3 fichiers close_shift) et v3→`create_tablet_order_v4` ; seed d'une table dine-in valide dans `combo_fire_pay` + `pay_existing_flag_aware` ; trace du contexte `users.test.sql`. Re-passe live par fichier (MCP execute_sql BEGIN/ROLLBACK ou runner API-from-file pour les gros fichiers).
- **Lot A2 — triage des 15 suites silencieuses** : réparer ce qui est du drift de test ; quarantaine datée motivée (`supabase/tests/_quarantine/`) pour ce qui exige une décision ou dépend de données du dev partagé (convention S58).
- **Lot B — durcir le workflow** (après A1/A2) : le job `pgtap` doit échouer sur `not ok` dans l'output, pas seulement sur erreur SQL — sinon « vert » reste mensonger.
- **Lot C — vitest login partagé** : helper `_helpers/auth.ts` (cache de token par employé au niveau run + retry honorant `retry_after_sec`), migration des ~44 `loginAs` locaux, miroir du pattern S71.
- **Closeout** : `workflow_dispatch` du nightly → 3 jobs verts (ou exclusions datées) ; INDEX S77 ; bump CLAUDE.md (dont **versions périmées dans Critical patterns : `close_shift_v6` / `create_tablet_order_v4`**) ; PR squash.

## Actions utilisateur (bloquantes pour le 100 % vert)
1. `gh secret set SUPABASE_ANON_KEY --body "<anon key>"` — débloque ~45 tests anon-path vitest (dont sign-zreport).
2. Les 3 secrets E2E jamais posés (D-8 S76) : `VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER` — le nightly Playwright meurt en ~10 s sans eux (hors critère n°1, mais même famille).
