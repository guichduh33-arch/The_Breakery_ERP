# Travail — B2B / Wholesale

> Last updated: 2026-05-03
> Référence : [docs/reference/04-modules/09-b2b-wholesale.md](../04-modules/09-b2b-wholesale.md)
> Sources d'audit : `docs/audit/07-product-backlog-audit.md` (module 88%, gaps B2B), `docs/audit/02-accounting-business-audit.md` (couverture JE B2B), `docs/audit/05-uiux-design-audit.md` (PaymentModal)

## Objectifs du module

1. Restituer une **AR aging fiable et exportable** (PDF + email mensuel) pour piloter le recouvrement des créances B2B (≤ 90j vs > 90j) et réduire le DSO.
2. Empêcher l'**over-credit** des clients B2B en bloquant la création de commandes au-dessus du `credit_limit`, avec validation manager hors-ligne traçable.
3. Préparer la **génération multilingue d'invoices** (anglais aujourd'hui, indonésien à venir) via paramétrage centralisé du template, sans casser les invoices déjà générés.
4. Outiller la **génération en lot** (bulk invoicing) pour absorber les pics de fin de mois (~30 invoices simultanés sans timeout Edge Function).
5. Tracer l'**historique des prix négociés** par client (b2b_price_lists versionné) afin que toute modification soit auditable et que les commandes anciennes restent figées.

## Tâches

### TASK-09-001 — AR aging report PDF + planification email mensuelle [P1] [TODO]
**Contexte** : `view_ar_aging` existe et `B2BAgingSummary` l'affiche en UI, mais aucune PDF/CSV propre, ni envoi mensuel auto. Audit `07-product-backlog-audit.md` Gap 6 ("Cash flow statement") et Sally `05-uiux-design-audit.md` mentionnent l'absence d'export PDF cohérent. Le contrôle de gestion réclame un PDF mensuel envoyé en début de mois.
**Critère d'acceptation** :
- [ ] Bouton "Export PDF" dans `B2BPaymentsAgingTab` produit un PDF avec en-tête + colonnes buckets + total par client.
- [ ] CSV export aligné sur le PDF (mêmes lignes, mêmes totaux).
- [ ] Edge Function `b2b-aging-monthly` planifiée (CRON Supabase) génère le PDF le 1er du mois et l'envoie via `send-test-email` (réutilisable) à `b2b_config.aging_recipients` (array email).
- [ ] Idempotence : si le job tourne deux fois le même jour, un seul email envoyé (table `aging_email_log`).
**Fichiers concernés** : `src/services/b2b/arService.ts`, `src/pages/b2b/B2BAgingSummary.tsx`, `src/pages/b2b/B2BPaymentsAgingTab.tsx`, nouvelle Edge Function `supabase/functions/b2b-aging-monthly/index.ts`, nouvelle migration `supabase/migrations/YYYYMMDD_b2b_aging_email_log.sql`.
**Dépend de** : aucune
**Estimation** : L
**Risques** : signed URLs PDF expirent 1h (cf. pitfall module 09) → stocker dans Storage `aging-reports/` avec re-signature au moment du clic dans l'email.
**Notes** : `send-test-email` existe déjà côté Edge Functions (cf. CLAUDE.md liste 16 EF) — l'utiliser plutôt qu'en créer une nouvelle dédiée mail.

