# Travail — B2B / Wholesale

> Last updated: 2026-05-19 (Session 24 — B2B Foundation)

## S24 deliverables (2026-05-19)

Closes the 5 gaps the audit of module 09 flagged as P0 (surface UI shipped in S14 without backend) :

- **DB** : 11 migrations applied on V3 dev cloud (`20260601000005..022`) — `b2b_payments` ledger (append-only, RLS, REVOKE INSERT/UPDATE/DELETE) ; `view_b2b_invoices` + `view_ar_aging` (real `created_at`-based aging) ; `REVOKE UPDATE customers.b2b_current_balance` (pattern S22 `update_cost_price_v1`) ; `B2B_PAYMENT_BANK` mapping (1112) ; 3 RPCs `record_b2b_payment_v1` / `adjust_b2b_balance_v1` / `create_b2b_order_v1`.
- **RPC wiring** : `create_b2b_order_v1` now calls `validate_b2b_credit_limit_v1` pre-insert and raises `credit_limit_exceeded` (P0011) with `DETAIL=payload jsonb` (would_exceed_by) — closes the S14 gap where the RPC existed but had no caller.
- **UI BO** : `useB2bDashboard` aging KPI now reads `view_ar_aging` (no more `last_visit_at` proxy). New `CreateB2bOrderModal` activates the dashboard "+ New B2B Order" button (closes deviation D-W6-B2B-01). New `RecordB2bPaymentModal` + B2BPaymentsPage "Received" tab consuming `b2b_payments` (closes deviation D-W6-B2BPAY-01).
- **Tests** : pgTAP `b2b_foundation.test.sql` 15 cas ; Vitest live `record-b2b-payment.test.ts` 5 scénarios ; BO smoke `b2b-foundation.smoke.test.tsx` 3 cas (T1 aging KPI, T2 enabled button, T3 record payment mutation).

Reference plan : [`../plans/2026-05-19-session-24-INDEX.md`](../plans/2026-05-19-session-24-INDEX.md).

Closes : TASK-09-001 (PARTIAL — KPI aging done, PDF/email deferred S29), TASK-09-002 (DONE — gate wired), TASK-09-006 (DONE — dashboard KPI fixed) + deviations D-W6-B2B-01 (button activated), D-W6-B2BPAY-01 (Received tab consuming ledger).

---

> Référence : [docs/reference/04-modules/09-b2b-wholesale.md](../04-modules/09-b2b-wholesale.md)
> Sources d'audit : `docs/audit/07-product-backlog-audit.md` (module 88%, gaps B2B), `docs/audit/02-accounting-business-audit.md` (couverture JE B2B), `docs/audit/05-uiux-design-audit.md` (PaymentModal)

## Objectifs du module

1. Restituer une **AR aging fiable et exportable** (PDF + email mensuel) pour piloter le recouvrement des créances B2B (≤ 90j vs > 90j) et réduire le DSO.
2. Empêcher l'**over-credit** des clients B2B en bloquant la création de commandes au-dessus du `credit_limit`, avec validation manager hors-ligne traçable.
3. Préparer la **génération multilingue d'invoices** (anglais aujourd'hui, indonésien à venir) via paramétrage centralisé du template, sans casser les invoices déjà générés.
4. Outiller la **génération en lot** (bulk invoicing) pour absorber les pics de fin de mois (~30 invoices simultanés sans timeout Edge Function).
5. Tracer l'**historique des prix négociés** par client (b2b_price_lists versionné) afin que toute modification soit auditable et que les commandes anciennes restent figées.

## Tâches

### TASK-09-001 — AR aging report PDF + planification email mensuelle [P1] [PARTIAL]
**Status note (2026-05-19)** : S24 update — **aging KPI now real**. Migration `20260601000012_create_view_ar_aging.sql` creates the view (buckets `current` / `31-60` / `61-90` / `90+` over `CURRENT_DATE - orders.created_at`) ; the BO `useB2bDashboard` hook reads from `view_ar_aging` directly (commit `062fe35`) — no more `last_visit_at` proxy. The remaining work is the **PDF export + monthly email cron** (still TODO, deferred to S29 Reports Export + Z-Report PDF). Closes the dashboard bug ; the report side moves to S29.
**Status note (2026-05-14)** : Not delivered in Session 13. No `view_ar_aging`, no `B2BAgingSummary.tsx` / `B2BPaymentsAgingTab.tsx` in `apps/backoffice/src/features/`, no `b2b-aging-monthly` EF in `supabase/functions/`, and no `aging_email_log` migration in `20260517*.sql`. Phase 3.C delivered B2B field plumbing only (TASK-09-002 credit-limit RPC); aging report deferred.
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

