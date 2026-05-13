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
