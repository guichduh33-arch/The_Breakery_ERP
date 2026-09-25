# b2b-credit — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Mental model — B2B credit flow
- Schema reality (re-vérifié 2026-08-31)
- BO surface — `apps/backoffice/src/features/btob/`

Périmètre : parcours B2B du back-office et RPC/tests de commandes, crédit, paiements et allocations B2B. Un paiement fournisseur générique sans créance client B2B ne suffit pas à déclencher ce workflow.

# B2B Credit & AR — The Breakery ERP

> **Re-vérifié le 2026-08-31** contre `supabase/migrations/` (migration au numéro le plus
> haut) et les call-sites de `apps/backoffice/src/features/btob/`. **Le code gagne** : si
> une ligne de ce fichier contredit une RPC live, une vue live ou un hook, c'est cette
> ligne qui a tort — signale-la, ne « corrige » pas le code pour lui donner raison.
> Les numéros de version d'objet DB sont volontairement absents des pointeurs vivants :
> on cite la **famille** (`record_b2b_payment`), la version se vérifie dans
> `supabase/migrations/` **et** au call-site avant de s'y fier.

Expert on the B2B credit flow: customer credit setup → order creation (AR debit) →
payment receipt (AR credit, allocated per invoice) → cancel / reconciliation.

Two use cases:
1. **Audit** AR integrity (balance vs allocation ledger, credit-limit gate wired, ledgers
   append-only, GL ⇄ subsidiary ledger en phase).
2. **Guide** future changes (new payment methods, credit policy, invoice lifecycle).

**`CLAUDE.md` est la source de vérité** for project-wide patterns (REVOKE pairs, RPC
versioning, idempotency flavors, PIN header). This skill adds B2B-specific mental model,
schema reality, and audit checklists that CLAUDE.md doesn't carry.

---

## Mental model — B2B credit flow

```
Customer setup               Order creation (AR ↑)         Payment receipt (AR ↓)
─────────────────            ─────────────────────         ──────────────────────
customers.customer_type      create_b2b_order              record_b2b_payment
  = 'b2b'                      ↓ gate pos.sale.create         ↓ gate b2b.payment.record
customers.b2b_credit_limit     ↓ prix résolu SERVEUR          ↓ DR Cash/Bank
  (NULL = unlimited)             (négocié>catégorie>retail)   ↓ CR B2B_AR (1132)
customers.b2b_current_balance  ↓ validate_b2b_credit_limit    ↓ INSERT b2b_payments
  (cache AR, CHECK ≥ 0)        ↓ INSERT orders (b2b_pending)  ↓ INSERT b2b_payment_allocations
                               ↓ order_number + invoice_number   (ciblé p_invoice_ids puis
                               ↓ _record_sale_stock_v1            FIFO sur le reliquat)
                               ↓ DR B2B_AR / CR revenue (4131) ↓ orders.paid_at + status='paid'
                               ↓ balance += total                sur règlement COMPLET
                               ↓ audit_logs b2b.order.created ↓ balance -= amount
                                                              ↓ audit_logs b2b.payment.recorded

Cancel (AR ↓, invoice morte)  Admin adjust (AR ±)           Reconcile (lecture seule)
────────────────────────────  ───────────────────           ─────────────────────────
cancel_b2b_order              adjust_b2b_balance            reconcile_b2b_balance
  ↓ gate b2b.order.cancel       ↓ gate b2b.balance.adjust     ↓ gate b2b.read
  ↓ refuse si une allocation    ↓ PIN manager serveur         ↓ cache vs Σ outstanding
    existe déjà                   (_verify_pin_with_lockout)  ↓ has_drift, AUCUN auto-fix
  ↓ stock rendu (sale_void)    ↓ JE contrepartie 1132 ⇄ 6520
  ↓ JE inverse DR revenue      ↓ reason ≥ 3 caractères       AR Aging (lecture seule)
    / CR AR                    ↓ balance ±= delta            ────────────────────────
  ↓ balance -= total           ↓ audit_logs                  view_ar_aging (SECURITY INVOKER)
  ↓ orders.status = 'voided'     b2b.balance.adjusted          ↓ buckets current/31-60/61-90/90+
  ↓ audit_logs                                                 ↓ agrège l'OUTSTANDING partiel
    b2b.order.cancelled                                        ↓ clé = invoice_date (pas de due_date)
```

---

## Schema reality (re-vérifié 2026-08-31)

