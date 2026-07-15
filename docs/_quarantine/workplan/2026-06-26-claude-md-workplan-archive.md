# CLAUDE.md « Active Workplan » — archive des bullets mergés (au 2026-06-26)

> Ce fichier conserve les résumés de travaux **mergés sur `master`** qui figuraient
> dans la section `## Active Workplan` de `CLAUDE.md`. Ils en ont été retirés le 2026-06-26
> pour garder la section centrée sur le travail en vol (la consigne du fichier interdit de
> dupliquer l'historique dans CLAUDE.md). Pour le détail complet par session, voir les
> `docs/workplan/{plans,specs}/` datés et `docs/superpowers/{plans,specs}/`.

## Mergés (du plus récent au plus ancien)

- **Spec A — POS held-order lifecycle ("addition ouverte")** — PRs #120/#121, sur `master` : (1) migration data-only routant 6 catégories de vente vers les stations de prep (`barista`←Coffee/Speciale Latte/Special Drinks, `kitchen`←Simple Plate/Panini/Savoury Croissant) pour débloquer Send-to-Kitchen (était 100 % `dispatch_station='none'`) ; (2) deux RPCs additifs `_v1` — `hold_fired_order_v1` (flague une commande PO `pending_payment` déjà fired `is_held=true`) et `reopen_held_order_v1` (réclame `is_held=false`, renvoie items + `is_locked`/`kitchen_status` pour réhydrater le panier, pas de delete) — les deux avec la paire REVOKE S25, appliqués en cloud (`20260710000010/11/12`), types regen'd. Front : `cartStore.reopenOrder` (réhydrate les locks depuis `is_locked`→locked+printed), Send-to-Kitchen parque la commande dans Held Orders + clear du terminal (`useHoldFiredOrder`), la liste held branche draft→`restore`/sent→`reopen` avec badge Sent/Draft, flag KOT `ADDITIONAL ORDER` sur les fires appendés. Vérifié : typecheck whole-repo CLEAN, build PASS, domain PASS, smokes POS ciblés verts incl. fire/held corrigés (`828fb95`) ; 3 flakes full-suite parallel-timeout préexistants (variant-modal, pos-grid, product-tap) passent en isolation. Plan : `docs/superpowers/plans/2026-06-25-pos-held-order-lifecycle.md` ; spec : `docs/superpowers/specs/2026-06-25-pos-held-order-lifecycle-design.md`. **Suite = Spec B** (voir CLAUDE.md « In flight »).

- **Phase 2a — historical purchases bulk import** (`feat/bulk-import-purchases`, sur `master`, PR #116) — RPC `import_purchases_v1` (groupe les lignes Excel par `po_reference` → POs `received` flagués `is_historical_import`, reports-only) + trigger `BEFORE INSERT` de blocage de paiement (`20260708000010/11`), `purchasesImportDef` + `useHistoricalPurchasesExport` + boutons Template/Import/Export & badge "Imported" sur la liste PO. Plan : `docs/superpowers/plans/2026-06-24-bulk-import-purchases.md`. **Reste Phase 2 :** Sales + Expenses bulk import (specs ultérieures).

- **Phase 1 — master-data bulk import** (suppliers upsert + customers create-only) — PRs #114/#115. Framework générique `apps/backoffice/src/features/data-import/` (column-def typé, parser `.xlsx` pur, builders template/export, hook `useImportEntity`, `ImportEntityModal` 3 étapes) + RPCs `import_suppliers_v1`/`import_customers_v1` (table d'idempotence, anon defense-in-depth) câblés aux pages Suppliers + Customers. Plan : `docs/superpowers/plans/2026-06-23-bulk-import-master-data.md`.

## Chaîne mergée récente sur `master` (résumé PRs)

- **#121** — held-order lifecycle + audit Settings/Transaction-History (`e48220c`).
- **#117** — Cost & Spend Analytics (purchase COGS + OpEx avec charts, migration `20260706000027`).
- **#118** — POS P0 hardening (reversal REVOKE + ledger balance + KDS/tactile/realtime, migrations `20260709000010/11`).
- **#116** — Phase 2a historical purchases (voir ci-dessus).
- **#114/#115** — Phase 1 bulk import (voir ci-dessus).
- **Plus ancien :** #106 recipe editor, #103 Units Registry, #95/#98/#99/#100 (S46–S49).

> Détail complet par session (S13→S49, PRs autonomes, audits stock/backoffice) : `docs/workplan/` — ouvrir l'INDEX daté pertinent.
