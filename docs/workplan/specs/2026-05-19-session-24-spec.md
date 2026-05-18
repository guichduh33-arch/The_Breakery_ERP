# Session 24 — Spec : B2B Foundation (backend du dashboard déjà shippé)

**Date :** 2026-05-19
**Branch :** `swarm/session-24` (off `a9b7ca2` post-S23 audit/plan)
**Source de la décision :** plan multi-sessions [`../plans/2026-05-19-S24-to-S30-plan.md`](../plans/2026-05-19-S24-to-S30-plan.md) §3 S24 + audit module 09 daté 2026-05-19.
**INDEX :** [`../plans/2026-05-19-session-24-INDEX.md`](../plans/2026-05-19-session-24-INDEX.md)
**Migration block réservé :** `20260601000010..099`.

---

## 1. Goal

Le module 09 (B2B Wholesale) a livré en S14 une **surface UI sans backend** : la `B2BDashboardPage` est en prod, le RPC `validate_b2b_credit_limit_v1` existe et est testé (6/6 pgTAP) mais **n'est appelé par personne**, les KPI aging sont calculés sur le proxy `last_visit_at` au lieu de vraies dates facture → **chiffres faux en production**. Le bouton "+ New B2B Order" est `disabled` (deviation D-W6-B2B-01).

S24 ferme **5 gaps** :

1. Créer le ledger `b2b_payments` + RPC `record_b2b_payment_v1` (paiement client B2B + JE Cash→AR).
2. Créer le RPC `adjust_b2b_balance_v1` (ajustement admin avec audit + REVOKE UPDATE direct sur `customers.b2b_current_balance`).
3. Câbler `validate_b2b_credit_limit_v1` via un nouveau RPC dédié `create_b2b_order_v1` (commande B2B unpaid avec gate crédit).
4. Créer 2 vues : `view_b2b_invoices` (vraies dates facture) + `view_ar_aging` (buckets sur invoice date réelle).
5. Fixer `useB2bDashboard` aging proxy → consomme `view_ar_aging` ; activer "+ New B2B Order" via un modal minimaliste de création.

**Hors scope (out-of-scope explicite) :**

- B2BSettings backend (deviation D-W6-B2BSET-01) — restera vide en S24, refactor S31+.
- B2BPayments page complète multi-onglets — S24 livre seulement l'onglet "Reçu" qui consomme `b2b_payments`.
- Listes de prix B2B négociées (TASK-09-???).
- Fiche client B2B 360° (`/b2b/clients/:id`).
- Édition/clone/livraisons multiples d'une commande B2B (gros scope V2 — TASK-09-??? reste backlog post-S30).
- Allocation FIFO précise paiement→factures individuelles → S24 stocke l'allocation comme metadata, mais le calcul aging utilise `customers.b2b_current_balance` agrégé par customer (pas par invoice). Allocation per-invoice = backlog S26+ (Comptable Cockpit).
- Invoice PDF generation (S29 scope).
- Multi-currency PO/invoice (bloqué statut TASK-10-019).

---

## 2. Décisions clés (D1-D8)