### TASK-09-002 — Credit limit enforcement + override manager [P1] [TODO]
**Contexte** : `customers.credit_limit` + `credit_status='suspended'` existent côté schéma (cf. module 08 + pitfall 09) mais le hook `useB2BOrderForm` ne bloque PAS la création quand `credit_balance + new_order_total > credit_limit`. Audit `07-product-backlog-audit.md` flag "B2B credit module needs hardening".
**Critère d'acceptation** :
- [ ] `useB2BOrderForm.validateCreditLimit()` calcule `projected_balance = current + total - prepayment` et bloque submit si > `credit_limit` (sauf override).
- [ ] Modal "Credit limit exceeded — Manager PIN" déclenche `useShiftAuth` PIN flow ; `manager_id` + `override_reason` persistés sur la nouvelle ligne `b2b_orders.credit_override` (nouvelle colonne JSONB).
- [ ] Si `credit_status='suspended'` → bloquant total (pas d'override possible) avec message clair.
- [ ] Audit log `b2b_order_history` reçoit une ligne `type='credit_override'`.
**Fichiers concernés** : `src/hooks/b2b/useB2BOrderForm.ts`, `src/pages/b2b/B2BOrderFormPage.tsx`, `src/services/b2b/creditService.ts`, migration `supabase/migrations/YYYYMMDD_b2b_credit_override.sql`.
**Dépend de** : aucune
**Estimation** : M
**Risques** : race condition si deux commandes simultanées du même client passent juste sous la limite (cf. pitfall FIFO race) — utiliser un `SELECT … FOR UPDATE` dans une RPC `validate_b2b_credit(p_customer_id, p_amount)`.
**Notes** : reuse pattern PIN du module 12 (cash variance > 50k IDR validation).

### TASK-09-003 — Bulk invoice generation (≥ 30 invoices en une commande) [P2] [TODO]
**Contexte** : `generate-invoice` Edge Function génère 1 invoice à la fois (audit module 09 Edge Functions). En fin de mois, comptable doit cliquer 30 fois. Pas de bulk action.
**Critère d'acceptation** :
- [ ] Page `/b2b/invoices/bulk` : liste filtrée des `b2b_orders` non-invoiced + multi-select.
- [ ] Bouton "Generate N invoices" appelle nouvelle Edge Function `b2b-bulk-invoice` qui itère côté serveur (pas N appels client).
- [ ] Progress UI temps-réel via Supabase Realtime broadcast (channel `b2b-bulk-invoice:{job_id}`).
- [ ] ZIP final téléchargeable + chaque invoice persisté dans `b2b_orders.invoice_url`.
- [ ] Timeout Edge Function ≤ 60s : si > 30 invoices, batcher en chunks de 20 avec checkpoint `bulk_invoice_jobs(job_id, processed_count, status)`.
**Fichiers concernés** : nouvelle page `src/pages/b2b/B2BBulkInvoicePage.tsx`, Edge Function `supabase/functions/b2b-bulk-invoice/index.ts`, migration `bulk_invoice_jobs`.
**Dépend de** : `generate-invoice` (refactor pour exposer une fonction interne `generateInvoicePDF(order)` réutilisable).
**Estimation** : L
**Risques** : Storage quota Supabase si beaucoup de PDF générés ; jsPDF en Edge Function = consommation mémoire — surveiller.
**Notes** : référence `claude-proxy` pour pattern long-running Edge Functions (CLAUDE.md liste).

### TASK-09-004 — Invoice template multi-langue (EN par défaut + ID future) [P2] [TODO]
**Contexte** : CLAUDE.md indique "i18n suspended, English only" mais le module B2B vend à des hôtels indonésiens. Audit produit (07) note "I1 Faktur Pajak" arrivera → besoin invoice ID. Préparer le template SANS activer i18next.
**Critère d'acceptation** :
- [ ] `invoice_template_config` table (JSONB par lang_code : `en`, `id`) avec sections `header`, `footer`, `terms`, `tax_label`.
- [ ] `customers.invoice_language` (TEXT default 'en' check ('en','id')).
- [ ] `generate-invoice` lit la lang du customer et applique le template correspondant.
- [ ] UI Settings `/settings/b2b/invoice-templates` : éditeur Markdown des 4 sections par langue, preview live.
- [ ] Si lang='id' : labels DR/CR, "Total", "Pajak", "Jatuh Tempo" indonésien — provenance template, pas hardcoded.
**Fichiers concernés** : `supabase/functions/generate-invoice/index.ts`, nouvelle table + RLS, page settings, hook `useInvoiceTemplate`.
**Dépend de** : aucune
**Estimation** : L
**Risques** : casser les invoices existants — versionner le template (`template_version` colonne sur `b2b_orders`) pour figer.
**Notes** : ne PAS importer i18next ; juste un système de strings paramétrables. Faktur Pajak (I1 backlog) plus tard utilisera ce socle.

### TASK-09-005 — Historique des prix négociés (b2b_price_lists versioning) [P2] [TODO]
**Contexte** : `b2b_price_lists` + `b2b_price_list_items` existent (cf. module 09 tables) mais sans versioning. Modifier un prix change rétroactivement le tarif appliqué aux nouvelles commandes — pas d'audit trail. Sales rep ne peut pas dire "quel était le prix il y a 3 mois ?".
**Critère d'acceptation** :
- [ ] Trigger `audit_b2b_price_list_items_changes` insère un snapshot dans `b2b_price_list_items_history` (id, price_list_id, product_id, old_price, new_price, changed_at, changed_by) à tout UPDATE/DELETE.
- [ ] Composant `B2BPriceHistoryDrawer` affiche timeline par produit dans `B2BClientDetailPage`.
- [ ] RPC `get_b2b_price_at_date(price_list_id, product_id, p_date)` retourne le prix qui était en vigueur à `p_date`.
- [ ] Les commandes existantes restent figées (`b2b_order_items.unit_price` est déjà figé au moment de la création — confirmer dans les tests).
**Fichiers concernés** : migration history table + trigger, `src/services/b2b/priceListService.ts` (à créer), composant drawer, hook `useB2BPriceHistory`.
**Dépend de** : aucune
**Estimation** : M
**Risques** : explosion volumique de l'history si édité en boucle — purge automatique > 2 ans (rétention configurable).
**Notes** : reuse pattern audit_logs existant pour la structure.

### TASK-09-006 — B2B dashboard KPI overview [P2] [TODO]
**Contexte** : Audit `ux-gap-analysis-2026-05-01.md` (B2B Wholesale section) signale **"V2 B2B dashboard KPI overview MANQUANT"** vs V3 epic-043/044/045. V2 a `B2BStats.tsx` (KPI cards) mais incomplet : pas d'overdue split, pas de top clients chart, pas de DSO.
**Critère d'acceptation** :
- [ ] `B2BStats` ajoute KPI cards : DSO (days sales outstanding), Outstanding < 30j vs > 30j, Top 5 clients par CA 30j, Conversion rate (orders confirmed / drafts).
- [ ] Mini-charts Recharts (sparklines) sur 30j pour CA + outstanding.
- [ ] Filtre période (7j/30j/90j) avec `useDateRange` cohérent avec module Reports.
- [ ] Empty state si pas de B2B orders sur la période.
**Fichiers concernés** : `src/pages/b2b/B2BStats.tsx`, `src/pages/b2b/B2BPage.tsx`, vue SQL `view_b2b_dso` (à créer si besoin).
**Dépend de** : aucune
**Estimation** : M
**Risques** : KPI calc côté client lent sur gros volumes — privilégier RPCs.
**Notes** : `view_b2b_performance` existe déjà (cf. module 09) — réutiliser.

### TASK-09-007 — B2B self-service portal (clients) [P3] [TODO]
**Contexte** : Backlog produit (audit 07) note "Customer notifications via WhatsApp" mais aussi besoin futur d'un portail client B2B (consulter solde, télécharger invoices, voir historique). Pas urgent mais pose des fondations.
**Critère d'acceptation** :
- [ ] Auth séparée pour clients B2B (table `b2b_customer_users` liée à `customers`, magic link Supabase).
- [ ] Page publique `/b2b-portal/login` + `/b2b-portal/dashboard` lisant uniquement les commandes du `customer_id` lié.
- [ ] Téléchargement invoices PDF + relevé de compte trimestriel.
- [ ] RLS strict : un client B2B ne peut JAMAIS voir les données d'un autre client.
**Fichiers concernés** : nouvelle structure `src/pages/b2b-portal/`, route publique, RLS policies dédiées.
**Dépend de** : `TASK-09-001` (aging report), `TASK-09-004` (templates invoices propres).
**Estimation** : XL — décomposer avant prise.
**Risques** : surface d'attaque publique → audit `/security-review` obligatoire avant déploiement.
**Notes** : à confirmer avec le métier si le besoin existe vraiment (Lombok, ~20 hôtels clients seulement). Peut rester P3 longtemps.

### TASK-09-008 — Statement of account automatique (mensuel) [P2] [TODO]
**Contexte** : Différent de l'aging (TASK-09-001) — un *statement* listant TOUTES les transactions du mois (commandes, paiements, ajustements) par client. Demande comptable récurrente. Aujourd'hui : extraction manuelle Excel.
**Critère d'acceptation** :
- [ ] RPC `get_customer_statement(customer_id, start_date, end_date)` retourne timeline (orders, payments, refunds, credit notes) avec running balance.
- [ ] Composant `B2BStatementModal` (déclenché depuis `B2BClientDetailPage`) affiche le statement + bouton PDF.
- [ ] Email mensuel paramétrable par client (`customers.send_monthly_statement` BOOLEAN, `customers.statement_email`).
- [ ] Edge Function `b2b-statement-monthly` (similaire à TASK-09-001) génère + envoie le 1er du mois.
**Fichiers concernés** : RPC SQL, modal, Edge Function, settings page client.
**Dépend de** : `TASK-09-001` pour réutiliser le pattern email + log.
**Estimation** : M
**Risques** : running balance peut diverger si une transaction historique est modifiée → snapshot le statement (table `b2b_statements_archive`).
**Notes** : combiner UI : un seul switch client "Reçoit aging + statement" pour simplifier l'admin.

---

## Backlog métier (objectif fonctionnel)

> Items issus de `docs/objectif travail/B2B.md` §16 — vision produit du module au-delà du tech-debt existant.
> Ajoutés 2026-05-13 lors de la cascade docs (session 13). Le portal client B2B est déjà couvert par TASK-09-007.

### TASK-09-009 — Auto-approval workflow [P2] [TODO]
**Contexte** : aujourd'hui les seuils d'approbation (montant > X, hors plafond crédit) sont contrôlés en code (hardcode). Pas de configuration métier, pas de visualisation, pas d'historique des approbations.
**Bénéfice attendu** : workflow visuel où le gérant définit les seuils, et chaque commande passe par les étapes d'approbation appropriées.
**Critère d'acceptation** :
- [ ] Table `b2b_approval_rules` (trigger, threshold_amount, requires_role, requires_pin).
- [ ] Page `/settings/b2b/approval-rules` : CRUD règles + simulation "cette commande déclencherait quoi ?".
- [ ] Workflow : commande `draft` → si trigger → état `awaiting_approval` → approver agit → `confirmed` ou `rejected`.
- [ ] Trace audit complète : qui a approuvé, quand, sur quel critère.
**Dépend de** : `TASK-09-010` (couplage anti-self-approval).
**Estimation** : L
**Risques** : règles incompréhensibles si trop souples — V1 limiter aux 3 triggers principaux (montant, plafond crédit, marge négative).
**Notes** : aujourd'hui implicite dans `B2BOrderForm` validation — refactor nécessaire.

### TASK-09-010 — Détection self-approval (anti-fraude) [P2] [TODO]
**Contexte** : un commercial peut créer ET approuver sa propre commande (signal de fraude classique). Le report `b2b_self_approval_risk` existe mais c'est curatif, pas préventif.
**Bénéfice attendu** : empêcher la création + approbation par le même utilisateur, avec exception manager (PIN forçant explicitement le scénario).
**Critère d'acceptation** :
- [ ] Contrainte logique : `b2b_orders.created_by != b2b_orders.approved_by` (RLS + service).
- [ ] Si même utilisateur tente : modal "Self-approval bloqué — demander à un manager" avec champ PIN manager.
- [ ] Audit log de chaque override PIN.
- [ ] Report `b2b_self_approval_risk` ne montre que les overrides (les bloqués n'arrivent jamais en BD).
**Dépend de** : `TASK-09-009` (workflow approval doit exister pour qu'on puisse en bloquer un acteur).
**Estimation** : M
**Risques** : équipe trop petite — un seul commercial peut TOUT bloquer en cas d'absence manager → procédure de délégation.
**Notes** : pattern inspiré des contrôles SAP / Oracle séparation des tâches.

### TASK-09-011 — Commandes récurrentes / abonnements [P3] [TODO]
**Contexte** : un hôtel commande 200 baguettes chaque lundi. Aujourd'hui, le commercial doit ressaisir ou cloner manuellement chaque semaine. Risque d'oubli.
**Bénéfice attendu** : définir une commande type qui se duplique automatiquement selon une cadence définie.
**Critère d'acceptation** :
- [ ] Table `b2b_recurring_orders` (template_order_id, frequency, day_of_week, next_due_date, active).
- [ ] Job quotidien (cron Edge Function) qui détecte les dues du jour et crée les commandes en `draft`.
- [ ] Page `/b2b/recurring` : CRUD + activation / pause / historique.
- [ ] Notification au commercial à la création auto pour valider avant `confirmed`.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : changement de prix entre deux récurrences → V1 prend le prix client actuel, pas le prix figé.
**Notes** : viser pattern Shopify "Subscriptions" V1 simple.

### TASK-09-012 — Relances automatiques [P3] [TODO]
**Contexte** : la page Outstanding montre les retards mais l'envoi de relance reste manuel. Le gérant oublie ; le client paie tard.
**Bénéfice attendu** : envoi automatique d'un rappel à J-3 de l'échéance, J+0, J+7, J+15 — paramétrable par client ou globalement.
**Critère d'acceptation** :
- [ ] Table `b2b_reminder_rules` (trigger_offset_days, template_id, channel email/whatsapp, active).
- [ ] Job quotidien qui scanne les factures dues et envoie les relances dues.
- [ ] Templates email / SMS / WhatsApp avec personnalisation client + montant + lien paiement.
- [ ] Désactivation au cas par cas (client en négociation, pas de relance).
- [ ] Audit : chaque relance envoyée est tracée (table `b2b_reminders_sent`).
**Dépend de** : intégration WhatsApp Business API (hors scope V1, fallback email seulement).
**Estimation** : L
**Risques** : spam / dégradation relation client → cap max 4 relances par facture, désactivation auto si paiement reçu.
**Notes** : V1 email seul ; V2 WhatsApp.

### TASK-09-013 — Devis (quote) avant commande [P3] [TODO]
**Contexte** : aujourd'hui la commande passe directement de `draft` à `confirmed`. Pas d'étape devis officiel envoyé au client pour acceptation.
**Bénéfice attendu** : étape `quote` en amont de `draft` — envoyer un PDF de devis numéroté, le client confirme par retour (mail / portail).
**Critère d'acceptation** :
- [ ] Statut `quote` ajouté à `b2b_orders.status` enum (entre `draft` et `confirmed`).
- [ ] Numérotation séquentielle propre pour les devis (préfixe `QUO-`).
- [ ] Génération PDF "Devis" via Edge Function `generate-quote-pdf` (template distinct de la facture).
- [ ] Action "Convert quote to confirmed order" (mémo source `quote_id` sur la commande).
- [ ] Page `/b2b/quotes` similaire à liste des commandes mais filtrée.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : explosion du nombre de statuts → bien documenter la state machine.
**Notes** : statut `quote` peut expirer après N jours → action manuelle "Refresh quote".

### TASK-09-014 — Avoirs / credit notes [P3] [TODO]
**Contexte** : si un client retourne 10 baguettes invendables ou si la livraison comportait une casse, aujourd'hui aucun document officiel pour matérialiser l'avoir. Le commercial bricole un paiement négatif.
**Bénéfice attendu** : générer une note de crédit officielle pour un retour ou une remise client après facture.
**Critère d'acceptation** :
- [ ] Table `b2b_credit_notes` (number, customer_id, original_order_id, lines, total, reason).
- [ ] Numérotation séquentielle propre (préfixe `CN-`).
- [ ] PDF "Note de crédit" via Edge Function dédiée.
- [ ] Imputation : l'avoir réduit le `amount_due` de la commande d'origine OU se reporte sur la prochaine commande.
- [ ] Écriture compta automatique : DR Revenue / CR AR (contre-passation partielle).
**Dépend de** : `TASK-10-001` (sale trigger fiable) pour la contre-passation.
**Estimation** : M
**Risques** : différence entre avoir commercial et avoir comptable — bien aligner avec le comptable externe.
**Notes** : V1 manuel (commercial crée l'avoir) ; V2 auto sur retour livraison.

### TASK-09-015 — Multi-livraisons planifiées d'avance [P3] [TODO]
**Contexte** : aujourd'hui les livraisons partielles sont enregistrées au fil de l'eau. Pour un événement (500 baguettes en 5 livraisons sur la semaine), aucun moyen de planifier d'avance.
**Bénéfice attendu** : planifier les livraisons dès la confirmation de commande avec dates / quantités prévues, et tracker le réel vs prévu.
**Critère d'acceptation** :
- [ ] Table `b2b_planned_deliveries` (order_id, planned_date, planned_items, status).
- [ ] UI dans `BO`order detail → onglet Deliveries : sous-section "Plan" éditable.
- [ ] À l'enregistrement d'une livraison réelle, on peut "fulfill a planned delivery" pour matcher.
- [ ] Alerte si une livraison planifiée est dépassée sans réalisation.
**Dépend de** : aucune.
**Estimation** : M
**Risques** : complexité UX — ne pas surcharger l'écran si commande "single shot".
**Notes** : V1 cas spécifique événements ; étendre si retour terrain positif.

### TASK-09-016 — Tarification par volume [P3] [TODO]
**Contexte** : un client commande baguettes <50 = prix A, ≥50 = prix B. Aujourd'hui le commercial doit le savoir et modifier manuellement.
**Bénéfice attendu** : prix dégressif automatique selon quantité commandée — défini sur la fiche produit ou la liste de prix dédiée.
**Critère d'acceptation** :
- [ ] Table `b2b_volume_pricing_tiers` (price_list_id ou product_id, qty_min, qty_max, unit_price).
- [ ] Algorithme de pricing : lors de la saisie d'une ligne, le système choisit automatiquement le tier matchant.
- [ ] UI configuration : sur la fiche produit OU sur la liste de prix dédiée, table tiers éditable.
- [ ] Affichage transparent à la saisie : "200 unités × 4500 IDR (tier ≥100)".
**Dépend de** : aucune.
**Estimation** : M
**Risques** : ambiguïté avec les remises ad-hoc — choisir l'un OU l'autre (pas cumul).
**Notes** : préférer tier sur liste de prix dédiée (plus de contrôle commercial).

### TASK-09-017 — Intégration comptable export (Accurate / MYOB) [P3] [TODO]
**Contexte** : export direct des factures B2B dans le format attendu par le comptable externe (Accurate, MYOB). Aujourd'hui CSV générique uniquement.
**Bénéfice attendu** : le comptable externe importe les factures B2B sans ressaisie.
**Critère d'acceptation** :
- [ ] Service `b2bAccountingExportService.exportInvoicesToAccurate(p_start, p_end)`.
- [ ] Idem MYOB.
- [ ] Page `/b2b/export` : sélection période + format + download.
- [ ] Test : import du fichier dans sandbox Accurate sans erreur.
**Dépend de** : `TASK-10-018` (export Accounting général — partager le framework export).
**Estimation** : M
**Risques** : formats propriétaires versionnés.
**Notes** : extension naturelle du module Accounting export.

## Vue transversale

### Dépendances inter-tâches

```
TASK-09-001 (aging PDF + email)
    ↓ pattern email + log réutilisable
TASK-09-008 (statement of account)

TASK-09-001 (aging report fiable)
TASK-09-004 (templates invoices)
    ↓ portail s'appuie dessus
TASK-09-007 (B2B portal P3)

TASK-09-002 (credit limit) ← indépendant — quick win sécurité
TASK-09-005 (price history)  ← indépendant — quick win audit
TASK-09-006 (dashboard KPI) ← indépendant — quick win product
```

### Métriques de succès du module B2B

| Métrique | Baseline 2026-04 | Cible Q3 2026 |
|---|---|---|
| DSO (Days Sales Outstanding) | inconnu (TASK-09-006 calcule) | < 45 jours |
| Couverture aging email mensuel | 0% (manuel) | 100% (auto TASK-09-001) |
| Erreurs credit_limit dépassement | non tracé | 0 (TASK-09-002 bloque) |
| Temps génération 30 invoices | ~30 min (manuel one-by-one) | < 2 min (TASK-09-003 bulk) |

### Pitfalls connus impactant ces tâches

Reprendre les pitfalls de [docs/reference/04-modules/09-b2b-wholesale.md](../04-modules/09-b2b-wholesale.md) avant tout dev :
- `posOrderId` lien POS↔B2B → pas double-compter dans rapports.
- FIFO allocation côté client → race condition sur paiements simultanés.
- `amount_due` calculé par trigger → ne JAMAIS le set manuellement.
- Invoice signed URL TTL 1h → re-générer à la demande.
- `b2b_order_history` append-only.

### Risques transversaux

- **Coordination comptable** : TASK-09-001/008 changent les emails reçus par le comptable → l'avertir avant déploiement.
- **Performance bulk invoice** : TASK-09-003 stress Storage + Edge Function memory — surveiller via Sentry.
- **Sécurité portal P3** : TASK-09-007 expose des données B2B publiquement → audit `/security-review` obligatoire avant déploiement.

### Couverture audits

| Tâche | Source audit | Section |
|---|---|---|
| TASK-09-001 | 07-product-backlog-audit.md | Gap 6 (cash flow) + reporting |
| TASK-09-002 | 07-product-backlog-audit.md | "B2B credit module needs hardening" |
| TASK-09-003 | 02-accounting-business-audit.md + module 09 | Edge Functions B2B |
| TASK-09-004 | 07-product-backlog-audit.md | I1 Faktur Pajak preparation |
| TASK-09-005 | module 09 ref | b2b_price_lists pitfall |
| TASK-09-006 | ux-gap-analysis-2026-05-01.md | "B2B dashboard KPI MANQUANT" |
| TASK-09-007 | 07-product-backlog-audit.md | Customer notifications gap |
| TASK-09-008 | comptabilité demande métier | — |
