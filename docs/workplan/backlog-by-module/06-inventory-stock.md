# Travail — Inventory & Stock

> Last updated: 2026-05-17
> Référence : [`../04-modules/06-inventory-stock.md`](../04-modules/06-inventory-stock.md)
> Audits sources : `02-accounting-business-audit.md`, `03-code-quality-schema-audit.md`, `04-reports-testing-audit.md`, `07-product-backlog-audit.md`

## Objectifs du module

1. **F1 — Expiry tracking** (sécurité alimentaire bakery) : tout item périssable suit sa date d'expiration, alerte avant expiration. Critère : 0 produit expiré servi grâce au système.
2. **Schema cleanup** : éliminer les phantom tables (`stock_reservations`, `stock_balances`) pour réconcilier code et DB. Critère : `/db-schema-audit` retourne 0 phantom.
3. **Opname workflow streamlining** : compter 200 produits en < 2h sans erreur. Critère : opname session bouclée en < 2h pour le full catalogue.
4. **Variance reporting** : voir d'un coup d'œil quels produits dérivent (ghost stock, sur/sous-réception). Critère : ghost stock report montre les top 10 variances de la période.

---

## Tâches

### TASK-06-001 — F1 Expiry date tracking — schema + tracking [P0] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.C. V3 evidence: migrations `supabase/migrations/20260517000040_init_stock_lots.sql`, `…000041_add_products_default_shelf_life.sql`, `…000042_add_stock_movements_lot_id_fk.sql`, `…000043_create_lot_rpcs.sql` + FIFO resolution embedded in `record_stock_movement_v1` (extended via `…000020`); hooks `apps/backoffice/src/features/inventory/hooks/useStockLots.ts` + `useExpiringLots.ts` verified. Commit `bdf21aa` (squashed PR #13).
**Contexte** : Bakery products expirent en 1-3 jours. Sans tracking, staff dépend de mémoire / labels manuels. Risque réglementaire si inspection. Source : `docs/audit/07-product-backlog-audit.md§Critical-1`.
**Critère d'acceptation** :
- [ ] Migration : `products.default_shelf_life_hours` (int, nullable).
- [ ] Migration : table `stock_lots` (id, product_id, location_id, quantity, expires_at, received_at, batch_number nullable).
- [ ] Trigger : à chaque purchase received OU production record, créer un `stock_lot` avec `expires_at = received_at + default_shelf_life_hours`.
- [ ] FIFO consumption : trigger sur `stock_movements` consume les lots les plus proches d'expirer en premier.
- [ ] Hooks `useStockLots`, `useExpiringStock`.
- [ ] Tests : production de croissant (8h shelf life) → 8h plus tard, lot marqué expired.
**Fichiers concernés** : nouvelle migration majeure, `src/services/inventory/stockLotService.ts` (à créer), `src/hooks/inventory/useStockLots.ts`.
**Dépend de** : aucune
**Estimation** : `XL`
**Risques** : Refonte du modèle stock. Backfill des stock courants avec expiry hypothétique. Préparer plan de migration data soigneux.