| ID | Décision | Rationale |
|----|----------|-----------|
| **D1** | `b2b_payments` est un **ledger append-only** dédié, parallèle à `order_payments`. RLS revoke UPDATE/DELETE pour `authenticated`, writes via RPC SECURITY DEFINER seulement. | Pattern S22 `stock_movements` : audit immuable, pas de mutation directe. `order_payments` est dédié POS (split tender) et inadapté pour B2B (paiement multi-invoices, pas lié à 1 order). |
| **D2** | `customers.b2b_current_balance` reste un **cache colonne** mis à jour par les RPCs B2B (`create_b2b_order_v1` +amount, `record_b2b_payment_v1` -amount, `adjust_b2b_balance_v1` ±amount). Source-of-truth audit = ledger `b2b_payments` + table `orders` (B2B unpaid). | Lecture rapide pour KPI dashboard (1 SELECT vs SUM(orders) - SUM(payments)). Drift possible mais détectable via une RPC reconciliation future (S30 cleanup). REVOKE UPDATE direct côté table garantit qu'aucun chemin sauf RPC ne touche la colonne. |
| **D3** | Allocation paiement → factures **non précise** en S24. `b2b_payments.allocation` est un JSONB metadata listant les invoices ouvertes au moment du paiement (audit), mais pas une jointure forte. | Évite la complexité FIFO à plusieurs invoices avec arrondis. Allocation per-invoice = S26 (Comptable Cockpit) qui ajoutera un trigger ou une RPC dédiée. |
| **D4** | Nouveau RPC dédié `create_b2b_order_v1` séparé de `complete_order_with_payment_v9`. Path B2B = **unpaid order avec status `pending`** + gate `validate_b2b_credit_limit_v1`. Pas de paiement immédiat. | `complete_order_v9` est déjà 525 lignes complexe et tendu sur le path POS paid. Mélanger B2B unpaid casse les invariants split-tender. RPC dédié = scope contrôlé, JE distinct (DR AR_B2B / CR Sales). |
| **D5** | Vues `view_b2b_invoices` et `view_ar_aging` sont **SECURITY INVOKER** (pas DEFINER) et utilisent RLS de `orders` / `customers`. | Vues = surface read-only sans privilèges escaladés. La perm `customers.read` (déjà gatée pour B2BDashboardPage) suffit. |
| **D6** | `view_ar_aging` calcule `invoice_date = COALESCE(orders.created_at, now())` et bucket sur `CURRENT_DATE - invoice_date`. Buckets : `current` (0-30j), `31-60`, `61-90`, `90+`. Aggrégation par `customer_id`. | Modèle simple, lisible. Pas de `due_date` séparé en S24 (à faire S26 avec `payment_terms_days` qui existe déjà sur `customers`). |
| **D7** | JE émis par `create_b2b_order_v1` = **DR `AR_B2B`, CR `Sales` (+VAT split)**. JE émis par `record_b2b_payment_v1` = **DR `Cash`/`Bank`, CR `AR_B2B`**. Mappings `AR_B2B` ajouté à `accounting_mappings` via seed. | Conforme double-entry. `AR_B2B` = compte d'actif distinct des recettes cash, audit clair. |
| **D8** | Pas de nouvelle permission RBAC. `customers.read` couvre les vues. `pos.sale.create` autorise `create_b2b_order_v1` (le manager B2B est aussi cashier). `payments.record` (à créer si manquant) ou `customers.write` autorise `record_b2b_payment_v1`. `customers.write` requis pour `adjust_b2b_balance_v1`. | Pattern S22 : éviter la prolifération de perms micro-granulaires. À reconsidérer si UX terrain montre besoin de séparer rôles "encaisseur" vs "manager B2B". |

---

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────────┐
│  Wave 1.A — DB + RPC (Stream A, backend-dev)                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Migration _010 : b2b_payments table + RLS append-only    │   │
│  │ Migration _011 : view_b2b_invoices                       │   │
│  │ Migration _012 : view_ar_aging                           │   │
│  │ Migration _013 : REVOKE UPDATE customers.b2b_current_..  │   │
│  │ Migration _014 : seed AR_B2B mapping account             │   │
│  │ Migration _020 : RPC record_b2b_payment_v1               │   │
│  │ Migration _021 : RPC adjust_b2b_balance_v1               │   │
│  │ Migration _022 : RPC create_b2b_order_v1                 │   │
│  │ pgTAP b2b_foundation.test.sql (15 cas T1-T15)            │   │
│  │ Vitest live record-b2b-payment.test.ts (5 scénarios)     │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│                     ▼ sync gate (Wave 1 DONE)                  │
│                                                                 │
│  Wave 2 — UI BO (1 stream serial, coder)                        │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Types regen via MCP                                      │   │
│  │ Fix useB2bDashboard : aging proxy → view_ar_aging        │   │
│  │ Activer "+ New B2B Order" → modal CreateB2bOrderModal    │   │
│  │ Composant RecordB2bPaymentModal (réutilisable)           │   │
│  │ B2BPaymentsPage onglet "Reçu" → b2b_payments table       │   │
│  │ Hook useRecordB2bPayment, useCreateB2bOrder              │   │
│  │ i18n fr.json (~20 strings)                               │   │
│  │ BO smoke tests (3 cas)                                   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Wave 3 — Closeout (lead serial)                                │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ pnpm typecheck && build && test                          │   │
│  │ Status notes : 09-b2b TASK-09-001/002/006 DONE           │   │
│  │ Roadmap globale §Sessions + §Indicateurs                 │   │
│  │ INDEX §10 deviations                                     │   │
│  │ CLAUDE.md current session pointer → S24                  │   │
│  │ Commit + push + PR                                       │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Deliverables

