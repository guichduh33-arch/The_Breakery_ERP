# Session 39 — INDEX : Backoffice Completion Bundle (BO-04 / BO-09 / BO-10 / BO-15)

- **Date** : 2026-06-11
- **Branche** : `swarm/session-39` (base `master` @ `79d7f13`)
- **Spec** : [`docs/workplan/specs/2026-06-11-session-39-spec.md`](../../specs/archive/2026-06-11-session-39-spec.md)
- **Plan** : [`docs/workplan/plans/2026-06-11-session-39-plan.md`](2026-06-11-session-39-plan.md)
- **Statut** : ✅ exécutée — 12 commits code+tests (`382cfb8..739f409`) + docs, PR ouverte vers `master`

---

## 1. Waves & statut

| Wave | Contenu | Subagent | Statut |
|---|---|---|---|
| A | DB BO-15 : `b2b_settings` table + 2 RPCs + REVOKE pair + types regen + pgTAP 10 | `db-engineer` | ✅ `382cfb8..0ac8b13` — revue spec ✅ (pgTAP ré-exécuté 10/10 par le reviewer) |
| B1 | UnitsPanel write-mode (`set_product_units_v1` S27) | `backoffice-specialist` | ✅ `5ebc208` + fix test `5773a3d` (3/3) — revue spec ✅ |
| B2 | CostingPanel breakdown (`recipe_bom_full_v1` S17) + correction (`update_cost_price_v1` S22) | `backoffice-specialist` | ✅ `b642b51` (3/3, products 33/33) — revue spec ✅ (extra-file PermissionCode confirmé nécessaire) |
| C1 | ProductPicker réel dans EditOrderItemsModal (orchestrateur S33 inchangé) | `backoffice-specialist` | ✅ `c325d43` + durcissement tests `cc6473b` (4/4) — revues spec ✅ + qualité ✅ |
| C2 | B2BSettingsPage persiste (hooks + suppression banner) | `backoffice-specialist` | ✅ `d266382` + fix hooks `71dd13e` (btob 9/9) — revue spec ✅ (1 issue rules-of-hooks trouvée et corrigée) |
| D | pattern-guardian + sweeps + E2E navigateur + INDEX + PR | lead | ✅ guardian 12/12 ; typecheck 6/6 ; sweeps (cf. §4) ; E2E `739f409` T1-T3 PASS + T4 authored/skipped |

## 2. Migrations

| # | Nom | Statut |
|---|---|---|
| `20260623000010` | `create_b2b_settings_table` | ✅ appliquée + vérifiée live |
| `20260623000011` | `create_b2b_settings_rpcs` | ✅ appliquée + vérifiée live (ledger `name` null — DEV-S39-A-01) |
| `20260623000012` | `revoke_pair_b2b_settings_rpcs` | ✅ appliquée + vérifiée live (anon false/false) |

Types regen committé (`f566575`, +40 lignes exactes).

## 3. Déviations