### TASK-09-002 — Credit limit enforcement + override manager [P1] [DONE]
**Status note (2026-05-19)** : S24 update — **gate now wired into the order path**. The S13 `validate_b2b_credit_limit_v1` RPC was tested but never called. S24 migration `20260601000022_create_b2b_order_v1.sql` introduces `create_b2b_order_v1` which calls the validate RPC *pre-insert* ; on `allowed=false` it raises `credit_limit_exceeded` (P0011) with `DETAIL=payload jsonb` (commits `a337426` + `1ace80c`). BO `CreateB2bOrderModal` surfaces the payload (`would_exceed_by`) with a yellow alert (commit `564fdd6`). The manager-PIN override branch is still residual — backlog item, not blocking gate.
**Status note (2026-05-14)** : Credit-limit RPC delivered Session 13 Phase 3.C; manager-PIN override not built. V3 evidence: `supabase/migrations/20260517000130_extend_customers_b2b_fields.sql` adds `b2b_credit_limit` + `b2b_current_balance`; `supabase/migrations/20260517000131_create_validate_b2b_credit_limit_rpc.sql` exposes `validate_b2b_credit_limit_v1(p_customer_id, p_order_amount) RETURNS jsonb` (returns `{allowed, current_balance, credit_limit, available, would_exceed_by}`); UI surface `apps/backoffice/src/features/customers/components/B2BFieldsSection.tsx`. The manager-PIN override branch + `credit_status='suspended'` block are residual follow-ups (still TODO) but the core enforcement is in place. Commit `bdf21aa` (squashed PR #13).
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
**Status note (2026-05-14)** : Not delivered in Session 13. No `generate-invoice` or `b2b-bulk-invoice` EF in `supabase/functions/` (only 11 EFs total, none invoice-related), no `bulk_invoice_jobs` migration, no `B2BBulkInvoicePage.tsx` in `apps/backoffice/src/pages/`. Pre-requisite single-invoice generator must land first. Per D2, B2B invoicing pivots from `customer_invoices` table to `orders.invoice_number` + `view_b2b_invoices`.
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
**Status note (2026-05-14)** : Not delivered in Session 13. No `invoice_template_config` table, no `customers.invoice_language` column in `20260517*.sql`, no `generate-invoice` EF. Phase 5.C delivered `email_receipt_templates` (migration `20260517000192`) but not B2B invoice templating. Faktur Pajak (I1 backlog) remains a Wave 7 item.
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
**Status note (2026-05-14)** : Not delivered in Session 13. No `b2b_price_lists` / `b2b_price_list_items` table in V3 (the V2 tables referenced never migrated — see `05-products-categories.md` notes line 130 "tables existent mais pas utilisées en UI") and no history trigger / `B2BPriceHistoryDrawer`. B2B pricing versioning deferred until the underlying price-list tables are introduced.
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

### TASK-09-006 — B2B dashboard KPI overview [P2] [DONE]
**Status note (2026-05-19)** : S24 update — **DONE for the dashboard KPI side**. S14 shipped `B2BDashboardPage.tsx` with 5 KPI tiles + aging summary, but the aging KPI was computed off `last_visit_at` as a proxy → incorrect numbers in production. S24 fixes this by reading `view_ar_aging` directly in `useB2bDashboard` (commit `062fe35`). The "+ New B2B Order" button (was disabled, deviation D-W6-B2B-01) is now wired to `CreateB2bOrderModal` (commit `564fdd6`). DSO ratio is still not surfaced — separate small follow-up (P3, ~30min, deferred backlog post-S30).
**Status note (2026-05-14)** : Not delivered in Session 13. No `B2BPage.tsx` / `B2BStats.tsx` / `view_b2b_dso` in V3 (`apps/backoffice/src/pages/` and `apps/backoffice/src/features/` contain no `b2b` directory). Phase 3.C scope was DB plumbing + B2BFieldsSection only; full B2B feature surface deferred.
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

### TASK-09-007 — B2B self-service portal (clients) [P3] [BLOCKED]
**Status note (2026-05-14)** : Explicitly deferred to Session 17 per INDEX line 1085 "09-007..017 B2B portal (Session 17)" and line 1209 "B2B customer portal (self-service) | 17". No `b2b-portal/` route or `b2b_customer_users` table in V3.
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

### TASK-09-008 — Statement of account automatique (mensuel) [P2] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 ("09-007..017 B2B portal (Session 17)") — the entire B2B feature surface beyond Phase 3.C plumbing is Session 17 scope. No `get_customer_statement` RPC, no `b2b-statement-monthly` EF, no `B2BStatementModal` in V3. Blocked on TASK-09-001 (aging email pattern) per spec.
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

### TASK-09-009 — Auto-approval workflow [P2] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". No `b2b_approval_rules` table, no approval workflow state in V3 — Phase 3.C only delivered field plumbing + credit-limit RPC.
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

### TASK-09-010 — Détection self-approval (anti-fraude) [P2] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". Depends on TASK-09-009 (approval workflow); blocked transitively. No constraint or report in V3.
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

### TASK-09-011 — Commandes récurrentes / abonnements [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". No `b2b_recurring_orders` table or cron in V3.
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

### TASK-09-012 — Relances automatiques [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". Phase 5.B notification pipeline (`notification-dispatch` EF, `notification_outbox`) provides the email channel substrate when this lands, but no B2B reminder rules / cron in V3 today.
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

### TASK-09-013 — Devis (quote) avant commande [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". No `quote` status enum value, no `generate-quote-pdf` EF in V3.
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

### TASK-09-014 — Avoirs / credit notes [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". No `b2b_credit_notes` table or PDF generator in V3.
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

### TASK-09-015 — Multi-livraisons planifiées d'avance [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". No `b2b_planned_deliveries` table in V3.
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

### TASK-09-016 — Tarification par volume [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". No `b2b_volume_pricing_tiers` table in V3 and price-list infrastructure (TASK-09-005 prerequisite) is itself absent.
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

### TASK-09-017 — Intégration comptable export (Accurate / MYOB) [P3] [BLOCKED]
**Status note (2026-05-14)** : Deferred per INDEX line 1085 "09-007..017 B2B portal (Session 17)". Depends on TASK-10-018 (Accounting general export framework) per spec. No Accurate/MYOB export service in V3.
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