### 4.1 DB

#### 4.1.1 Table `b2b_payments` (migration `_010`)

```sql
CREATE TABLE b2b_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_number  TEXT NOT NULL UNIQUE,           -- format "BP-YYYY-NNNN"
  customer_id     UUID NOT NULL REFERENCES customers(id),
  amount          NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  method          payment_method NOT NULL,         -- réutilise enum POS
  reference       TEXT,                            -- réf bancaire/chèque
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID NOT NULL REFERENCES user_profiles(id),
  idempotency_key UUID UNIQUE,                     -- replay safety
  allocation      JSONB NOT NULL DEFAULT '[]',     -- [{invoice_id,amount_applied},...] metadata audit
  journal_entry_id UUID REFERENCES journal_entries(id),
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX ON b2b_payments (customer_id, paid_at DESC);
CREATE INDEX ON b2b_payments (paid_at DESC);

-- RLS : authenticated read, no write
ALTER TABLE b2b_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY b2b_payments_read ON b2b_payments FOR SELECT TO authenticated USING (true);

-- DEFENSE-IN-DEPTH (S20 pattern) : revoke INSERT/UPDATE/DELETE explicit
REVOKE INSERT, UPDATE, DELETE ON b2b_payments FROM authenticated, anon, PUBLIC;

-- Sequence pour payment_number
CREATE SEQUENCE b2b_payment_seq START 1;
```

#### 4.1.2 Vue `view_b2b_invoices` (migration `_011`)

```sql
CREATE OR REPLACE VIEW view_b2b_invoices AS
SELECT
  o.id                AS invoice_id,
  o.order_number,
  o.customer_id,
  c.b2b_company_name,
  c.name              AS customer_name,
  o.total             AS invoice_total,
  o.created_at        AS invoice_date,
  o.paid_at,
  o.status            AS order_status,
  (CURRENT_DATE - o.created_at::date) AS age_days,
  -- B2B unpaid : status = 'pending' AND paid_at IS NULL
  (o.paid_at IS NULL) AS is_unpaid
FROM orders o
JOIN customers c ON c.id = o.customer_id
WHERE c.customer_type = 'b2b'
  AND c.deleted_at IS NULL;

-- SECURITY INVOKER (default) — respecte RLS de orders/customers
```

#### 4.1.3 Vue `view_ar_aging` (migration `_012`)

```sql
CREATE OR REPLACE VIEW view_ar_aging AS
WITH unpaid AS (
  SELECT
    customer_id,
    b2b_company_name,
    customer_name,
    invoice_total,
    age_days,
    CASE
      WHEN age_days <= 30 THEN 'current'
      WHEN age_days <= 60 THEN '31-60'
      WHEN age_days <= 90 THEN '61-90'
      ELSE '90+'
    END AS bucket
  FROM view_b2b_invoices
  WHERE is_unpaid = TRUE
)
SELECT
  customer_id,
  b2b_company_name,
  customer_name,
  bucket,
  COUNT(*)               AS invoice_count,
  SUM(invoice_total)     AS total_outstanding,
  MIN(age_days)          AS min_age_days,
  MAX(age_days)          AS max_age_days
FROM unpaid
GROUP BY customer_id, b2b_company_name, customer_name, bucket;
```

#### 4.1.4 REVOKE UPDATE direct sur `customers.b2b_current_balance` (migration `_013`)

```sql
-- Pattern S22 update_cost_price_v1 : interdire mutation directe
REVOKE UPDATE (b2b_current_balance) ON customers FROM authenticated, anon;
-- Les RPCs SECURITY DEFINER ci-dessous (create_b2b_order_v1, record_b2b_payment_v1,
-- adjust_b2b_balance_v1) sont les seuls chemins autorisés.
COMMENT ON COLUMN customers.b2b_current_balance IS
  'Cached AR outstanding. Mutable only via b2b_* RPCs (S24 pattern). REVOKE UPDATE on column for authenticated/anon.';
```

#### 4.1.5 Seed AR_B2B mapping (migration `_014`)

