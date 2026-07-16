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
  - 'apps/pos/src/features/**/*b2b*'
  - 'supabase/migrations/*b2b*.sql'
  - 'supabase/tests/*b2b*.test.sql'
promptSignals:
  phrases:
    - 'B2B'
    - 'AR aging'
    - 'accounts receivable'
    - 'credit limit'
    - 'b2b_payments'
    - 'b2b_current_balance'
    - 'invoice'
    - 'FIFO allocation'
    - 'account customer'
---

# B2B Credit & AR — The Breakery ERP

Expert on the B2B credit flow: customer credit setup → order creation (AR debit) →
payment receipt (AR credit) → balance reconciliation.

Two use cases:
1. **Audit** AR integrity (balance consistency, credit-limit gate wired, ledger append-only).
2. **Guide** future changes (new payment methods, per-invoice allocation, credit policy changes).

**`CLAUDE.md` est la source de vérité** for project-wide patterns (REVOKE pairs, RPC
versioning, idempotency flavors, PIN header). This skill adds B2B-specific mental model,
schema reality, and audit checklists that CLAUDE.md doesn't carry.

---

## Mental model — B2B credit flow

```
Customer setup               Order creation (AR ↑)        Payment receipt (AR ↓)
─────────────────            ─────────────────────        ──────────────────────
customers.customer_type      create_b2b_order             record_b2b_payment
  = 'b2b'                      ↓ validate credit gate        ↓ DR Cash/Bank
customers.b2b_credit_limit     ↓ INSERT orders (b2b_pending) ↓ CR B2B_AR (1132)
  (NULL = unlimited)           ↓ INSERT order_items          ↓ FIFO snapshot → allocation JSONB
customers.b2b_current_balance  ↓ stock_movements sale        ↓ balance -= amount
  (cached AR, nonneg CHECK)    ↓ DR B2B_AR / CR revenue      ↓ INSERT b2b_payments
                               ↓ balance += total            ↓ audit_logs b2b.payment.recorded

Admin adjust                 AR Aging (read-only)
────────────────             ────────────────────
adjust_b2b_balance           view_ar_aging (SECURITY INVOKER)
  ↓ no JE emitted              ↓ buckets current/31-60/61-90/90+
  ↓ reason required (≥3)       ↓ keyed on invoice_date (no due_date S24)
  ↓ audit_logs only            ↓ per-customer + per-bucket aggregated
```

---

> Les numéros de version RPC sont volontairement omis dans ce skill (versions omises — vérifier `CLAUDE.md` / `supabase/migrations/`) — ils bumpent presque chaque session ; les mentions d'historique (« Drop v1 », noms de migration) sont conservées.

## Schema reality (vérifié contre migrations V3 dev 20260601000005..022)

### `customers` table (S13 + S24)
- `name` TEXT — contact name. **PAS `full_name`** (schema discovery S31).
- `b2b_company_name` TEXT NULL — legal entity (PT/CV), distinct from `name`.
- `b2b_tax_id` TEXT NULL — NPWP.
- `b2b_payment_terms_days` INT NULL CHECK ≥ 0.
- `b2b_credit_limit` NUMERIC(14,2) NULL — NULL means unlimited.
- `b2b_current_balance` NUMERIC(14,2) NOT NULL DEFAULT 0, CHECK ≥ 0.
- `customer_type` ENUM `retail | b2b`.
- **`b2b_current_balance` UPDATE is REVOKED** for `authenticated`, `anon`, `PUBLIC`
  (migration `_013`). Seuls les 3 RPCs SECURITY DEFINER peuvent l'écrire.

### `b2b_payments` ledger (append-only, `_010`)
- `payment_number` TEXT UNIQUE — séquence `BP-YYYY-NNNN` (sequence `b2b_payment_seq`).
- `amount` NUMERIC(14,2) CHECK > 0.
- `method` ENUM `payment_method` (réutilise enum POS).
- `idempotency_key` UUID UNIQUE — replay safety.
- `allocation` JSONB `[{invoice_id, amount_applied}]` — snapshot FIFO, metadata only (D3).
  Source-of-truth = `customers.b2b_current_balance`.
- `journal_entry_id` UUID FK `journal_entries` — JE DR Cash/Bank / CR B2B_AR.
- RLS : SELECT pour `authenticated` ; INSERT/UPDATE/DELETE révoqués pour authenticated/anon/PUBLIC.

### `orders` table — champs B2B
- `order_type` ENUM inclut `'b2b'`.
- `order_status` ENUM inclut `'b2b_pending'` — statut d'une invoice non-payée.
- `session_id` NULL autorisé pour B2B (CHECK relaxé migration `_006`).
- `total` (pas `total_amount`), `served_by` (pas `created_by`) — schema discovery S31.
- `paid_at` NULL = invoice unpaid.
- `idempotency_key` UUID — clé idempotency sur orders.

### `refunds` table
- `refunds.total` (pas `amount`) — schema discovery S31.

