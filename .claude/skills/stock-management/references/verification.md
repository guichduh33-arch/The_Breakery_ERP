# stock-management — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Audit checklist (combo: précision / automatisation / sécurité / traçabilité)
- Preventive checklists (5 concrete cases)
- Sources de vérité (pointers)
- Verification before claiming an audit or fix is complete
- When to escalate
- Ce que ce skill ne couvre pas (déférer)

## Audit checklist (combo: précision / automatisation / sécurité / traçabilité)

Run a section when you suspect a gap. Each check is a discrete SQL/code query you can execute via MCP `execute_sql` or grep.

### A. Précision (computed matches stored)

- [ ] **Opname diff** — for every product, `current_stock - SUM(quantity) FROM stock_movements GROUP BY product_id` must equal 0 (column is `quantity`, signed — NOT `quantity_delta`). Caveat: only holds if ALL initial stock entered via the ledger; on a seeded dev DB most products have `current_stock` set without movements, so restrict to products that HAVE movements (`JOIN stock_movements`). ⚠️ **Ne jamais ventiler ce contrôle par section** : le stock est mono-emplacement (ADR-027) et les colonnes de section sont NULL sur tout mouvement récent.
- [ ] **WAC validity** — recompute weighted average cost from `stock_movements` `purchase` rows carrying a `unit_cost` (NOT `incoming` — those rarely have unit_cost and don't feed WAC) and compare to `products.cost_price`. Drift > 0.01 IDR = audit (likely manual UPDATE or `update_cost_price`, see Pattern #5).
- [ ] **Recipe yield** — for every `production_records` row, compare `quantity_produced` to `recipes.yield_quantity * batch_count`. Recurring discrepancy = recipe definition drift or production input was approximated.
- [ ] **Negative stock** — `SELECT * FROM products WHERE current_stock < 0`. ⚠️ Ce n'est PAS forcément un bug : la vente autorise le négatif tant que `business_config.allow_negative_stock` vaut true, et la production peut avoir été **forcée** (ADR-008 D4). Croiser avec `audit_logs` (`metadata->>'force_negative' = 'true'`) avant de conclure ; un négatif sans trace de forçage ni réglage permissif, lui, est un vrai trou. Un stock de **vitrine** négatif, en revanche, est toujours un défaut : sa garde est inconditionnelle.
- [ ] **Semi-finis stockés (ADR-016)** — un produit `track_inventory = true` qui a une recette
      ET qui est cité par la recette d'un autre produit doit voir son stock BAISSER quand ce
      parent est produit. S'il ne fait que croître, la cascade est repartie en dépliage
      intégral quelque part : régression ADR-016, à signaler.
- [ ] **Orphan lot_id** — `stock_movements.lot_id NOT NULL AND lot_id NOT IN (SELECT id FROM stock_lots)` should be empty. If not, the FK was relaxed somewhere (check `supabase/migrations/`). ⚠️ Contrôle d'intégrité référentielle **uniquement** — un `lot_id` NULL n'est pas un défaut (ADR-004).

### B. Automatisation (triggers + crons active)

- [ ] **JE trigger attached** — `SELECT * FROM pg_trigger WHERE tgname = 'tr_20_je_emit'` confirms attachment. (Also expect `tr_update_product_cost_on_purchase` = the WAC trigger.)
- [ ] **Spoilage cron** — `mark_expired_lots_hourly` doit être **`active = false`** (décommissionnement ADR-004). `SELECT jobname, active FROM cron.job`. S'il repasse à `true`, c'est une **régression** : il auto-wasterait du stock déjà vendu. Crons stock légitimes, relevés actifs le 2026-08-31 : `recompute-recipe-costs-daily`, `recompute-recipe-margins-daily`, `refresh-mv-stock-variance`, `release-expired-reservations`, plus `notification-dispatch-minutely` (transverse, il draine la file d'alertes ci-dessous).
- [ ] **WAC cascade on receive** — only `purchase` (PO) and `production_in` feed WAC → fires `tr_snapshot_on_product_cost_change` → ancestor `recipe_versions` re-snapshot. `incoming` does NOT (voir « Cost backbone »). Run pgTAP `recipe_cascade_snapshot.test.sql`.
- [ ] **Alertes low-stock — l'ancien constat « ABSENT » est PÉRIMÉ** (il datait du 2026-05-30).
      Relevé du 2026-08-31 : un trigger `trg_notify_low_stock` sur `products` (fonction
      `_trg_notify_low_stock`) enfile une notification `low_stock_alert` vers
      `business_config.alert_email`, drainée par le cron `notification-dispatch-minutely`.
      Les alertes ne sont donc plus seulement réactives. La RPC à la demande de la famille
      `get_low_stock` existe toujours, en **mode global uniquement** (le mode par section est
      tombé avec ADR-027). → Ne plus signaler l'absence d'alerte proactive ; si un audit
      cherche un trou ici, il porte sur le **seuil** (`min_stock_threshold`) et sur
      l'existence d'un destinataire, pas sur le mécanisme.
- [ ] **Recipe re-snapshot trigger** — `AFTER UPDATE ON recipes` creates a new `recipe_versions` row? Manual snapshots = drift risk.

### C. Sécurité

- [ ] **RLS on stock_movements** — aucune policy UPDATE ni DELETE ne doit exister. Vérifié le 2026-08-31 : une seule policy vivante, `perm_read` en `SELECT`. Verify with `pg_policies`.
- [ ] **REVOKE pair on every stock RPC** — for each function in `supabase/migrations/*stock*` and `*inventory*`, confirm the 3-line REVOKE block. Missing ALTER DEFAULT PRIVILEGES = anon may inherit EXECUTE via PUBLIC.
- [ ] **Perm gate** — every stock RPC checks `has_permission(auth.uid(), 'inventory.<scope>.<action>')`. Grep for any `SECURITY DEFINER` function without a `has_permission` call.
- [ ] **audit_logs row** — every mutation produces an audit_log row with canonical cols `actor_id / action / entity_type / entity_id / metadata`. Missing rows = silent operations.
- [ ] **Idempotency key validation** — UUID v4 enforced via regex or CHECK? Cross-RPC replay tracked in audit_logs as `*.replay` action?
- [ ] **CHECK constraints intact** — liste relevée le 2026-08-31 :
      `chk_stock_movements_reason_required` (reason ≥ 3 sauf sale/sale_void),
      `chk_stock_movements_reference_required_for_orders`, `chk_supplier_only_on_purchase`,
      `stock_movements_unit_cost_check`, plus `unit` et `quantity` NOT NULL et l'index UNIQUE
      `stock_movements_idempotency_key_key`. **Aucune contrainte de section** — les deux ont
      été droppées par ADR-027 et ne doivent pas revenir. Note: nonzero-quantity is enforced
      by the `record_stock_movement` primitive (`quantity_must_be_nonzero`), NOT a table
      CHECK — `cost_price_correction` legitimately writes `quantity=0` by bypassing the
      primitive.

### D. Traçabilité

- [ ] **Ledger continuity** — no gap in `stock_movements` sequence integrity. If the sequence is bumped without inserts, investigate.
- [ ] ~~**Lot_id on consumption**~~ — **contrôle SUPPRIMÉ (ADR-004)**. Un `lot_id IS NULL` sur une consommation est le fonctionnement nominal, pas un trou de traçabilité. La traçabilité repose sur `reason`, `metadata`, `reference_type/id` et `audit_logs`.
- [ ] **`reason` populated** — for `adjustment*`, `waste`, never NULL/blank (column is `reason`, NOT `reason_code`). Use `SELECT * FROM stock_movements WHERE movement_type IN ('adjustment','adjustment_in','adjustment_out','waste') AND (reason IS NULL OR length(trim(reason)) < 3)`.
- [ ] **Idempotency replay distinguished** — audit_logs distinguishes `*.created` vs `*.replay` to spot retries. If the same action appears N times without `.replay` suffix, the idempotency layer was bypassed.
- [ ] **Chain entry → exit** — for any product, you can trace at least one row of type `purchase`/`incoming` → `production_in/out` → `sale`, en chaînant sur `product_id` + `metadata->>'production_id'` / `reference_id` (**pas** sur `lot_id`, cf. ADR-004). Une chaîne rompue = lignes forcées par INSERT direct, ou stock initial jamais entré par le ledger (cf. m10).

## Preventive checklists (5 concrete cases)

### 5.A — Before adding a value to the `movement_type` enum
- [ ] Does `tr_stock_movement_je` know how to map the new type to a COA account? Sinon il
      sort en silence (l'early-return couvre tout type hors liste) — c'est la panne muette
      à redouter, pas une erreur.
- [ ] ~~Section constraint~~ — **sans objet** : plus aucune contrainte de section sur le
      ledger (ADR-027). Ne pas en ajouter une pour le nouveau type.
- [ ] Avant même d'ajouter une valeur : **le besoin exige-t-il vraiment un mouvement ?**
      ADR-008 D2 a délibérément refusé d'ajouter `production_waste` à l'enum, un raté
      n'entrant jamais en stock — l'écriture comptable s'est rattachée au `production_in`
      existant. Un besoin purement comptable ne justifie pas un `movement_type`.
- [ ] Is there a perm gate `inventory.<action>` for this new type? Seed the permission in the same migration block.
- [ ] New pgTAP coverage in `supabase/tests/inventory_movements.test.sql` for the happy path + REVOKE + audit_logs row.

### 5.B — Before creating a new stock RPC
- [ ] `SECURITY DEFINER` with explicit `has_permission(auth.uid(), 'inventory.<scope>.<action>')` gate.
- [ ] `p_idempotency_key UUID` arg if retry-safe (it usually is).
- [ ] Calls the `record_stock_movement` primitive — never direct `INSERT INTO stock_movements`.
- [ ] `audit_logs` insert with canonical cols.
- [ ] REVOKE pair canonique (3 lines, see Pattern #7).
- [ ] pgTAP coverage: happy path + perm denied + replay returns existing + edge cases (idempotent FK violation re-read).
- [ ] Types regen via MCP `generate_typescript_types` → write to `packages/supabase/src/types.generated.ts` + commit.

### 5.C — Before touching a trigger (JE, WAC cascade)
- [ ] Identify every RPC that depends on the trigger. JE trigger is depended on by la RPC de production, `adjust_stock` / `waste_stock`, `finalize_opname`. (Les mouvements de vente n'émettent PAS de JE via ce trigger — le JE de vente vient du flux commande.)
- [ ] Write an integration pgTAP test that exercises the full chain entry → production → sale, asserting the trigger fired the expected `journal_entries` row.
- [ ] Cross-check les correctifs historiques pour les régressions connues : DEV-S15-2.B-01 (recipe_versions cost reconstruction), DEV-S17-2.A-01 (`expandRecipeCascade` n'a aucun consommateur applicatif — re-vérifié le 2026-08-31, toujours vrai).
- [ ] Additive migration first (new trigger function, attach), then drop the old in the next migration once production is stable.

### 5.D — Before modifying a CHECK / FK / RLS on stock tables
- [ ] Identify the invariant the constraint protects (précédent : relâcher `orders.session_id NOT NULL` et le bug de RECORD de la famille `refund_order_rpc` ne se sont manifestés qu'une fois qu'un autre changement a exercé le chemin).
- [ ] Check existing rows that would violate the new constraint — data migration must run first if any.
- [ ] Regression test suite: `inventory*.test.sql` + `recipe_*.test.sql` + `*production*.test.sql` via MCP `execute_sql` BEGIN/ROLLBACK envelope.
- [ ] RLS on `stock_movements` UPDATE/DELETE is non-negotiable — never relax. Find another mechanism if you need correction (a new void RPC, never UPDATE).

### 5.E — Before bumping an existing RPC `_vN` → `_vN+1`
- [ ] New signature lives in a new migration file with a forward timestamp.
- [ ] `DROP FUNCTION ... vN(<exact old args>)` in the SAME migration as the new function definition.
- [ ] REVOKE pair on `_vN+1` (the new function is anon-callable by default, even if `_vN` wasn't).
- [ ] Hooks in BO / POS calling `_vN`: locate via `Grep` on the function name, bump all callers to `_vN+1`.
- [ ] Types regen + commit.
- [ ] pgTAP covers the new signature and at least one case that wasn't covered in `_vN`.

## Sources de vérité (pointers)

Hiérarchie de vérité (CLAUDE.md) : **le code et le schéma DB** d'abord, puis `docs/adr/`,
puis `docs/objectifs/`, puis `docs/product/` + `docs/runbooks/`.

```
Décisions qui gouvernent ce domaine (immuables)
  docs/adr/004-pas-de-peremption-ni-fifo-stock.md        # ni FIFO ni péremption — CLOS
  docs/adr/008-production-recettes-arbitrages.md         # SOLDÉ : les 9 décisions livrées
  docs/adr/014-pas-de-je-reevaluation-cost-price-correction.md
  docs/adr/016-consommation-semi-finis-stockes.md        # cascade stoppée aux semi-finis stockés
  docs/adr/027-stock-global-mono-section.md              # stock mono-emplacement, transferts droppés
  docs/adr/024-liste-de-stock-compteurs-portee-et-mesures.md  # compteurs séparés des lignes, unité + valorisation au coût
  docs/adr/007 / 011 / 012                               # domaine produits (track_inventory, variantes)

Documentation vivante — les seules arborescences à consulter
  docs/adr/                                              # décisions actées, immuables
  docs/objectifs/                                        # intention métier (dont INVENTORY, PRODUCTION)
  docs/product/ · docs/runbooks/                         # opérationnel

Vérité live (à préférer à tout fichier)
  MCP execute_sql : pg_get_functiondef, pg_trigger, cron.job, information_schema
  supabase/migrations/                                   # historique, mais peut avoir dérivé du live

Tests (vérité comportementale — les lancer pour vérifier un changement ; relevé du
2026-08-31, toujours localiser par glob et non de mémoire)
  supabase/tests/inventory*.test.sql · stock*.test.sql · recipe*.test.sql · *production*.test.sql
  supabase/tests/display_stock*.test.sql · display_oversell_contract · s44_display_symmetry
  supabase/tests/b2b_display_aware_stock · b2b_order_flag_aware_stock · f6_sub_recipes
  supabase/tests/adr008_d7_d8.test.sql                   # revert refusé si le lot a bougé
  supabase/tests/sale_stock_unification.test.sql         # helper de déduction de vente
  supabase/tests/pay_existing_recipe_consumption.test.sql # déduction recette au paiement différé
  (aucun test de transfert interne : la feature est droppée — ADR-027)

Domain (pure TS — mental model + validators, IO-free)
  packages/domain/src/inventory/                         # validations, computeStockDelta
  packages/domain/src/production/                        # bomResolver, expandRecipeCascade
```

## Verification before claiming an audit or fix is complete

Les filtres vitest matchent le **NOM DE FICHIER**, pas le `describe`.

```bash
# Type & lint (cheap, run first) — le lint-ratchet CI bloque aussi sur les erreurs
# PRÉEXISTANTES des fichiers touchés par la PR : lint ce que tu as touché.
pnpm typecheck
pnpm --filter @breakery/domain test inventory
pnpm --filter @breakery/domain test production

# RPC-level : pgTAP via MCP execute_sql, enveloppe BEGIN … ROLLBACK.
# Pas de runner local (Docker retiré). Pour voir TOUTES les assertions d'un coup,
# agréger les is() en un seul SELECT … UNION ALL — sinon le MCP ne renvoie que
# le dernier result set.

# Backoffice smoke (le paquet est @breakery/app-backoffice, PAS @breakery/backoffice)
pnpm --filter @breakery/app-backoffice test inventory
pnpm --filter @breakery/app-backoffice test recipes

# POS smoke — la suite POS complète part en timeout en local ; la CI est le seul
# filet full-suite.
pnpm --filter @breakery/app-pos test stock
```

Après tout changement de schéma : **régénérer les types** (`generate_typescript_types` →
`packages/supabase/src/types.generated.ts`) et les commiter. C'est la cause n°1 de CI cassée.

If you're auditing prod data, work against V3 dev cloud `ikcyvlovptebroadgtvd` via the Supabase MCP, never against prod (V2 monolith `abjabuniwkqpfsenxljp` is incompatible with V3 migration lineage).

## When to escalate

- About to relax a RLS policy / CHECK / FK on stock tables → flag, almost always covers a latent bug elsewhere.
- About to add a `movement_type` value → flag, JE mapping is silent if missing.
- About to write directly to `stock_movements` from a new RPC → don't. Always use the primitive.
- Audit finds drift between WAC and recomputed cost > 0.01 IDR on more than 3 products → flag, likely manual UPDATE in production history.
- Audit finds orphan `lot_id` rows → flag, FK was relaxed somewhere.
- `mark_expired_lots_hourly` repassé à `active = true` → flag immédiat, régression ADR-004.
- Envie de « réparer » le FIFO, la péremption, la vitrine POS (lui ajouter WAC/lots/JE), le
  stock par section ou les transferts internes → **ne pas coder**. Toutes sont des décisions
  actées (ADR-004, ADR-027), pas des trous.
- Un nouveau besoin de dépassement de stock → il se gate sur une permission dédiée,
  jamais sur un réglage global (ADR-008 D4).
- Un résolveur de recette qui redescend à travers un semi-fini `track_inventory = true`
  → flag immédiat, régression ADR-016 (double déduction de matière + erreur d'unité ×1000).
- Une table ou une RPC de section/transfert qui réapparaît → flag, régression ADR-027 :
  la réintroduction d'un stock multi-emplacements exige un ADR supersédant.

## Ce que ce skill ne couvre pas (déférer)

- Mécanique de migration / versioning / REVOKE / regen des types → skill `db-migrations`.
- Écritures comptables, mapping COA, période fiscale, clôture → skill `accounting`.
- RBAC, conception d'un gate de permission, RLS → skill `security-auth`.
- Cycle de vie des commandes, void/refund côté métier commande → skill `orders`.
- Catalogue produit, variantes, `is_display_item` → skill `products-catalog`.