### TASK-06-002 — F1 Expiry alerts + UI [P0] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 1.C. V3 evidence: pg_cron job `supabase/migrations/20260517000045_pg_cron_mark_expired_lots.sql` flips lots to `expired`; page `apps/backoffice/src/features/inventory/pages/ExpiringStockPage.tsx` + `ExpiringLotsBadge.tsx` + smoke test `ExpiringStockPage.smoke.test.tsx` verified. Auto-waste-on-expiry option present in cron RPC. Commit `bdf21aa` (squashed PR #13).
**Contexte** : Une fois F1 schema en place (TASK-06-001), il faut alerter et bloquer les produits expirés. Source : `docs/audit/07-product-backlog-audit.md§Critical-1`.
**Critère d'acceptation** :
- [ ] Cron Supabase (pg_cron) : marque les lots `expired` et déclenche alerte si > 0.
- [ ] Page `/inventory/expiring` : liste lots à expirer < 24h + lots expirés.
- [ ] Bloc visuel POS : produit avec stock_lot expiré → grisé + tooltip « Expired stock, remove ».
- [ ] Notification (toast) à l'ouverture de shift : « X products expiring today ».
- [ ] Auto waste record : option « Mark expired as waste » qui crée `waste_records` (et JE comptable).
- [ ] Tests : produit expirant dans 1h → alerte ; expiré → blocage POS.
**Fichiers concernés** : nouvelle Edge Function `cron-expire-stock-lots`, `src/pages/inventory/ExpiringStockPage.tsx`, `src/components/pos/ProductCard.tsx` (état expired), `src/hooks/inventory/useWasteRecords.ts`.
**Dépend de** : `TASK-06-001`
**Estimation** : `L`
**Risques** : Faux positifs (lot mal-daté à l'arrivée). Workflow de correction manager.

### TASK-06-003 — Migration phantom `stock_reservations` (créer ou supprimer) [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 3.C (decision = OUI, créer). V3 evidence: `supabase/migrations/20260517000132_init_stock_reservations.sql` provisions table + RLS + hold/release/consume RPCs; domain pure-TS in `packages/domain/src/inventory/reservations/reservationCalculator.ts`. Commit `bdf21aa` (squashed PR #13).
**Contexte** : 6 références à `stock_reservations` dans `services/inventory/stockReservation.ts` mais table absente du schema. Source : `docs/audit/03-code-quality-schema-audit.md§A1`.
**Critère d'acceptation** :
- [ ] Décision business : feature stock reservation utile (ex : tablet ordering bloque stock 10 min) ?
- [ ] **Si OUI** : migration table `stock_reservations` + RLS + tests.
- [ ] **Si NON** : suppression du fichier `stockReservation.ts` + références.
- [ ] `/db-schema-audit` ne retourne plus la phantom.
- [ ] Décision documentée dans `docs/reference/04-modules/06-inventory-stock.md`.
**Fichiers concernés** : `src/services/inventory/stockReservation.ts`, nouvelle migration ou suppression.
**Dépend de** : aucune
**Estimation** : `M` (S si suppression, L si création)
**Risques** : Si on supprime alors que ça doit exister, on perd une feature. Vérifier git blame + roadmap.

### TASK-06-004 — Migration phantom `stock_balances` (créer ou supprimer) [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 2.D as a section-aware view. V3 evidence: `supabase/migrations/20260517000097_create_view_section_stock_details.sql` exposes (product_id, section_id, quantity); hook `apps/backoffice/src/features/inventory-dashboard/components/StockBySectionList.tsx` consumes it. Commit `bdf21aa` (squashed PR #13).
**Contexte** : 1 référence à `stock_balances` dans `useStockByLocation.ts`. Probablement une vue à créer ou un alias incorrect pour `view_section_stock_details`. Source : `docs/audit/03-code-quality-schema-audit.md§A1`.
**Critère d'acceptation** :
- [ ] Investiguer : `stock_balances` doit être une vue ou une table ?
- [ ] **Si vue** : migration vue agrégée par (product_id, location_id).
- [ ] **Si alias erreur** : remplacer par la bonne ressource (probable `view_section_stock_details`).
- [ ] Hook `useStockByLocation` retourne données cohérentes.
- [ ] Tests E2E : afficher stock par location → données plausibles.
**Fichiers concernés** : `src/hooks/inventory/useStockByLocation.ts`, nouvelle migration si vue créée.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Faible.

### TASK-06-005 — Phantom RPC `finalize_inventory_count` [P1] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 2.D, renamed `finalize_opname_v1`. V3 evidence: `supabase/migrations/20260517000091_create_opname_rpcs.sql` provides start/set-count/finalize/cancel; hook `apps/backoffice/src/features/inventory-opname/hooks/useOpnameMutations.ts` + `FinalizeOpnameDialog.tsx` wire it. Idempotent + JE-emitting via `tr_20_je_emit`. Commit `bdf21aa` (squashed PR #13).
**Contexte** : `useStockOpname.ts` appelle `finalize_inventory_count` qui n'existe pas en DB. L'opname ne peut pas être finalisé proprement. Source : `docs/audit/03-code-quality-schema-audit.md§A2`.
**Critère d'acceptation** :
- [ ] Migration : RPC `finalize_inventory_count(count_id)` qui : (1) snapshot final, (2) crée `stock_movements` adjustment, (3) appelle `postStockAdjustmentJournalEntry`, (4) marque count `status='completed'`.
- [ ] Atomicité : tout dans une transaction.
- [ ] Idempotent : appeler 2x → 2e no-op.
- [ ] Permission `inventory.adjust` requise.
- [ ] Tests : opname avec 10 items → finalize → variances créent JE.
**Fichiers concernés** : nouvelle migration RPC, `src/hooks/inventory/useStockOpname.ts`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Création JE pour grandes adjustments (ex : 100 produits) peut être lent. Vérifier perf.

### TASK-06-006 — Opname workflow streamlining (UX) [P2] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 2.D core workflow. V3 evidence: `apps/backoffice/src/features/inventory-opname/components/{CreateOpnameModal,AddItemForm,CountItemRow,FinalizeOpnameDialog,CancelOpnameDialog,OpnameStatusBadge}.tsx` + `hooks/{useOpnameList,useOpnameDetail,useOpnameMutations}.ts`. Tablet-specific polish (auto-focus next, voice input) remains a Session 14+ UX follow-up. Commit `bdf21aa` (squashed PR #13).
**Contexte** : Compter 200+ produits manuellement = chronophage. UX actuelle pas évaluée mais probablement scrollable list classique. Inferred from product backlog + bakery operational reality.
**Critère d'acceptation** :
- [ ] UI opname : recherche par catégorie / location / barcode.
- [ ] Mode « rapide » : focus auto sur input quantité après chaque save (pas de tap).
- [ ] Quick-add button : « Add zero » pour les sans-stock.
- [ ] Progress bar : « 47/200 counted ».
- [ ] Auto-save toutes les 10 entries (recovery si crash).
- [ ] Mobile-friendly : tablet + smartphone usable.
**Fichiers concernés** : `src/pages/inventory/StockOpnamePage.tsx`, `src/components/inventory/OpnameItemRow.tsx`.
**Dépend de** : `TASK-06-005` (finalize RPC)
**Estimation** : `L`
**Risques** : Aucun majeur. Test sur tablet réelle.

### TASK-06-007 — Ghost stock cleanup [P2] [TODO]
**Status note (2026-05-14)** : Not delivered Session 13. The stock variance RPC (`supabase/migrations/20260517000075_create_stock_variance_rpc.sql`) and `apps/backoffice/src/pages/reports/StockVariancePage.tsx` surface variance data, but no dedicated `/inventory/ghost-stock` workflow page with Investigate / Write-off / Mark-normal actions exists. Genuine UX gap — Session 14+ follow-up.
**Contexte** : Ghost stock = écarts inexpliqués entre DB et physique. Reports les détectent (`docs/audit/07-product-backlog-audit.md§Audit/fraud detection`). Workflow de cleanup pas formalisé. Inferred from reports module.
**Critère d'acceptation** :
- [ ] Page dédiée `/inventory/ghost-stock` : liste produits avec variance > seuil (configurable).
- [ ] Action « Investigate » : montre derniers movements + audit logs liés.
- [ ] Action « Write off » : crée stock_adjustment + JE.
- [ ] Action « Mark normal » : flag « investigated » sans modifier stock.
- [ ] Audit log de chaque action.
**Fichiers concernés** : `src/pages/inventory/GhostStockPage.tsx`, `src/hooks/inventory/useGhostStock.ts`, réutilise `postStockAdjustmentJournalEntry`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Workflow comptable sensible. Valider avec comptable.

### TASK-06-008 — Transfer locations workflow [P2] [DONE]
**Status note (2026-05-14)** : Delivered in Session 12 (`internal_transfers` migrations `20260516000022/000023`) and surfaced in Session 13. V3 evidence: `apps/backoffice/src/features/inventory-transfers/{components,hooks}/` ship the 2-step source-creates / destination-receives flow with `TransferReceiveModal.tsx`, `TransferCancelConfirm.tsx`, `useCreateTransfer`, `useReceiveTransfer`, `useCancelTransfer`. Movement type `transfer_in/out` enforced via section constraint. Commit `bdf21aa` (squashed PR #13).
**Contexte** : Transferts inter-locations (`internal_transfers` table) existent mais workflow UX pas évalué. Inferred from code review (hook `useInternalTransfers` est 544L → trop gros).
**Critère d'acceptation** :
- [ ] Workflow 2 étapes : (1) source crée transfer pending, (2) destination valide reception (avec QC quantités).
- [ ] Si destination déclare reçu < envoyé : auto-création waste ou ghost stock à investiguer.
- [ ] Notifications : destination notifiée à création, source à validation.
- [ ] Tests : transfer 50 → reçu 48 → ghost 2 ou waste 2.
- [ ] Documenter le flow dans module ref.
**Fichiers concernés** : `src/hooks/inventory/useInternalTransfers.ts` (à décomposer), `src/pages/inventory/TransfersPage.tsx`, nouvelles vues.
**Dépend de** : aucune
**Estimation** : `L`
**Risques** : Workflow change peut casser usages existants. Migration douce avec feature flag.

### TASK-06-009 — Waste tracking UX [P2] [TODO]
**Status note (2026-05-14)** : Partially delivered Session 13. V3 evidence: `apps/backoffice/src/features/inventory/components/WasteModal.tsx` ships preset reasons (Expired/Damaged/Spoiled/Other) + qty cap + JE emission via `waste_stock_v1`. Still missing: POS-side quick-waste button, Capacitor camera photo capture, daily running-waste KPI tile on Dashboard, per-product waste-rate report. Session 14+ follow-up.
**Contexte** : Waste records existent (`postStockWasteJournalEntry` câblé). UX d'enregistrement pas formalisée. Pour bakery (pertes quotidiennes), workflow rapide est crucial. Inferred from accounting audit (waste OK) + product backlog (bakery context).
**Critère d'acceptation** :
- [ ] Bouton « Quick waste » accessible depuis POS et `/inventory`.
- [ ] Catégories waste prédéfinies : expired / damaged / quality / theft / other.
- [ ] Photo optionnelle (Capacitor camera plugin).
- [ ] Affichage running waste du jour (KPI dashboard).
- [ ] Waste rate par produit dans report inventory.
**Fichiers concernés** : `src/components/inventory/QuickWasteModal.tsx` (à créer), `src/hooks/inventory/useWasteRecords.ts`, `src/pages/dashboard/DashboardPage.tsx`.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Permissions : qui peut waste ? Définir avec business.

### TASK-06-010 — Stock variance reporting [P3] [DONE]
**Status note (2026-05-14)** : Delivered Session 13 Phase 6.A. V3 evidence: `supabase/migrations/20260517000075_create_stock_variance_rpc.sql` + page `apps/backoffice/src/pages/reports/StockVariancePage.tsx` + hook `apps/backoffice/src/features/reports/hooks/useStockVariance.ts`; route registered in `apps/backoffice/src/routes/index.tsx`. Drill-down + filtre date range present. Commit `bdf21aa` (squashed PR #13).
**Contexte** : Reports inventory existent mais variance reporting cross-période n'est pas mis en avant. Source : `docs/audit/04-reports-testing-audit.md§Phase 6 missing` (recipe cost trends missing).
**Critère d'acceptation** :
- [ ] Report nouveau : « Stock variance by period » : compare opname N vs N-1, met en évidence top 10 derives.
- [ ] Drill-down : clic sur produit → historique movements de la période.
- [ ] Export CSV/PDF.
- [ ] Filtres date range + location + catégorie.
**Fichiers concernés** : `src/pages/reports/ReportsConfig.tsx`, `src/pages/reports/components/StockVarianceTab.tsx` (à créer), nouvelle vue ou RPC SQL.
**Dépend de** : `TASK-06-006` (opname workflow)
**Estimation** : `M`
**Risques** : Aucun.

### TASK-06-011 — WAC (Weighted Average Cost) auto-update on PO receipt [P1] [DONE]
**Status note (2026-05-17)** : DONE — S17 livré. Nouveau pipeline non-backloggé (pas d'item TASK pre-existant) — créé pour tracer cette livraison structurellement importante (changement de modèle de cost matière première).
**Contexte** : Avant S17, `products.cost_price` n'était jamais mis à jour automatiquement par les flux purchasing — manual UPDATE manager only. Conséquence : marges théoriques se désynchronisent du prix réel d'achat. Cross-module impact : `recipe_versions.snapshot.cost_price` calculé sur le cost stale donne des marges fausses.
**Critère d'acceptation** :
- [x] Trigger `tr_update_product_cost_on_purchase` sur `stock_movements` (migration `20260521000013`) : pour tout INSERT avec `movement_type IN ('purchase', 'incoming')`, calcule `new_cost = (old_cost × old_stock + receive_cost × receive_qty) / (old_stock + receive_qty)` et UPDATE `products.cost_price`
- [x] Idempotent : utilise les valeurs au moment du mouvement (la réplay ne double pas l'effet)
- [x] Cascade : trigger amont `tr_snapshot_on_product_cost_change` (migration `20260521000012`) déclenché par le nouveau `cost_price` propage via WITH RECURSIVE ancestor walk → snapshot `recipe_versions` pour toutes recettes ancestres (depth-5 limite anti-cycle)
- [x] Tests : pgTAP `recipe_cascade_snapshot.test.sql` + Vitest live RPC
**Fichiers concernés** :
- `supabase/migrations/20260521000010_create_snapshot_recipe_version_helper.sql`
- `supabase/migrations/20260521000011_bump_tr_snapshot_recipe_version_cascade.sql`
- `supabase/migrations/20260521000012_create_tr_snapshot_on_product_cost_change.sql`
- `supabase/migrations/20260521000013_create_tr_update_product_cost_on_purchase.sql`
- `supabase/migrations/20260521000030_refresh_latest_recipe_version_full_cascade.sql`
**Dépend de** : aucune (autonomous infra).
**Estimation** : L (livré)
**Risques actifs (follow-ups Session 19+)** :
- DEV-S17-1.B-01 : manual `UPDATE products.cost_price` (hors purchase) bypasse WAC et n'émet pas de `stock_movements` audit row — possible silent drift si manager édite cost à la main
- DEV-S17-1.C-01 : WAC s'applique uniformément à tous les `purchase` movements, pas d'opt-out pour sample stock / promo fournisseur (low)
- DEV-S17-1.C-02 : WAC garbage-in si `current_stock` stale (informational)
**Notes** : INDEX S17 `docs/workplan/plans/2026-05-17-session-17-INDEX.md`. Lié à TASK-07-012 (landed cost) qui pourrait préfixer la WAC avec un cost incluant shipping/douane pro-rata.

---

## Notes transverses

- **Stock alerts thresholds** : < 10 warning, < 5 critical (cf. `CLAUDE.md` Business Rules). Configurables par produit ?
- **Production triggers** : `useProduction.create` gère déduction ingredients + increment finished. Toute modif schema doit préserver ce flow.
- **F2 Batch tracking** : à construire SUR F1 (lot infrastructure réutilisée). Voir TASK-06-001.
- **Comptabilité** : tout adjustment / waste / production passe par `accountingEngine` (mappings `INVENTORY_GENERAL`, `STOCK_WASTE_FOOD`, etc.). Aucune insertion directe de stock_movements sans JE.
