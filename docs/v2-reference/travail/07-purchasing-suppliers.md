# Travail — Purchasing & Suppliers

> Last updated: 2026-05-03
> Référence : [`../04-modules/07-purchasing-suppliers.md`](../04-modules/07-purchasing-suppliers.md)
> Audits sources : `02-accounting-business-audit.md`, `03-code-quality-schema-audit.md`, `07-product-backlog-audit.md`, `08-operations-lan-audit.md`

## Objectifs du module

1. **PO state machine claire** : draft → sent → partial received → fully received → closed → cancelled. Transitions interdites bloquées en DB et en UI. Critère : impossible de marquer « received » un PO en `cancelled`.
2. **3-way match** : PO + Receipt + Invoice s'accordent sur quantités et montants avant d'être paid. Critère : alerte si écart > 1 %.
3. **Supplier performance scoring** : visualiser les bons/mauvais fournisseurs (lateness, qualité, écarts). Critère : KPI score 0-100 par supplier visible sur fiche.
4. **AP aging propre** : voir d'un coup d'œil ce qui est dû à 0-30 / 31-60 / 61-90 / 90+ jours. Critère : report AP aging affiché sur dashboard finances.

---

## Tâches

### TASK-07-001 — Fix purchase trigger (utiliser `resolve_mapping_account`) [P1] [TODO]
**Contexte** : `create_purchase_journal_entry()` utilise des codes hardcodés (`1300`, `1110`, `1400`, `2100`, `5100`) qui n'existent plus dans le COA actuel. Trigger casse ou route vers mauvais comptes. Source : `docs/audit/02-accounting-business-audit.md§P1-2`.
**Critère d'acceptation** :
- [ ] Migration : réécrire `create_purchase_journal_entry()` avec `resolve_mapping_account('INVENTORY_GENERAL')`, `resolve_mapping_account('PURCHASE_VAT_INPUT')`, `resolve_mapping_account('PURCHASE_PAYABLE')`.
- [ ] Idempotence préservée (check existing JE).
- [ ] Fiscal period guard préservé.
- [ ] Tests : PO received → JE balanced sur les bons comptes.
- [ ] Migration de comptes seedés si manquants (ex : `5101` postable child de 5100 si COGS direct attendu).
**Fichiers concernés** : nouvelle migration `YYYYMMDD_fix_purchase_trigger_unified.sql`.
**Dépend de** : aucune (les sale triggers sont déjà corrigés)
**Estimation** : `M`
**Risques** : Régression sur PO existants. Tester avec un PO de test sur staging.

### TASK-07-002 — PO state machine UI clarification [P2] [TODO]
**Contexte** : `purchase_orders` a un `status` enum (`PoStatus`) mais l'UI ne montre pas clairement les transitions possibles. Manager peut tenter une action invalide → erreur cryptique. Inferred from code review (hook `usePurchaseOrders` 583L).
**Critère d'acceptation** :
- [ ] Diagramme état dans `docs/v2-reference/04-modules/07-purchasing-suppliers.md`.
- [ ] UI fiche PO : badge status + boutons d'action correspondants (Send / Cancel / Receive / Close).
- [ ] Boutons invalides cachés ou disabled avec tooltip « Not allowed in current state ».
- [ ] DB CHECK constraint : transitions valides seulement (ou trigger `BEFORE UPDATE`).
- [ ] Audit log de chaque transition.
**Fichiers concernés** : `src/pages/purchasing/PurchaseOrderDetailPage.tsx`, `src/hooks/purchasing/usePurchaseOrders.ts`, nouvelle migration trigger.
**Dépend de** : aucune
**Estimation** : `M`
**Risques** : Empêcher une transition utilisée (ex : reopen closed PO). Audit existing usages avant constraint.

### TASK-07-003 — QC workflow integration (réception) [P2] [TODO]
**Contexte** : À la réception PO, le receveur compare la livraison avec le bon de commande. Si écarts (qty, qualité), il doit pouvoir les enregistrer. Inferred from operational reality.
**Critère d'acceptation** :
- [ ] UI réception : ligne par ligne, qty ordered / qty received editable.
- [ ] Si reçu < ordered : option « Backorder » (rester partial received) ou « Close as is ».
- [ ] Si qualité défaut : action « Quality reject » qui crée une PO return ligne.
- [ ] Photos optionnelles (Capacitor camera).
- [ ] JE adapté : DR Inventory à la qty réellement reçue, pas ordered.
- [ ] Tests : PO 100 → reçu 90 → backorder de 10 ; qty 100 → 5 reject → return PO 5.
**Fichiers concernés** : `src/pages/purchasing/POReceivePage.tsx`, `src/hooks/purchasing/usePOReception.ts`, `src/services/accounting/accountingEngine.ts` (postPurchaseJE accepte qty actual).
**Dépend de** : `TASK-07-001`
**Estimation** : `L`
**Risques** : Complexité comptable (timing JE, partial receive). Valider avec comptable.

