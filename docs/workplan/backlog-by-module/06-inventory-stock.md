# Travail — Inventory & Stock

> Last updated: 2026-05-03
> Référence : [`../04-modules/06-inventory-stock.md`](../04-modules/06-inventory-stock.md)
> Audits sources : `02-accounting-business-audit.md`, `03-code-quality-schema-audit.md`, `04-reports-testing-audit.md`, `07-product-backlog-audit.md`

## Objectifs du module

1. **F1 — Expiry tracking** (sécurité alimentaire bakery) : tout item périssable suit sa date d'expiration, alerte avant expiration. Critère : 0 produit expiré servi grâce au système.
2. **Schema cleanup** : éliminer les phantom tables (`stock_reservations`, `stock_balances`) pour réconcilier code et DB. Critère : `/db-schema-audit` retourne 0 phantom.
3. **Opname workflow streamlining** : compter 200 produits en < 2h sans erreur. Critère : opname session bouclée en < 2h pour le full catalogue.
4. **Variance reporting** : voir d'un coup d'œil quels produits dérivent (ghost stock, sur/sous-réception). Critère : ghost stock report montre les top 10 variances de la période.

---

## Tâches

### TASK-06-001 — F1 Expiry date tracking — schema + tracking [P0] [TODO]
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

### TASK-06-002 — F1 Expiry alerts + UI [P0] [TODO]
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

### TASK-06-003 — Migration phantom `stock_reservations` (créer ou supprimer) [P1] [TODO]
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

### TASK-06-004 — Migration phantom `stock_balances` (créer ou supprimer) [P2] [TODO]
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

### TASK-06-005 — Phantom RPC `finalize_inventory_count` [P1] [TODO]
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

### TASK-06-006 — Opname workflow streamlining (UX) [P2] [TODO]
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

### TASK-06-008 — Transfer locations workflow [P2] [TODO]
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

### TASK-06-010 — Stock variance reporting [P3] [TODO]
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

---

## Notes transverses

- **Stock alerts thresholds** : < 10 warning, < 5 critical (cf. `CLAUDE.md` Business Rules). Configurables par produit ?
- **Production triggers** : `useProduction.create` gère déduction ingredients + increment finished. Toute modif schema doit préserver ce flow.
- **F2 Batch tracking** : à construire SUR F1 (lot infrastructure réutilisée). Voir TASK-06-001.
- **Comptabilité** : tout adjustment / waste / production passe par `accountingEngine` (mappings `INVENTORY_GENERAL`, `STOCK_WASTE_FOOD`, etc.). Aucune insertion directe de stock_movements sans JE.