```sql
-- Vérifier si AR_B2B existe déjà ; sinon créer compte + mapping
INSERT INTO accounts (code, name, account_type, normal_balance)
VALUES ('1130', 'Accounts Receivable — B2B', 'asset', 'debit')
ON CONFLICT (code) DO NOTHING;

INSERT INTO accounting_mappings (mapping_key, account_id)
SELECT 'AR_B2B', id FROM accounts WHERE code = '1130'
ON CONFLICT (mapping_key) DO NOTHING;
```

#### 4.1.6 RPC `record_b2b_payment_v1` (migration `_020`)

Signature :
```sql
record_b2b_payment_v1(
  p_customer_id    UUID,
  p_amount         NUMERIC,
  p_method         payment_method,
  p_reference      TEXT DEFAULT NULL,
  p_paid_at        TIMESTAMPTZ DEFAULT now(),
  p_notes          TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
```

Comportement :
1. Auth check (`auth.uid()`, profile).
2. Perm check : `customers.write` (manager+).
3. Idempotency : si `p_idempotency_key` existe dans `b2b_payments` → return existing row.
4. Validate : customer existe, customer_type='b2b', amount > 0.
5. FOR UPDATE `customers` row.
6. Snapshot allocation : SELECT invoices unpaid du customer (oldest first), build JSONB `allocation = [{invoice_id, amount_applied},...]` (best-effort FIFO, pas atomique sur la table orders).
7. Crée JE : DR `Cash` (ou Bank si method=transfer), CR `AR_B2B`.
8. INSERT b2b_payments avec sequence `BP-YYYY-NNNN`.
9. UPDATE `customers.b2b_current_balance -= amount` (CHECK >= 0 ; si dépasse, RAISE `overpayment_not_allowed`).
10. INSERT `audit_logs` (`b2b.payment.recorded`).
11. RETURN `{payment_id, payment_number, allocation, je_id, customer_balance_after}`.

#### 4.1.7 RPC `adjust_b2b_balance_v1` (migration `_021`)

Signature :
```sql
adjust_b2b_balance_v1(
  p_customer_id UUID,
  p_delta       NUMERIC,    -- positif (charge) ou négatif (crédit)
  p_reason      TEXT,        -- REQUIRED
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
```

Comportement :
1. Auth + perm `customers.write`.
2. Validate customer_type='b2b', reason NOT NULL.
3. FOR UPDATE customers row.
4. Pas de JE émis (admin adjustment hors comptabilité — manager assumes the audit responsibility).
5. UPDATE `customers.b2b_current_balance += p_delta` (CHECK >= 0).
6. INSERT audit_logs (`b2b.balance.adjusted` + payload reason).
7. RETURN `{customer_id, balance_before, balance_after, delta}`.

#### 4.1.8 RPC `create_b2b_order_v1` (migration `_022`)

Signature :
```sql
create_b2b_order_v1(
  p_customer_id    UUID,
  p_items          JSONB,         -- [{product_id, quantity, unit_price}]
  p_notes          TEXT DEFAULT NULL,
  p_delivery_date  DATE DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS JSONB
```

Comportement :
1. Auth + perm `pos.sale.create`.
2. Validate customer_type='b2b', items non-vide.
3. Idempotency check.
4. Snapshot total = SUM(qty × unit_price).
5. **Call `validate_b2b_credit_limit_v1(p_customer_id, total)`** → si `allowed=false`, RAISE `credit_limit_exceeded` + payload.
6. Crée order : `order_type='b2b'`, `status='pending'`, `paid_at=NULL`.
7. Crée order_items (réutilise pattern complete_order_v9 items loop).
8. Décrémente stock via `record_stock_movement_v1` (movement_type='sale', `unit` resolved).
9. Crée JE : DR `AR_B2B`, CR `Sales` (+ VAT split via `accounting_mappings`).
10. UPDATE `customers.b2b_current_balance += total`.
11. INSERT audit_logs (`b2b.order.created`).
12. RETURN `{order_id, order_number, total, credit_after}`.

### 4.2 Tests DB

#### 4.2.1 pgTAP `supabase/tests/b2b_foundation.test.sql` (15 cas)