### Views (SECURITY INVOKER)
- `view_b2b_invoices` — joint `orders` + `customers` WHERE `order_type='b2b'` ;
  expose `customer_name` (= `customers.name`), `invoice_total` (= `orders.total`),
  `age_days` (= `CURRENT_DATE - orders.created_at::date`), `is_unpaid` (paid_at IS NULL).
- `view_ar_aging` — agrège `view_b2b_invoices` WHERE `is_unpaid=TRUE` en 4 buckets
  (`current` ≤30j / `31-60` / `61-90` / `90+`), GROUP BY customer + bucket.

---

## Critical patterns (don't break these)

1. **`b2b_payments` append-only** — never INSERT directly. Seul `record_b2b_payment`
   (SECURITY DEFINER) peut écrire. RLS révoque INSERT/UPDATE/DELETE pour authenticated.
2. **`b2b_current_balance` write-only via RPCs** — la colonne UPDATE est révoquée pour
   `authenticated`/`anon`/`PUBLIC`. Tout UPDATE direct raise 42501. Les 3 seuls écrivains
   légitimes : `create_b2b_order` (+=), `record_b2b_payment` (-=),
   `adjust_b2b_balance` (±=). Bypass légal : SECURITY DEFINER postgres owner.
3. **Credit-limit gate OBLIGATOIRE** avant tout ordre B2B — `validate_b2b_credit_limit_v1`
   doit être appelé dans toute RPC ou EF créant un ordre B2B. `NULL` credit_limit = unlimited
   (gate retourne `allowed: true`). Payload `would_exceed_by` exposé à l'UI.
4. **Idempotency flavor 2 (RPC arg)** — `record_b2b_payment` + `create_b2b_order` +
   `adjust_b2b_balance` acceptent `p_idempotency_key UUID`. Replay retourne le résultat
   original + `idempotent_replay: true`. Pattern CLAUDE.md §"Idempotency 2-flavors".
5. **Overpayment guard (P0011)** — `record_b2b_payment` refuse si
   `balance_before - amount < 0`. `adjust_b2b_balance` refuse si `balance + delta < 0`
   (CHECK `customers_b2b_current_balance_nonneg` double la garde au niveau table).
6. **Fiscal period guard** — `record_b2b_payment` et `create_b2b_order` appellent
   `check_fiscal_period_open()`. Raise P0004 si période fermée.
7. **Allocation FIFO = metadata only** (S24, D3) — le JSONB `allocation` dans `b2b_payments`
   est un snapshot d'audit, PAS une mise à jour per-invoice. Allocation per-invoice exacte
   est backlog S26+. Ne pas construire de logique applicative dessus.
8. **JE mapping** : `SALE_PAYMENT_CASH` → 1110 (cash) ; `B2B_PAYMENT_BANK` → 1112 (bank) ;
   `B2B_AR` → 1132 ; `SALE_B2B_REVENUE` → 4131. Pas de PB1 sur B2B orders (S24 §5, backlog S30+).
9. **REVOKE pair S25 canonique** sur toute nouvelle RPC B2B (3 lignes : PUBLIC + anon +
   ALTER DEFAULT PRIVILEGES). Voir CLAUDE.md §Critical patterns.

---

## BO surface — `apps/backoffice/src/features/btob/`

Feature folder réel (vérifié) : `apps/backoffice/src/features/btob/`

| Fichier | Rôle |
|---|---|
| `hooks/useB2bDashboard.ts` | KPI aging — consomme `view_ar_aging` |
| `hooks/useB2bCustomers.ts` | Liste customers `customer_type='b2b'` |
| `hooks/useB2bPaymentsReceived.ts` | Historique `b2b_payments` |
| `hooks/useCreateB2bOrder.ts` | Wrap `create_b2b_order` |
| `hooks/useRecordB2bPayment.ts` | Wrap `record_b2b_payment` + `useRef(crypto.randomUUID())` idempotency |
| `hooks/useProductsForB2bOrder.ts` | Produits disponibles pour créer un ordre |
| `components/CreateB2bOrderModal.tsx` | Modal "+ New B2B Order" — câble credit-limit gate |
| `components/RecordB2bPaymentModal.tsx` | Modal "Record Payment" — tab "Received" |

---

## Audit checklist

### A. Intégrité AR (balance vs ledger)

- [ ] **Balance = Σ orders − Σ payments** — pour chaque customer B2B :
  `SUM(orders.total) WHERE order_type='b2b' AND status='b2b_pending'` doit égaler
  `customers.b2b_current_balance`. Drift = ordre créé sans RPC ou paiement hors ledger.
- [ ] **Allocation FIFO cohérente** — `SUM(allocation[*].amount_applied)` des paiements d'un
  customer ≤ somme des invoices créées. (Metadata only S24 — vérification best-effort.)
- [ ] **Overpayment impossible** — aucun `b2b_current_balance` négatif :
  `SELECT * FROM customers WHERE b2b_current_balance < 0` doit être vide.
