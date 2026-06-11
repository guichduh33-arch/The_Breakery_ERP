# Session 39 — INDEX : Backoffice Completion Bundle (BO-04 / BO-09 / BO-10 / BO-15)

- **Date** : 2026-06-11
- **Branche** : `swarm/session-39` (base `master` @ `79d7f13`)
- **Spec** : [`docs/workplan/specs/2026-06-11-session-39-spec.md`](../specs/2026-06-11-session-39-spec.md)
- **Plan** : [`docs/workplan/plans/2026-06-11-session-39-plan.md`](2026-06-11-session-39-plan.md)
- **Statut** : 🚧 en cours

---

## 1. Waves & statut

| Wave | Contenu | Subagent | Statut |
|---|---|---|---|
| A | DB BO-15 : `b2b_settings` table + 2 RPCs + REVOKE pair + types regen + pgTAP 10 | `db-engineer` | ⬜ |
| B1 | UnitsPanel write-mode (`set_product_units_v1` S27) | `backoffice-specialist` | ⬜ |
| B2 | CostingPanel breakdown (`recipe_bom_full_v1` S17) + correction (`update_cost_price_v1` S22) | `backoffice-specialist` | ⬜ |
| C1 | ProductPicker réel dans EditOrderItemsModal (orchestrateur S33 inchangé) | `backoffice-specialist` | ⬜ |
| C2 | B2BSettingsPage persiste (hooks + suppression banner) | `backoffice-specialist` | ⬜ |
| D | pattern-guardian + sweeps + E2E navigateur + INDEX + PR | lead | ⬜ |

## 2. Migrations

| # | Nom | Statut |
|---|---|---|
| `20260623000010` | `create_b2b_settings_table` | ⬜ |
| `20260623000011` | `create_b2b_settings_rpcs` | ⬜ |
| `20260623000012` | `revoke_pair_b2b_settings_rpcs` | ⬜ |

Types regen requis post-`_011`.

## 3. Déviations

| ID | Sévérité | Description |
|---|---|---|
| — | — | (à remplir au fil des waves) |

## 4. Critères d'acceptation

- [ ] BO-15 — persist + validations + audit + pgTAP 10/10 + banner supprimé.
- [ ] BO-09 — UnitsPanel réel, REPLACE semantics, `SAMPLE_ALT_UNITS` supprimé, perm gate.
- [ ] BO-10 — CostingPanel WAC + marge + BOM + correction auditée.
- [ ] BO-04 — ProductPicker search/add, parents exclus, Save S33 non-régressé.
- [ ] TEST — pgTAP + smokes + sweeps + typecheck 6/6 + types regen committé.
- [ ] E2E — 4 parcours navigateur validés, persist vérifié après reload.
- [ ] pattern-guardian 0 violation.
- [ ] INDEX rempli + CLAUDE.md bumpé + PR créée.

## 5. Hors scope S40+

Voir spec §8 — notamment : wiring `aging_buckets` → `view_ar_aging` (décision actée), stubs `purchase`/`history` ProductDetail, sections/modifiers consumers, PAT-01/02, POS-16/17, F-010..013/019..024, BO-08, BO-21.