- T1 : `b2b_payments` table existe + RLS active + REVOKE INSERT.
- T2 : `view_b2b_invoices` retourne uniquement les orders B2B.
- T3 : `view_ar_aging` buckets correctement par age_days.
- T4 : `record_b2b_payment_v1` happy path → balance decrémentée + payment inséré + JE émis.
- T5 : `record_b2b_payment_v1` idempotency replay.
- T6 : `record_b2b_payment_v1` overpayment → RAISE.
- T7 : `record_b2b_payment_v1` non-b2b customer → RAISE.
- T8 : `adjust_b2b_balance_v1` happy path positive delta.
- T9 : `adjust_b2b_balance_v1` happy path negative delta.
- T10 : `adjust_b2b_balance_v1` underflow → RAISE.
- T11 : `create_b2b_order_v1` happy path → AR augmenté + JE + stock décrémenté.
- T12 : `create_b2b_order_v1` credit limit exceeded → RAISE avec payload `would_exceed_by`.
- T13 : `create_b2b_order_v1` idempotency replay.
- T14 : REVOKE UPDATE customers.b2b_current_balance : `UPDATE customers SET b2b_current_balance=X` en tant qu'authenticated → RAISE permission denied.
- T15 : `validate_b2b_credit_limit_v1` est bien câblé dans `create_b2b_order_v1` (sanity test : forge un customer avec limite, tente order au-dessus → erreur).

#### 4.2.2 Vitest live `supabase/tests/functions/record-b2b-payment.test.ts` (5 scénarios)

- S1 : happy path single payment, balance updated.
- S2 : idempotency replay (same UUID 2 fois).
- S3 : create order then record payment full → balance = 0.
- S4 : overpayment rejected.
- S5 : adjust_b2b_balance positive + negative chain.

### 4.3 UI BO

#### 4.3.1 Fix `useB2bDashboard` aging proxy

Avant (`useB2bDashboard.ts:131-149`) : calcul aging via `last_visit_at`.

Après : 2 options :
- **Option A (retenue)** : ajouter un 2e useQuery qui fait `supabase.from('view_ar_aging').select('*')` et merger dans le data shape. Plus simple, pas de RPC dédiée.
- Option B : créer une RPC `get_b2b_dashboard_v1` qui agrège tout. Refactor plus large, deferred S26+.

Concrètement :
```ts
const { data: aging } = await supabase
  .from('view_ar_aging')
  .select('customer_id, bucket, invoice_count, total_outstanding, max_age_days');
// rebuild B2bAgingBucket[] from rows
```

#### 4.3.2 Activer "+ New B2B Order"

Component : `CreateB2bOrderModal.tsx` (CenterModal pattern S22).
- Step 1 : sélection customer B2B (autocomplete sur customers filtré customer_type='b2b').
- Step 2 : items (réutilise `OrderItemsForm` ou variant simple : product picker + quantity + unit_price).
- Step 3 : revue + Submit → call `create_b2b_order_v1`.
- En cas de `credit_limit_exceeded` (P0001 + payload) : afficher alerte rouge avec `would_exceed_by` + bouton "Override admin (TODO)" (deviation S24+).
- Sur succès → toast + invalidate `b2b-dashboard` query + close modal.

Le bouton ligne 79-86 perd `disabled` + `setInfo` ; gagne `onClick={() => setCreateOpen(true)}`.

#### 4.3.3 B2BPaymentsPage onglet "Reçu"

Hook `useB2bPaymentsReceived(period: 'today'|'week'|'month'|'all')` → SELECT b2b_payments.
Onglet "Reçu" affiche : table colonnes payment_number / customer / amount / method / paid_at / reference.

Bouton "+ Record Payment" → ouvre `RecordB2bPaymentModal` (form simple, call `record_b2b_payment_v1`).

#### 4.3.4 Smoke tests

Fichier : `apps/backoffice/src/features/btob/__tests__/b2b-foundation.smoke.test.tsx` (3 cas)
- Renders B2BDashboardPage with mocked view_ar_aging data → buckets affichent corrects.
- "+ New B2B Order" button enabled, click opens CreateB2bOrderModal.
- RecordB2bPaymentModal submit calls record_b2b_payment_v1 mutation.

---

## 5. Tests

(Cf §4.2 pour pgTAP + Vitest live ; §4.3.4 pour BO smoke.)

---

