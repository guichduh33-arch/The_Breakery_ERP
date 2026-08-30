---
name: b2b-credit
description: >-
  B2B credit & AR expert — AR aging, b2b_payments ledger + b2b_payment_allocations,
  credit-limit gate, B2B orders/invoices, FIFO allocation, cancel & reconcile. Audits AR
  integrity AND guides B2B changes. Use this skill whenever the task mentions B2B, client
  compte / account customer, facture / invoice B2B, AR / accounts receivable / créances,
  credit limit / plafond de crédit / encours, b2b_pending, record_b2b_payment,
  create_b2b_order, allocation FIFO, balance B2B, règlement fournisseur de facture B2B — or
  touches apps/backoffice features/btob, the POS B2B debts flow, or any supabase
  migration/test with b2b in the name. Invoke it BEFORE editing any AR/credit RPC.
pathPatterns:
  - 'apps/backoffice/src/features/btob/**'
  - 'apps/backoffice/src/pages/btob/**'
  - 'apps/pos/src/features/customers/**'
  - 'supabase/migrations/*b2b*.sql'
  - 'supabase/tests/*b2b*.test.sql'
promptSignals:
  phrases:
    - 'B2B'
    - 'AR aging'
    - 'accounts receivable'
    - 'credit limit'
    - 'b2b_payments'
    - 'b2b_payment_allocations'
    - 'b2b_current_balance'
    - 'invoice'
    - 'FIFO allocation'
    - 'account customer'