| ID | Sévérité | Description |
|---|---|---|
| DEV-S39-A-01 | Informational | Rows `schema_migrations` des versions `_011`/`_012` ont `name` NULL (l'agent DB a appliqué par une voie détournée après des difficultés MCP) ; contenu cloud vérifié identique au git par le reviewer (pas de drift), pgTAP ré-exécuté 10/10. |
| DEV-S39-A-02 | Informational | Edge cases de type (string non numérique pour `critical_overdue_days`, `min`/`max` fractionnaire) remontent `22P02` (cast `::INT`) au lieu de P0001 — hors périmètre spec (P0001 réservé aux validations sémantiques listées). |
| DEV-S39-A-03 | Informational | Le dernier aging bucket exige une clé `"max": null` explicite (clé omise rejetée) — plus strict que la spec, accepté. |
| DEV-S39-A-04 | Informational | Les 2 RPCs raisent aussi `42501` quand `auth.uid()` est NULL (garde auth-first) — défense en profondeur au-delà de la spec, cohérent avec les patterns projet. |
| DEV-S39-B1-01 | Informational | Smoke `units-panel-write` : leçon Vitest — les objets de DONNÉES mockés (pas seulement les variables de contrôle) doivent être `vi.hoisted()` avec référence stable quand ils alimentent des deps `useEffect`, sinon boucle de rendu infinie → OOM du worker. Fix `5773a3d`. |
| DEV-S39-B2-01 | Informational | `packages/supabase/src/rls/permissions.ts` : ajout de `'inventory.cost_correction'` au union `PermissionCode` — hors liste de fichiers du plan mais nécessaire (perm seedée en DB depuis S22, jamais reflétée côté TS ; le gate du CostingPanel ne typecheckait pas sans). |
| DEV-S39-C1-01 | Informational | Bug latent S33 corrigé au passage : les éditions de qty sur les lignes *pending* de EditOrderItemsModal écrivaient dans `diff.updates` avec des ids fictifs `__pending-N` ; désormais branchées sur `diff.adds`. Le bouton remove est aussi disponible sur les pending adds. |
| DEV-S39-C2-01 | Informational | `CreateB2bOrderModal` n'a pas de champ payment-terms (Customer/Items/Delivery date/Notes uniquement) → pas de pré-remplissage possible ; anticipé par le plan (« no-op + déviation »). Futur consumer : `useB2bSettings().data?.default_payment_terms`. |
| DEV-S39-D2-01 | Informational | Sweep full-suite : 2 flakes pré-existants sous charge, hors périmètre S39 (zéro fichier POS/accounting touché) — POS `variant-select-modal.smoke` (S27c, "multiple elements" testid, 2/2 PASS isolé) et BO `journal-entries.smoke` T1 (S26b, timeout ~12.6 s, 2/2 PASS isolé). À dé-flaker S40+. |
| DEV-S39-D2-02 | Informational | Advisors Supabase post-migration : 3 notices sur `b2b_settings` toutes intentionnelles (SECURITY DEFINER exécutable par authenticated ×2 = modèle standard projet gate in-RPC ; RLS sans policy = accès RPC-only, pattern S25/S35). |
| DEV-S39-C2-02 | **Medium, fixée** | Revue spec C2 : violation `react-hooks/rules-of-hooks` introduite par `d266382` — `useState(saveError)` déclaré après le early-return `if (!canRead)` ; crash réel si `canRead` bascule post-mount (scénario réhydratation auth PR #66). Hoisté avec les autres states, fix `71dd13e`, lint clean, btob 9/9. |
| DEV-S39-D3-01 | Informational | E2E T2/T3 ciblent le premier produit avec `cost_price > 0` (« Almond cream ») et non la première row littérale (cost 0) — `CorrectCostDialog` exige `newCost > 0`, un produit à coût 0 ne serait pas restaurable via l'UI. |
| DEV-S39-D3-02 | Informational | E2E T4 (ProductPicker) auto-skip : aucun ordre `draft`/`pending_payment` dans la seed V3 dev et création interdite par le brief — le test est écrit et s'exécutera dès qu'un ordre éditable existera ; le flow est couvert par les smokes 4/4. Suite E2E en login partagé `beforeAll` (rate-limit `auth-verify-pin` 3/min/IP). |

## 4. Critères d'acceptation

- [x] BO-15 — persist + validations + audit + pgTAP **10/10** (ré-exécuté par le reviewer) + banner supprimé ; E2E persist post-reload vérifié.
- [x] BO-09 — UnitsPanel réel, REPLACE semantics (soft-delete vérifié en DB par l'E2E), `SAMPLE_ALT_UNITS` supprimé, perm gate ; smokes 3/3.
- [x] BO-10 — CostingPanel WAC + marge + BOM + correction auditée (2 rows `cost_price_correction` vérifiées en DB par l'E2E) ; smokes 3/3.
- [x] BO-04 — ProductPicker search/add, parents exclus, Save S33 non-régressé (orders 16/16) ; smokes 4/4 (durcis post-revue : assertion prix + payload Apply).
- [x] TEST — pgTAP 10/10 ; smokes BO PASS ; sweeps : domain/UI/supabase ✅, POS 415/418 et BO 451/453 (2 flakes pré-existants hors S39, 2/2 isolés — DEV-S39-D2-01) ; typecheck 6/6 ; types regen `f566575`.
- [x] E2E — T1 B2B Settings / T2 Units / T3 Costing **PASS navigateur** (vérifs DB post-run, captures `test-results/s39-t1..t4.png`) ; T4 ProductPicker authored, skip env documenté (DEV-S39-D3-02 — couvert smokes).
- [x] pattern-guardian **12/12**, 0 violation.
- [x] INDEX rempli + CLAUDE.md bumpé + PR créée.

## 5. Hors scope S40+

Voir spec §8 — notamment : wiring `aging_buckets` → `view_ar_aging` (décision actée), stubs `purchase`/`history` ProductDetail, sections/modifiers consumers, PAT-01/02, POS-16/17, F-010..013/019..024, BO-08, BO-21.