### TASK-07-004 — Supplier performance scoring [P3] [TODO]
**Contexte** : Pas de KPI fournisseur actuellement. Manager achats ne sait pas qui livre en retard ou avec écarts. Inferred from product backlog.
**Critère d'acceptation** :
- [ ] Calcul (vue ou RPC) score par supplier : (a) on-time delivery rate, (b) qty accuracy, (c) price stability, (d) défauts qualité — pondéré.
- [ ] Score 0-100 affiché sur fiche supplier + liste suppliers.
- [ ] Drill-down : top 5 PO récents avec issues.
- [ ] Filtres date range.
- [ ] Report dédié dans Reports module.
**Fichiers concernés** : nouvelle vue SQL `view_supplier_performance`, `src/pages/purchasing/SupplierDetailPage.tsx`, `src/pages/reports/components/SupplierPerformanceTab.tsx` (à créer).
**Dépend de** : `TASK-07-003` (QC data nécessaire)
**Estimation** : `M`
**Risques** : Score peut être injuste si peu de data. Min 5 PO pour score affiché.

### TASK-07-005 — AP aging report [P2] [TODO]
**Contexte** : Cash flow et AP aging sont mentionnés comme manquants. AR aging existe (`useARManagement`), AP aging non. Source : `docs/audit/02-accounting-business-audit.md§Phase 5/Phase 6` + product backlog F7.
**Critère d'acceptation** :
- [ ] RPC `get_ap_aging(end_date)` retournant : supplier, total_due, buckets (0-30, 31-60, 61-90, 90+).
- [ ] Page report `/reports/ap-aging`.
- [ ] Export CSV/PDF.
- [ ] KPI dashboard finances : « X IDR overdue > 60 days ».
- [ ] Tests : PO non payé > 60 jours apparaît dans bucket 61-90.
**Fichiers concernés** : nouvelle migration RPC, `src/hooks/accounting/useAPManagement.ts` (à créer), `src/pages/reports/components/APAgingTab.tsx` (à créer).
**Dépend de** : `TASK-07-001` (purchase trigger correct → AP fiable)
**Estimation** : `M`
**Risques** : Définition AP « due date » : depuis PO date + payment_terms du supplier. Vérifier cohérence schema.

### TASK-07-006 — 3-way match (PO / Receipt / Invoice) [P3] [TODO]
**Contexte** : Workflow procurement classique. Actuellement réception et paiement existent, mais pas de match avec invoice supplier (qui peut différer du PO). Inferred from procurement best practices.
**Critère d'acceptation** :
- [ ] Schema : table `supplier_invoices` (supplier_id, po_id, invoice_number, invoice_date, total, due_date, status, attachment_url).
- [ ] UI upload invoice fournisseur (PDF) lié à un PO received.
- [ ] Match auto : si PO total = receipt total = invoice total → flag `matched`.
- [ ] Si discrepancy > seuil (configurable, default 1%) → alert « Manual review needed ».
- [ ] Payment ne peut être enregistré que sur invoice matched (ou override avec permission).
**Fichiers concernés** : nouvelle migration `supplier_invoices`, nouveau hook `useSupplierInvoices.ts`, `src/pages/purchasing/SupplierInvoicesPage.tsx`.
**Dépend de** : `TASK-07-003`
**Estimation** : `XL`
**Risques** : Procurement enterprise-feature qui peut être overkill pour bakery 200 tx/jour. Valider besoin avant.

### TASK-07-007 — Supplier portal (P3) [P3] [TODO]
**Contexte** : Permettre aux suppliers de voir leurs PO online sans appeler. Future-proofing. Inferred from product backlog (nice-to-have).
**Critère d'acceptation** :
- [ ] Auth supplier dédiée (token signed URL, pas user account).
- [ ] Vue read-only : liste PO en cours + status + dates.
- [ ] Notification email à création PO avec lien portal.
- [ ] Logs accès portal (audit).
- [ ] Pas de modification supplier-side (read only).
**Fichiers concernés** : nouvelle Edge Function `supplier-portal-token`, page `src/pages/public/SupplierPortalPage.tsx`, route publique.
**Dépend de** : `TASK-07-002`
**Estimation** : `XL`
**Risques** : Surface d'attaque public. Token expiry court (7j), URL signed, RLS strict.

### TASK-07-008 — Fix `select('*')` dans `purchase_order_module` Edge Function [P2] [TODO]
**Contexte** : `purchase_order_module` Edge Function utilise `select('*')` sur suppliers et purchase_orders (lignes 68, 92-96). Convention violée + perf. Source : `docs/audit/08-operations-lan-audit.md§P3-7`.
**Critère d'acceptation** :
- [ ] Remplacer par selects ciblés.
- [ ] Tests Edge Function : pas de régression.
- [ ] `npm run lint` clean.
- [ ] `/security-review` ne flag plus.
**Fichiers concernés** : `supabase/functions/purchase_order_module/index.ts`.
**Dépend de** : aucune
**Estimation** : `S`
**Risques** : Oublier une colonne consommée par le client. Tester usage E2E.

---

## Notes transverses

- **Comptabilité** : PO received → JE auto via trigger (cf. TASK-07-001). PO payment → JE via `postPurchasePaymentJournalEntry`. Toujours passer par `accountingEngine`.
- **Décomposition** : `usePurchaseOrders.ts` 583L et `poImportExportService.ts` 672L sont au-dessus de la limite 300L → tâches dette technique séparées (cf. T4 backlog général).
- **Permissions** : `inventory.create`/`update`/`delete` couvrent PO. Pas de granularité dédiée purchasing.
- **`po_activity_log` phantom** : 1 ref dans `usePOActivityLog.ts`, table absente. Voir TASK-07-XXX (à ouvrir si besoin réel).