---

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
  (`_next_b2b_invoice_number_v1`, backfill historique par
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

## Critical patterns (don't break these)

1. **`b2b_payments` et `b2b_payment_allocations` append-only** — jamais d'INSERT direct.
   Seul `record_b2b_payment` (SECURITY DEFINER) écrit dans les deux. RLS + REVOKE
   (INSERT/UPDATE/DELETE/TRUNCATE) pour authenticated/anon/PUBLIC.
2. **`b2b_current_balance` write-only via RPCs** — la colonne n'est pas dans le GRANT
   UPDATE per-colonne de `customers`. Tout UPDATE direct raise 42501. Les écrivains
   légitimes sont **quatre** : `create_b2b_order` (+= total), `record_b2b_payment`
   (−= amount), `adjust_b2b_balance` (±= delta), **`cancel_b2b_order` (−= total)**.
   Bypass légal : SECURITY DEFINER postgres owner. Un cinquième écrivain = bypass réel.
3. **Credit-limit gate OBLIGATOIRE** avant tout ordre B2B — `validate_b2b_credit_limit`
   doit être appelé dans toute RPC ou EF créant un ordre B2B, **avant** l'INSERT.
   `NULL` credit_limit = unlimited (gate retourne `allowed: true`). Payload
   `would_exceed_by` exposé à l'UI. Une seule version de cette famille existe et
   `create_b2b_order` l'appelle toujours.
4. **Idempotency flavor 2 (RPC arg)** — `record_b2b_payment`, `create_b2b_order`,
   `adjust_b2b_balance` et `cancel_b2b_order` acceptent tous `p_idempotency_key UUID`.
   Replay retourne le résultat original + `idempotent_replay: true`, sans re-poster de JE.
   Pattern CLAUDE.md §"Idempotence, 2 saveurs". `record_b2b_payment` déduplique sur
   `b2b_payments.idempotency_key` ; les trois autres sur `audit_logs.metadata`.
5. **Overpayment guard (P0011)** — `record_b2b_payment` refuse si
   `balance_before − amount < 0` ; `adjust_b2b_balance` refuse si `balance + delta < 0` ;
   `cancel_b2b_order` refuse si `balance − total < 0`. Le CHECK
   `customers_b2b_current_balance_nonneg` double la garde au niveau table.
6. **Fiscal period guard** — `record_b2b_payment`, `create_b2b_order`,
   `adjust_b2b_balance` et `cancel_b2b_order` appellent `check_fiscal_period_open()`.
   Raise P0004 si période fermée.
7. **Allocation = LIGNES RÉELLES, pas un snapshot** — `record_b2b_payment` écrit dans
   `b2b_payment_allocations` : d'abord les factures ciblées `p_invoice_ids` (dans l'ORDRE
   du tableau, chacune verrouillée `FOR UPDATE`, refus P0001 si la facture n'appartient
   pas au client / n'est pas b2b / est `voided` / est déjà soldée), puis **FIFO** sur le
   reliquat (plus anciennes `b2b_pending` d'abord, `ORDER BY created_at`). Règlement
   complet d'une facture ⇒ `paid_at` + `status='paid'`. **Construire de la logique
   applicative dessus est légitime** : le front le fait déjà (sélection de factures dans
   la modale de paiement, couverte par le test
   `features/btob/__tests__/record-payment-invoice-selection.smoke.test.tsx`).
   Le JSONB `b2b_payments.allocation` reste écrit pour continuité — ne pas le lire comme
   source de vérité.
8. **`cancel_b2b_order` ne touche jamais une facture déjà allouée** — refus P0011
   `order_has_payments` dès qu'une ligne `b2b_payment_allocations` existe, et exige
   `status='b2b_pending'` en entrée. Corollaire : une commande B2B `paid` ne passe jamais
   par cette porte, donc jamais de JE fantôme côté void.
9. **JE mapping** : `SALE_PAYMENT_CASH` → 1110 (cash) ; `B2B_PAYMENT_BANK` → 1112 (bank) ;
   `B2B_AR` → 1132 ; `SALE_B2B_REVENUE` → 4131 ; `B2B_AR_ADJUSTMENT` → 6520
   (Bad Debt / AR Write-off, contrepartie des ajustements). Pas de PB1 sur les commandes
   B2B (ADR-005, NON-PKP / PBJT). `reference_type` autorisés côté `journal_entries` :
   `b2b_order`, `b2b_payment`, `b2b_adjustment`, `b2b_order_cancel`.
10. **Le trigger de JE de vente est gardé contre les commandes B2B** — une commande B2B
    porte déjà sa JE de revenu émise à la création ; le trigger `AFTER UPDATE OF status`
    sur `orders` doit continuer de l'exclure, sinon revenu doublé (bug confirmé sur dev,
    corrigé par `20260818000006_bump_create_sale_journal_entry_b2b_guard.sql`).
11. **`adjust_b2b_balance` émet une JE et exige le PIN manager** — gate dédiée
    `b2b.balance.adjust` (SUPER_ADMIN/ADMIN/MANAGER), PIN vérifié serveur par
    `_verify_pin_with_lockout`, JE de contrepartie 1132 ⇄ 6520 (`delta>0` : Dr 1132 /
    Cr 6520 ; `delta<0` : Dr 6520 / Cr 1132), `reason` ≥ 3 caractères. **Ce n'est plus
    un simple audit_logs.**
12. **REVOKE pair canonique sur TOUTE RPC B2B** (PUBLIC + anon + `ALTER DEFAULT
    PRIVILEGES`), y compris les bumps et les RPC de lecture. Voir CLAUDE.md
    §Critical patterns.
13. **Permissions dédiées, plus le générique `customers.update`** : `b2b.read` (lecture /
    reconcile), `b2b.payment.record`, `b2b.order.cancel`, `b2b.balance.adjust`.
    `create_b2b_order` reste gardé par `pos.sale.create`.
14. **Prix B2B résolu serveur** — `create_b2b_order` calcule chaque ligne via
    `_resolve_b2b_line_price_v1` (négocié > catégorie > retail) et **ignore tout
    `unit_price` client** (ADR-020).

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

## Audit checklist

### A. Intégrité AR (balance vs ledger)

- [ ] **Balance = Σ outstanding**, PAS Σ des `b2b_pending`. Depuis les paiements
  partiels, une facture partiellement réglée reste `b2b_pending` avec un outstanding
  réduit : sommer `orders.total` sur-compterait. La formule vivante est celle de
  `reconcile_b2b_balance` : `SUM(view_b2b_invoices.outstanding) WHERE is_unpaid` par
  customer doit égaler `customers.b2b_current_balance`. Le BO expose déjà ce contrôle —
  hook `useB2bBalanceDrift.ts`, affiché sur le dashboard B2B. Drift = ordre créé hors
  RPC, paiement hors ledger, ou annulation mal contre-passée.
- [ ] **Allocations cohérentes** — pour toute facture,
  `Σ b2b_payment_allocations.amount_applied ≤ orders.total` ; aucune facture `paid` avec
  un outstanding > 0, aucune facture `b2b_pending` avec un outstanding ≤ 0.
- [ ] **Overpayment impossible** — aucun `b2b_current_balance` négatif :
  `SELECT * FROM customers WHERE b2b_current_balance < 0` doit être vide.
- [ ] **Aging cohérent** — `SUM(view_ar_aging.total_outstanding)` par customer =
  `b2b_current_balance` (l'aging étant partial-aware, l'égalité est attendue, pas une
  approximation ; tout écart est un drift à instruire).
- [ ] **Factures annulées invisibles** — aucune ligne `status='voided'` dans
  `view_b2b_invoices`, et toute commande `voided` a une JE `b2b_order_cancel`.

### B. Sécurité (ledgers + balance write-path)

- [ ] **RLS `b2b_payments` et `b2b_payment_allocations`** — policy SELECT seule ; aucune
  policy INSERT/UPDATE/DELETE. Vérifier via MCP :
  `SELECT tablename, policyname, cmd FROM pg_policies WHERE tablename IN ('b2b_payments','b2b_payment_allocations')`.
- [ ] **REVOKE column `b2b_current_balance`** — `SELECT * FROM
  information_schema.column_privileges WHERE table_name='customers' AND
  column_name='b2b_current_balance' AND privilege_type='UPDATE'` ne doit inclure ni
  `authenticated` ni `anon`.
- [ ] **Aucun 5ᵉ écrivain de `b2b_current_balance`** — grep `b2b_current_balance =` dans
  `supabase/migrations/` : seules les familles `create_b2b_order`, `record_b2b_payment`,
  `adjust_b2b_balance`, `cancel_b2b_order` doivent apparaître.
- [ ] **Credit-limit gate wired** — tout code path créant un ordre B2B appelle
  `validate_b2b_credit_limit` avant l'INSERT orders. Le vérifier sur le corps de la
  version live, pas sur la migration d'origine.
- [ ] **REVOKE pair sur CHAQUE RPC B2B** — pas seulement les trois d'origine :
  `create_b2b_order`, `record_b2b_payment`, `adjust_b2b_balance`, `cancel_b2b_order`,
  `reconcile_b2b_balance`, `get_b2b_invoice`, `get_b2b_dashboard_counters`,
  `get_pos_b2b_debts`, `get_b2b_settings` / `update_b2b_settings`. Chaque bump refait la
  paire pour SA signature — une signature changée sans REVOKE rouvre la fonction.
- [ ] **Gates dédiées présentes** — `b2b.read`, `b2b.payment.record`, `b2b.order.cancel`,
  `b2b.balance.adjust` existent dans `permissions` et sont accordées à
  SUPER_ADMIN/ADMIN/MANAGER ; aucune RPC B2B d'écriture ne retombe sur le générique
  `customers.update`.
- [ ] **PIN manager sur l'ajustement** — `adjust_b2b_balance` refuse sans PIN valide
  (`_verify_pin_with_lockout`), et le PIN voyage en argument RPC (pas dans un body loggé
  d'EF).

### C. Traçabilité

- [ ] **audit_logs rows** — chaque appel RPC produit une ligne :
  `b2b.order.created`, `b2b.payment.recorded`, `b2b.balance.adjusted`,
  `b2b.order.cancelled`.
  `SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'b2b.%' GROUP BY action`.
- [ ] **`actor_id` = `user_profiles.id`** — toutes les RPC B2B résolvent le profil depuis
  `auth_user_id`. Jamais `auth.uid()` brut (CLAUDE.md).
- [ ] **Replay distinguishable** — les replays retournent `idempotent_replay: true`,
  ne créent ni JE ni allocation ni audit_log supplémentaires.
- [ ] **JE correctement liée** — `b2b_payments.journal_entry_id` non null hors replay ;
  `journal_entries.reference_type` ∈ {`b2b_order`, `b2b_payment`, `b2b_adjustment`,
  `b2b_order_cancel`}. Note : pour `b2b_payment` et `b2b_adjustment`, `reference_id` est
  posé après coup (paiement) ou laissé NULL (ajustement) pour éviter une collision sur la
  contrainte d'idempotence `(reference_type, reference_id)`.
- [ ] **Pas de double JE de revenu** — une commande B2B passée à `paid` ne doit produire
  AUCUNE JE `reference_type='sale'`.

---

## Preventive checklists

### Avant d'ajouter un nouveau method de paiement B2B
- [ ] Le type `payment_method` enum existe sur V3 dev ? (`SELECT enum_range(NULL::payment_method)`)
- [ ] Ajouter un mapping `B2B_PAYMENT_<METHOD>` dans `accounting_mappings` + migration.
- [ ] Bumper `record_b2b_payment` → version suivante (RPC versioning monotone), DROP de
      l'ancienne dans la MÊME migration, corps repris de `pg_get_functiondef` live.
- [ ] REVOKE pair sur la nouvelle signature.
- [ ] pgTAP couvrant le nouveau method + replay + overpayment guard + allocation.

### Avant de bumper `create_b2b_order`
- [ ] La gate `validate_b2b_credit_limit` est préservée — toute version suivante DOIT
      l'appeler, avant l'INSERT.
- [ ] Le prix de ligne reste résolu serveur (`_resolve_b2b_line_price_v1`) ; aucun
      `unit_price` client honoré.
- [ ] `b2b_current_balance` mis à jour dans la même transaction que l'INSERT orders.
- [ ] `_record_sale_stock_v1` toujours appelé pour chaque item (flag-aware :
      `track_inventory` direct, sinon `deduct_stock` via recette).
- [ ] `order_number` ET `invoice_number` posés ; la séquence de facturation reste
      `_next_b2b_invoice_number_v1`.
- [ ] Types regen via MCP après la migration.

### Avant de toucher au règlement (paiement / annulation)
- [ ] Le refus d'annulation quand une allocation existe est conservé.
- [ ] Le passage `paid_at` + `status='paid'` reste conditionné au règlement COMPLET.
- [ ] `view_b2b_invoices` / `view_ar_aging` restent dérivées du ledger d'allocations —
      ne pas retomber sur `paid_at IS NULL`.
- [ ] La garde anti-double-JE côté trigger de vente reste active.

---

## Sources de vérité (pointers)

```
Migrations — la vérité est le numéro LE PLUS HAUT de chaque famille
  supabase/migrations/*b2b*.sql
    · socle : extend_customers_b2b_fields, create_validate_b2b_credit_limit_rpc,
              enums b2b / b2b_pending, relax_orders_session_id_nullable,
              create_b2b_payments_table, revoke_update_b2b_current_balance
    · refonte règlement (2026-07-10) : create_b2b_payment_allocations,
              seed_b2b_payment_record_cancel_perms, record_b2b_payment (v2),
              cancel_b2b_order, rebuild_b2b_views_outstanding,
              reconcile_b2b_balance
    · ajustement (2026-07-10) : adjust_b2b_balance_v2_je_pin (JE 1132⇄6520 + PIN)
    · facturation : invoice_sequences_and_number, backfill_b2b_invoice_numbers,
              get_b2b_invoice, view_b2b_invoices_invoice_number
    · dashboard : adr026_get_b2b_dashboard_counters (ADR-026)
    · garde JE : bump_create_sale_journal_entry_b2b_guard (2026-08-18)

Tests (vérité comportementale) — run via MCP execute_sql, enveloppe BEGIN/ROLLBACK
  supabase/tests/b2b_*.test.sql   — 10 fichiers au 2026-08-31 (foundation, credit,
    settlement, invoice, settings, negotiated_price, balance_adjust_je_pin,
    dashboard_counters, flag_aware_stock, display_aware_stock)
  supabase/tests/sale_je_b2b_guard.test.sql — garde anti-double-JE

Front (call-sites — la version vivante d'une RPC se lit ICI)
  apps/backoffice/src/features/btob/hooks/*.ts
  apps/pos/src/features/customers/hooks/useOutstandingDebts.ts

ADR
  ADR-005 — NON-PKP / PBJT Lombok : pas de PB1 sur les commandes B2B
  ADR-020 — prix négocié résolu serveur sur le money-path
  ADR-026 — les agrégats du dashboard B2B quittent le client (famille de compteurs serveur)

CLAUDE.md
  §Critical patterns — REVOKE pair, idempotence 2 saveurs, RPC versioning monotone,
                       actor_id = user_profiles.id, ledgers append-only
```

---

## Verification before claiming a fix is complete

```bash
# Type check
pnpm typecheck

# BO smoke — feature btob (filtre = NOM DE FICHIER ; les fichiers b2b du BO sont
# en kebab-case ET en PascalCase — localiser par glob avant de conclure)
pnpm --filter @breakery/app-backoffice test b2b

# pgTAP via MCP execute_sql (BEGIN/ROLLBACK envelope)
# Rejouer les fichiers supabase/tests/b2b_*.test.sql concernés par le changement
```

Toujours cibler V3 dev cloud `ikcyvlovptebroadgtvd` via MCP. Jamais `pnpm db:reset` /
`supabase start` (Docker retiré 2026-05-14).

---

## When to escalate

- About to relax `customers_b2b_current_balance_nonneg` CHECK — couvre un invariant réel.
- About to make `b2b_current_balance` la source de vérité par facture, ou à l'inverse à
  supprimer le cache — c'est un changement d'architecture AR, pas un fix.
- About to relax the "cancel refusé si une allocation existe" rule, ou à autoriser
  l'annulation d'une facture `paid` — touche la réversibilité comptable.
- `validate_b2b_credit_limit` call removed from any order-creation flow — immediate flag.
- Audit finds `b2b_current_balance` drift ≠ 0 on any customer (`reconcile_b2b_balance` /
  `useB2bBalanceDrift`) — investiguer un UPDATE hors RPC (le REVOKE colonne devrait
  l'empêcher ; s'il y a drift, soit le REVOKE a été contourné, soit une RPC contre-passe
  mal).
- B2B PB1/tax change — confirm PKP status (ADR-005 supersedes ADR-003 : NON-PKP, PBJT
  municipale Lombok/NTB, currently no PB1 on B2B orders).
- L'aging doit-il basculer sur `b2b_payment_terms_days` (échéance) au lieu de l'âge de la
  facture ? La colonne existe et n'est pas utilisée — **signalement, pas décision** :
  c'est un arbitrage produit.