### `customers` table
- `name` TEXT — contact name. **PAS `full_name`**.
- `b2b_company_name` TEXT NULL — legal entity (PT/CV), distinct from `name`.
- `b2b_tax_id` TEXT NULL — NPWP.
- `b2b_payment_terms_days` INT NULL CHECK ≥ 0 — **stocké mais NON utilisé par l'aging**
  (les buckets sont calculés sur l'âge de la facture, pas sur une échéance).
- `b2b_credit_limit` NUMERIC(14,2) NULL — NULL means unlimited.
- `b2b_current_balance` NUMERIC(14,2) NOT NULL DEFAULT 0, CHECK ≥ 0. **Cache**, pas
  source de vérité : la vérité par facture est le ledger d'allocations.
- `customer_type` ENUM `retail | b2b`.
- **`b2b_current_balance` n'est PAS UPDATE-able par `authenticated`** : le GRANT UPDATE
  sur `customers` est per-colonne et cette colonne est **omise** du re-grant
  (`20260601000013_revoke_update_b2b_current_balance.sql`) ; REVOKE explicite pour `anon`
  et `PUBLIC`. Seules les RPCs SECURITY DEFINER l'écrivent.

### `b2b_payments` ledger (append-only, `20260601000010_create_b2b_payments_table.sql`)
- `payment_number` TEXT UNIQUE — séquence `BP-YYYY-NNNN` (sequence `b2b_payment_seq`).
- `amount` NUMERIC(14,2) CHECK > 0.
- `method` ENUM `payment_method` (réutilise enum POS).
- `idempotency_key` UUID UNIQUE — replay safety.
- `allocation` JSONB — **snapshot legacy conservé pour continuité**, plus la source de
  vérité. Le ledger réel est `b2b_payment_allocations` (voir ci-dessous).
- `journal_entry_id` UUID FK `journal_entries` — JE DR Cash/Bank / CR B2B_AR.
- RLS : SELECT pour `authenticated` ; INSERT/UPDATE/DELETE révoqués pour
  authenticated/anon/PUBLIC (durci une seconde fois, TRUNCATE inclus, par le lot
  « revoke residual DML on append-only ledgers »).

### `b2b_payment_allocations` ledger (append-only)
Créé par `20260710000065_create_b2b_payment_allocations.sql`.
- `payment_id` FK `b2b_payments` ON DELETE RESTRICT.
- `invoice_id` FK `orders` ON DELETE RESTRICT.
- `amount_applied` NUMERIC(14,2) CHECK > 0.
- UNIQUE `(payment_id, invoice_id)` — un paiement ne touche une facture qu'une fois.
- **Point de dérivation unique** : `outstanding(facture) = orders.total − Σ amount_applied`.
- RLS : SELECT `authenticated` seulement ; aucune policy d'écriture ;
  INSERT/UPDATE/DELETE/TRUNCATE révoqués. Écrit uniquement par `record_b2b_payment`
  (SECURITY DEFINER).

### `orders` table — champs B2B
- `order_type` ENUM inclut `'b2b'`.
- `order_status` ENUM inclut `'b2b_pending'` — invoice non réglée (enum étendu par
  `20260601000006_extend_order_status_enum_b2b_pending.sql`).
- `session_id` NULL autorisé — CHECK relaxé par
  `20260601000007_relax_orders_session_id_nullable.sql` (**pas `_006`**), puis une
  **troisième** relaxation pour les commandes held
  (`20260620000015_relax_orders_session_id_for_held.sql`).
- `total` (pas `total_amount`), `served_by` (pas `created_by`).
- `paid_at` — posé par `record_b2b_payment` au **règlement complet**, avec `status='paid'`.
  Un règlement partiel laisse la facture en `b2b_pending` avec un outstanding réduit.
- `invoice_number` — référence de facturation B2B, distincte de `order_number`
  (`_next_b2b_invoice_number`, backfill historique par
  `20260710000131_backfill_b2b_invoice_numbers.sql`). Depuis la numérotation par origine,
  `order_number` d'une commande B2B est au format `BO<DDMMYYYY><NNN>`.
- `voided_at` / `voided_by` / `void_reason` — posés par `cancel_b2b_order`.
- `idempotency_key` UUID — idempotence métier sur orders.

### `refunds` table
- `refunds.total` (pas `amount`).

### Views (SECURITY INVOKER) — rebâties par `20260710000070_rebuild_b2b_views_outstanding.sql`
- `view_b2b_invoices` — `orders` + `customers` WHERE `order_type='b2b'`,
  `customer_type='b2b'`, `customers.deleted_at IS NULL` et **`status <> 'voided'`**
  (les factures annulées sortent de la vue). Expose `customer_name` (= `customers.name`),
  `invoice_total` (= `orders.total`), `invoice_date`, `paid_at`, `order_status`,
  `age_days`, **`amount_paid`** (= Σ `b2b_payment_allocations.amount_applied`),
  **`outstanding`** (= `invoice_total − amount_paid`), et
  **`is_unpaid` = `outstanding > 0`** — dérivé du ledger d'allocations, **PLUS
  `paid_at IS NULL`**. `invoice_number` a été ajouté ensuite par
  `20260710000133_view_b2b_invoices_invoice_number.sql` (colonne appendue en fin de SELECT).
- `view_ar_aging` — agrège `view_b2b_invoices` WHERE `is_unpaid=TRUE` en 4 buckets
  (`current` ≤30j / `31-60` / `61-90` / `90+`), GROUP BY customer + bucket. Format long
  (une ligne par customer×bucket). `total_outstanding` somme **l'outstanding partiel**,
  pas `invoice_total` — l'aging est partial-payment aware.

---

## BO surface — `apps/backoffice/src/features/btob/`

Pages : `apps/backoffice/src/pages/btob/` — `B2BDashboardPage`, `B2BOrdersPage`,
`B2BPaymentsPage`, `B2BSettingsPage`. La fiche client
(`pages/customers/customer-detail/`) porte l'onglet Info (ajustement de solde) et
l'onglet Pricing (prix négociés).

| Fichier | Rôle |
|---|---|
| `hooks/useB2bDashboard.ts` | KPI dashboard — `get_b2b_dashboard_counters` + `view_b2b_invoices` |
| `hooks/useB2bOrdersList.ts` | Liste des factures — `view_b2b_invoices` |
| `hooks/useB2bOrdersCounters.ts` | Compteurs d'onglets — counts serveur + `get_b2b_dashboard_counters` |
| `hooks/useB2bInvoices.ts` | Onglet Invoices — `view_b2b_invoices` |
| `hooks/useB2bCustomers.ts` | Liste customers `customer_type='b2b'` |
| `hooks/useB2bPaymentsReceived.ts` | Historique `b2b_payments` |
| `hooks/useB2bOrderItems.ts` | Lignes d'une facture (`order_items`) |
| `hooks/useProductsForB2bOrder.ts` | Produits disponibles pour créer un ordre |
| `hooks/useCreateB2bOrder.ts` | Wrap `create_b2b_order` |
| `hooks/useRecordB2bPayment.ts` | Wrap `record_b2b_payment` (+ `p_invoice_ids`) — idempotence `useRef(crypto.randomUUID())` |
| `hooks/useCancelB2bOrder.ts` | Wrap `cancel_b2b_order` |
| `hooks/useAdjustB2bBalance.ts` | Wrap `adjust_b2b_balance` — PIN manager en arg RPC, idempotence par `useRef` |
| `hooks/useB2bBalanceDrift.ts` | Wrap `reconcile_b2b_balance` — alerte drift, query gatée sur `b2b.read` ; exporte `B2B_DRIFT_QK` |
| `hooks/useDownloadB2bInvoice.ts` | Wrap `get_b2b_invoice` — export PDF d'une facture |
| `hooks/useB2bSettings.ts` / `hooks/useUpdateB2bSettings.ts` | Wrap `get_b2b_settings` / `update_b2b_settings` |
| `components/CreateB2bOrderModal.tsx` | Modal "+ New B2B Order" — câble le credit-limit gate |
| `components/RecordB2bPaymentModal.tsx` | Modal "Record Payment" — sélection de factures ciblées |
| `components/B2bInvoicesTab.tsx` | Onglet factures — export PDF par ligne + entrée annulation |
| `components/CancelB2bOrderModal.tsx` | Modal d'annulation — raison obligatoire |
| `components/AdjustB2bBalanceModal.tsx` | Modal d'ajustement de solde — monté dans l'onglet Info de la fiche client |
| `components/AgingBucketsGrid.tsx` | Grille des buckets d'aging |
| `components/B2bOrderItemsPanel.tsx` | Détail des lignes d'une facture |
| `paymentStatusMeta.ts` | Libellés/couleurs des statuts de paiement |

**POS** — `apps/pos/src/features/customers/CustomerDebtsPanel.tsx` (route `/pos/debts`),
alimenté par `hooks/useOutstandingDebts.ts` (famille `get_pos_b2b_debts`). Le POS y
affiche les dettes B2B **en lecture** : pas de bouton "Pay" sur une commande B2B — la
garde serveur les rejette et le règlement B2B, per-invoice, se fait au back-office.

---