## 6. Migrations summary

| # | Filename | Type |
|---|----------|------|
| 010 | `20260601000010_create_b2b_payments_table.sql` | CREATE TABLE |
| 011 | `20260601000011_create_view_b2b_invoices.sql` | CREATE VIEW |
| 012 | `20260601000012_create_view_ar_aging.sql` | CREATE VIEW |
| 013 | `20260601000013_revoke_update_b2b_current_balance.sql` | REVOKE |
| 014 | `20260601000014_seed_ar_b2b_mapping.sql` | SEED |
| 020 | `20260601000020_create_record_b2b_payment_v1.sql` | RPC CREATE |
| 021 | `20260601000021_create_adjust_b2b_balance_v1.sql` | RPC CREATE |
| 022 | `20260601000022_create_b2b_order_v1.sql` | RPC CREATE |

8 migrations totales. Bloc `20260601000010..022` réservé.

---

## 7. Risques

| Risque | Mitigation |
|--------|------------|
| `accounting_mappings.AR_B2B` peut déjà exister sous un autre nom dans le V3 schema. | Pre-flight check obligatoire : `SELECT * FROM accounting_mappings WHERE mapping_key ILIKE '%AR%'`. Si présent, réutiliser. Sinon créer compte 1130 + mapping. |
| `b2b_current_balance` peut avoir des rows existantes avec valeurs incohérentes (drift S14-S23). | Pas de reconciliation en S24 (out of scope). Status note explicite "valeurs peuvent diverger pré-S24, reconciliation backlog S30". |
| `customers.customer_type` enum peut ne pas exister sous ce nom. | Pre-flight `SELECT typname FROM pg_type WHERE typname LIKE '%customer%'`. |
| `validate_b2b_credit_limit_v1` raise `customer_not_found` (P0002) qui n'est pas un crédit-limit error → masque sémantique. | `create_b2b_order_v1` catch P0002 et re-RAISE comme `customer_invalid`. |
| Test pgTAP T14 (REVOKE UPDATE colonne) peut échouer si l'env de test pgTAP run en role superuser. | Set role explicit dans le test : `SET LOCAL ROLE authenticated; ... ROLLBACK;`. |
| `b2b_payments.allocation` JSONB en metadata seulement peut tromper un futur dev qui croit que c'est la source de vérité. | COMMENT ON COLUMN explicite : "Metadata audit only. Source-of-truth allocation = b2b_current_balance delta + future allocation_table S26+". |
| L'activation de "+ New B2B Order" sans flux complet (livraisons multiples, edit, clone) peut créer des order rows orphelins. | Status `pending` clairement marqué ; pas d'auto-paiement ; UI pré-step explicite "Cette commande sera ajoutée à l'encours du client. Paiement à enregistrer plus tard via /b2b/payments". |
| Mismatch entre POS `complete_order_v9` qui ne check pas credit B2B et `create_b2b_order_v1` qui le check → un POS cashier peut créer un sale immédiat à un customer B2B sans gate. | Hors scope S24. Documenter en deviation. Le path POS reste valide pour cash-and-carry B2B. |

---

## 8. Acceptance criteria

- [ ] 8 migrations appliquées sur V3 dev cloud `ikcyvlovptebroadgtvd`.
- [ ] pgTAP `b2b_foundation.test.sql` 15/15 pass.
- [ ] Vitest live `record-b2b-payment.test.ts` 5/5 pass.
- [ ] BO smoke `b2b-foundation.smoke.test.tsx` 3/3 pass.
- [ ] `pnpm typecheck && pnpm build && pnpm test --concurrency=1` global green.
- [ ] B2BDashboardPage : aging KPI affiche les vrais buckets depuis `view_ar_aging`.
- [ ] B2BDashboardPage : "+ New B2B Order" enabled + ouvre CreateB2bOrderModal.
- [ ] B2BPaymentsPage : onglet "Reçu" liste les rows `b2b_payments`.
- [ ] Doc référence `09-b2b-wholesale.md` : status note S24 ajoutée.
- [ ] Backlog `09-b2b-wholesale.md` : TASK-09-001 / 09-002 / 09-006 marqués DONE.
- [ ] CLAUDE.md `## Active Workplan` : current session pointer = S24.
- [ ] PR créée et lien retourné.

---
