# stock-management — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Checklists d’audit et de prévention
- Sources de vérité (pointers)
- Verification before claiming an audit or fix is complete
- When to escalate
- Ce que ce skill ne couvre pas (déférer)

## Checklists d’audit et de prévention

Pour un audit de stock, lire les sections pertinentes des
[checklists détaillées](checklists.md). Avant de modifier un mouvement,
une RPC, un trigger, une signature ou un parcours d’inventaire, lire aussi la
checklist préventive correspondante. Les contrôles et la vérification avant livraison
restent obligatoires dans leur périmètre ; ce déplacement ne les rend pas optionnels.

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