- [ ] **Aging cohérent** — `view_ar_aging` total_outstanding par customer ≈ b2b_current_balance
  (approximation : view buckets seulement is_unpaid, balance peut inclure partiellement payé S26+).

### B. Sécurité (ledger + balance write-path)

- [ ] **RLS b2b_payments** — `pg_policies` sur `b2b_payments` : SELECT policy `auth_read`
  existe ; aucune policy INSERT/UPDATE/DELETE pour `authenticated`. Vérifier via MCP :
  `SELECT policyname, cmd FROM pg_policies WHERE tablename = 'b2b_payments'`.
- [ ] **REVOKE column b2b_current_balance** — `SELECT * FROM information_schema.column_privileges
  WHERE table_name = 'customers' AND column_name = 'b2b_current_balance' AND privilege_type = 'UPDATE'`
  ne doit PAS inclure `authenticated` ni `anon`.
- [ ] **Credit-limit gate wired** — tout code path créant un ordre B2B appelle
  `validate_b2b_credit_limit_v1` avant INSERT orders. Grep `create_b2b_order` pour
  confirmer l'appel dans toute nouvelle version.
- [ ] **REVOKE pair sur les 3 RPCs B2B** — `record_b2b_payment`, `adjust_b2b_balance`,
  `create_b2b_order` ont chacun REVOKE PUBLIC + anon dans leurs migrations respectives.

### C. Traçabilité

- [ ] **audit_logs rows** — chaque appel RPC produit une ligne :
  `b2b.payment.recorded`, `b2b.balance.adjusted`, `b2b.order.created`.
  `SELECT action, COUNT(*) FROM audit_logs WHERE action LIKE 'b2b.%' GROUP BY action`.
- [ ] **Replay distinguishable** — les replays retournent `idempotent_replay: true` ;
  aucun audit_log supplémentaire n'est créé en replay.
- [ ] **JE correctement lié** — `b2b_payments.journal_entry_id` non null pour les paiements
  non-replay ; `journal_entries.reference_type = 'b2b_payment'` avec `reference_id` correct.

---

## Preventive checklists

### Avant d'ajouter un nouveau method de paiement B2B
- [ ] Le type `payment_method` enum existe sur V3 dev ? (`SELECT enum_range(NULL::payment_method)`)
- [ ] Ajouter un mapping `B2B_PAYMENT_<METHOD>` dans `account_mappings` + migration.
- [ ] Bumper `record_b2b_payment` → version suivante (RPC versioning monotone, CLAUDE.md). Drop de l'ancienne version dans la même migration.
- [ ] REVOKE pair sur la nouvelle version.
- [ ] pgTAP couvrant le nouveau method + replay + overpayment guard.

### Avant de bumper `create_b2b_order`
- [ ] La gate `validate_b2b_credit_limit_v1` est préservée — toute version `_vN+1` DOIT l'appeler.
- [ ] `b2b_current_balance` mis à jour dans la même transaction que l'INSERT orders.
- [ ] stock_movements INSERT toujours présent pour chaque item (décrément stock).
- [ ] Types regen via MCP après la migration.

---

## Sources de vérité (pointers)

```
Migrations (ordre chronologique)
  supabase/migrations/20260517000130_extend_customers_b2b_fields.sql
  supabase/migrations/20260517000131_create_validate_b2b_credit_limit_rpc.sql
  supabase/migrations/20260601000005..022_*.sql  — S24 B2B Foundation (11 migrations)

Tests (vérité comportementale)
  supabase/tests/b2b_foundation.test.sql        — T1-T15, run via MCP execute_sql BEGIN/ROLLBACK
  supabase/tests/b2b_credit.test.sql            — suite complémentaire

CLAUDE.md
  §S24 reference — architecture décisionnelle complète (D1-D3, D6, §4.1.7)
  §Critical patterns — REVOKE pair, idempotency 2-flavors, RPC versioning
```

---

## Verification before claiming a fix is complete

```bash
# Type check
pnpm typecheck

# BO smoke — feature btob
pnpm --filter @breakery/app-backoffice test b2b

# pgTAP via MCP execute_sql (BEGIN/ROLLBACK envelope)
# Run supabase/tests/b2b_foundation.test.sql — 15 tests T1-T15
```

Toujours cibler V3 dev cloud `ikcyvlovptebroadgtvd` via MCP. Jamais `pnpm db:reset` /
`supabase start` (Docker retiré 2026-05-14).

---

## When to escalate

- About to relax `customers_b2b_current_balance_nonneg` CHECK — covers a real invariant.
- About to add per-invoice allocation logic — architectural change (D3 → S26+), confirm scope.
- `validate_b2b_credit_limit_v1` call removed from any order-creation flow — immediate flag.
- Audit finds `b2b_current_balance` drift > 0 on any customer — investigate manual UPDATE
  (column REVOKE should prevent it; if drift exists, the REVOKE was bypassed).
- B2B PB1/tax change — confirm PKP status (ADR-005 supersedes ADR-003 : NON-PKP, PBJT municipale Lombok/NTB, currently no PB1 on B2B orders).
