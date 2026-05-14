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
- [ ] Diagramme état dans `docs/reference/04-modules/07-purchasing-suppliers.md`.
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

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/objectif travail/PURCHASING_AND_SUPPLIERS.md` §7 (limites assumées V2) — vision produit du module pour V3.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13, version révisée de l'objectif).

### TASK-07-009 — Envoi automatique d'email PO au fournisseur [P3] [TODO]
**Contexte** : aujourd'hui le bouton "Send" change juste le statut. L'envoi réel se fait hors-outil (WhatsApp, email manuel). Source d'oubli + pas de trace.
**Bénéfice attendu** : à l'action "Send", envoi automatique d'un email au fournisseur avec PDF du PO + texte personnalisable.
**Critère d'acceptation** :
- [ ] Settings → Purchasing → "Email automatique PO" (toggle + template).
- [ ] Champ `supplier.email_primary` + `supplier.email_cc[]`.
- [ ] Edge Function `send-purchase-order-email` qui envoie via Resend / SES.
- [ ] Audit : email envoyé tracé dans `purchase_order_activity_log` avec timestamp + destinataires.
- [ ] Cas erreur : si email rejeté (bounce), alerter le créateur du PO.
**Dépend de** : `TASK-07-010` (PDF) — nécessaire pour la pièce jointe.
**Estimation** : M
**Risques** : adresses fournisseurs obsolètes → tester avant rollout.
**Notes** : intégration WhatsApp Business API en V2 (les fournisseurs locaux préfèrent souvent WA).

### TASK-07-010 — Génération PDF du PO [P3] [TODO]
**Contexte** : aucun PDF officiel du bon de commande aujourd'hui. Le fournisseur reçoit la commande en texte WhatsApp ou téléphone — pas de trace formelle.
**Bénéfice attendu** : générer un PDF propre du PO (mentions légales The Breakery, NPWP, conditions, lignes, total) à imprimer ou envoyer.
**Critère d'acceptation** :
- [ ] Edge Function `generate-purchase-order-pdf` qui produit un PDF aligné sur le design facture B2B.
- [ ] Bouton "Download PDF" sur `PurchaseOrderDetail`.
- [ ] Stockage Supabase `purchase-orders/PO-YYYYMM-XXXX.pdf` (signed URL).
- [ ] Re-génération possible si PO modifié avant envoi.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : timeout Edge Function si bcp d'items — paginer le PDF si > 30 lignes.
**Notes** : socle pour TASK-07-009 (envoi email).

### TASK-07-011 — Multi-devise sur PO [P3] [TODO]
**Contexte** : tout en IDR aujourd'hui. Pour un fournisseur étranger (équipement français, conseil tech US), conversion manuelle dans les notes.
**Bénéfice attendu** : saisir un PO en EUR / USD avec conversion auto vers IDR pour la compta.
**Critère d'acceptation** :
- [ ] Colonnes `currency_code`, `exchange_rate`, `amount_local` sur `purchase_orders`.
- [ ] UI form : "Devise" selector + récupération auto du taux du jour (BI).
- [ ] Écriture compta libellée en IDR au taux du jour réception.
- [ ] Écart de change post-paiement si taux différent (JE auto compensatoire).
**Dépend de** : `TASK-10-019` (multi-devise Accounting global).
**Estimation** : M
**Risques** : taux divergents → référence officielle Bank Indonesia.
**Notes** : extension du module Accounting multi-devise.

### TASK-07-012 — Landed cost (répartition frais de port pro-rata) [P3] [TODO]
**Contexte** : aujourd'hui les frais de port (`shipping_cost`) gonflent le total PO mais ne sont pas répartis sur le coût de revient produit. Marges sous-évaluées.
**Bénéfice attendu** : répartition automatique des frais de port (et autres frais : douane, assurance) au pro-rata du montant ou du poids des lignes — coût de revient juste.
**Critère d'acceptation** :
- [ ] Champ `purchase_orders.allocation_method` : `by_value` | `by_weight` | `by_quantity`.
- [ ] À la réception, recalcul automatique du `landed_unit_cost` pour chaque ligne = `base_price + (shipping × allocation_share)`.
- [ ] Update du `cost_price` du produit avec le `landed_unit_cost` (pas le base_price).
- [ ] Toggle "Inclure frais douane / assurance" si applicable.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : conflit avec coûts historiques — option "appliquer rétroactivement" désactivable.
**Notes** : critique pour fournisseurs internationaux à frais élevés.

### TASK-07-013 — Avoir comptable automatique sur retour post-paiement [P3] [TODO]
**Contexte** : aujourd'hui un retour fournisseur génère une écriture qui réduit la dette, mais si le PO est déjà intégralement payé, le retour reste à régler manuellement avec le fournisseur (avoir, crédit prochaine facture).
**Bénéfice attendu** : générer automatiquement un avoir comptable (credit note) tracé, réutilisable sur le prochain PO du même fournisseur.
**Critère d'acceptation** :
- [ ] Table `supplier_credit_notes` (supplier_id, source_return_id, amount, used_on_po_id, status).
- [ ] À chaque retour sur PO payé → crédit note auto créé en `available`.
- [ ] Au prochain PO du même fournisseur : proposition "Utiliser X IDR de crédit" cochable.
- [ ] Imputation JE : DR Supplier Credit / CR AP au moment de la création du PO suivant.
- [ ] Page `/purchasing/credits` : liste des avoirs en stock + drill-down.
**Dépend de** : `TASK-07-001` (purchase trigger refactor).
**Estimation** : M
**Risques** : différence avoir comptable vs avoir commercial — bien aligner avec le comptable.
**Notes** : pattern symétrique à TASK-09-014 (credit notes B2B côté client).

### TASK-07-014 — Workflow d'approbation multi-niveaux PO [P3] [TODO]
**Contexte** : un seul utilisateur crée et envoie. Pour un site de 20+ utilisateurs, il faudrait une chaîne d'approbation (PO > 5M → manager, PO > 20M → owner).
**Bénéfice attendu** : workflow d'approbation paramétrable par seuils + chaîne de validateurs.
**Critère d'acceptation** :
- [ ] Table `po_approval_rules` (threshold_min, threshold_max, requires_role, requires_pin).
- [ ] Settings → Purchasing → "Approval rules" : CRUD + simulation.
- [ ] État `pending_approval` ajouté à `purchase_orders.status` (entre `draft` et `sent`).
- [ ] Modal approbation : approver agit → `approved`, puis bouton "Send" actif.
- [ ] Audit complet : qui a approuvé, quand, sur quel critère.
**Dépend de** : aucune.
**Estimation** : L
**Risques** : friction si chaîne trop longue — limiter V1 à 2 niveaux max.
**Notes** : pattern symétrique à TASK-09-009 (B2B approval workflow).

---

## Notes transverses

- **Comptabilité** : PO received → JE auto via trigger (cf. TASK-07-001). PO payment → JE via `postPurchasePaymentJournalEntry`. Toujours passer par `accountingEngine`.
- **Décomposition** : `usePurchaseOrders.ts` 583L et `poImportExportService.ts` 672L sont au-dessus de la limite 300L → tâches dette technique séparées (cf. T4 backlog général).
- **Permissions** : `inventory.create`/`update`/`delete` couvrent PO. Pas de granularité dédiée purchasing.
- **`po_activity_log` phantom** : 1 ref dans `usePOActivityLog.ts`, table absente. Voir TASK-07-XXX (à ouvrir si besoin réel).
