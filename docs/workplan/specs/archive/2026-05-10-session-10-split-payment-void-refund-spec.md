# The Breakery — Session 10 Spec : Split Payment + Item-Cancel-After-Send + Post-Checkout Void/Refund

> **Trace historique** : ce fichier documente une session de travail datée. Le fond reste l'enregistrement de cette date. Seules les références de chemin ont été alignées sur la nouvelle structure (voir [`../../README.md`](../../README.md)).
> **Last refreshed** : 2026-05-13
> **Modules de référence associés** : [`../../reference/04-modules/02-pos-cart-orders.md`](../../reference/04-modules/02-pos-cart-orders.md), [`../../reference/04-modules/03-payments-split.md`](../../reference/04-modules/03-payments-split.md), [`../../reference/04-modules/02b-orders.md`](../../../reference/04-modules/02b-orders.md).

> **Date** : 2026-05-10
> **Auteur** : guichduh33@gmail.com (suite session 9)
> **Statut** : Approuvé pour implémentation
> **Cible** : 3 features liées par schema commun — multi-tender payments à la création d'order, manager-PIN cancel d'item après send_items_to_kitchen (avec realtime KDS notify), full void + partial line refund post-checkout (per-tender refund routing, current-shift only).

---

## 0. Contexte

Sessions 1–9 ont livré le pipeline POS complet : auth PIN, shift, cart, modifiers, customers + loyalty, tables, tablette, discounts session 6, customer categories + combos session 7, perf-debt session 8, et promotions auto session 9. Session 10 ferme la boucle "argent" :

1. **Split payment** — un client paie 60k cash + 40k card sur la même commande. Ouvrir `order_payments` (déjà 1:N en DB depuis session 1) à la N-tender insertion via RPC v8.
2. **Item-cancel-after-send** — un cashier veut retirer un item dont la kitchen a déjà reçu le ticket. Manager-PIN gate, flag `is_cancelled` sur `order_items`, broadcast realtime au KDS pour stop-cooking.
3. **Post-checkout void/refund** — full void d'une commande payée (status `paid → voided`), ou refund partiel ligne-par-ligne avec routage per-tender. Restore stock + loyalty (earned déduit, redemption restored on full void only).

Cette session **ne touche pas** :
- Cross-shift refund (un order voidé/refund hors du shift de paiement) — session 11+
- Pro-rata des manual discounts / promotions sur partial refund (line refund = line gross retourné, le reste de l'order garde ses discounts intacts)
- Tablet `pay_existing_order` split-pay — session 11
- Receipt physique imprimé pour refund — session 15 hub-printing
- Refund analytics / reports — session 14
- Coupon refund (refund déclenche un store credit code) — session 16+

## 1. Décisions actées (16 — déjà ratifiées via brainstorming 2026-05-10)

| # | Décision | Choix |
|---|---|---|
| **SP1** | Split payment data model | Extend RPC `complete_order_with_payment` v7 → v8 : param `p_payments JSONB DEFAULT NULL`. Si NULL → fallback sur `p_payment` (single object, backwards-compat v7). Si NON-NULL → `jsonb_array` de 1-5 entries `{method, amount, cash_received?, change_given?, reference?}` |
| **SP2** | Cash-with-change rule | Server enforce : seul le DERNIER tender peut avoir `cash_received > amount` (i.e., generate change). Tenders intermédiaires : `cash_received` IS NULL OU `= amount`. RAISE check_violation si violation |
| **SP3** | Tender count cap | DB CHECK sur RPC : `array_length(p_payments) BETWEEN 1 AND 5`. Sum(amounts) doit `= v_total` (à la roupie près) |
| **SP4** | UI flow | Sequential tender (Square pattern). PaymentTerminal accumule un `tenders[]` state. Méthode + amount input + `[Add Tender]`. Quand `Σ amounts = total` → bouton bascule en `[✓ Process Payment]` qui flush tout |
| **SP5** | Backwards compat | RPC v8 accepte v7 signature : `p_payment JSONB` single (auto-wrap en array de 1) — préserve `pay_existing_order` v4 (tablet) et tout autre call-site. v8 raise si BOTH `p_payment` ET `p_payments` sont fournis |
| **IC1** | Item-cancel state | `order_items` ALTER : `is_cancelled BOOL DEFAULT false`, `cancelled_at TIMESTAMPTZ`, `cancelled_reason TEXT NOT NULL CHECK (length≥3)` (set seulement si `is_cancelled=true`), `cancelled_by UUID FK user_profiles` |
| **IC2** | Cancel scope | RPC raise check_violation si : (a) `orders.status != 'draft'` (paid orders → use refund flow), (b) `order_items.kitchen_status = 'served'` (already given to customer, refund flow), (c) `order_items.is_cancelled` already true |
| **IC3** | Cancel RPC | NEW `cancel_order_item_rpc(p_order_item_id, p_reason, p_authorized_by_profile_id)`. Verify `has_permission(p_authorized_by, 'pos.sale.cancel_item')`. UPDATE le flag, recompute `orders.subtotal/tax/total` en excluant `is_cancelled=true` rows, INSERT `audit_logs` action `'order.cancel_item'` avec metadata |
| **IC4** | KDS notify | Edge Function `cancel-item` appelle le RPC, puis broadcast Postgres realtime `kds:cancellations` channel `{order_item_id, order_number, name, dispatch_station, action:'cancelled'}`. KDS hook subscribed flips la card visuelle (badge red `CANCELLED`, items disabled). Aucune écriture DB côté KDS |
| **IC5** | Stock + loyalty on item-cancel | Order encore `draft` → no stock_movement encore inséré (RPC `complete_order` insère stock à `paid`), no loyalty earned. Cancel zero-side-effect au-delà du recompute totals |
| **VR1** | Void = whole order, status flip | NEW RPC `void_order_rpc(p_order_id, p_reason, p_authorized_by_profile_id)`. Verify `pos.sale.void`. Verify `orders.session_id = current_open_pos_session.id` (window). UPDATE `status='voided'`, `voided_at=now()`, `voided_by`, `void_reason`. Trigger session 3 auto-reverse JE. Loop `order_items` non-cancelled : INSERT reversal `stock_movements` (`movement_type='sale_void'`, `quantity=+qty`), UPDATE `products.current_stock += qty`. Si `customer_id IS NOT NULL` : INSERT reversal `loyalty_transactions` (`transaction_type='refund'`, `points = -loyalty_points_earned`), UPDATE `customers.lifetime_points -= earned`, `loyalty_points -= earned`. Si `loyalty_redemption_amount > 0` : restore points (`UPDATE customers.loyalty_points += loyalty_points_redeemed`, INSERT `loyalty_transactions` type `'refund'` positive `points`) |
| **VR2** | Refund = partial, new entity | NEW tables `refunds` + `refund_lines` + `refund_payments`. `refund_number` format `R-XXXX` via nouveau `refund_sequences`. Order garde `status='paid'`. Multiple partial refunds par order autorisés tant que `Σ refunds.total ≤ orders.total` |
| **VR3** | Refund cap rule | DB constraint au niveau RPC `refund_order_rpc` : pre-check `(SELECT COALESCE(SUM(total),0) FROM refunds WHERE order_id=...) + p_refund_total ≤ orders.total`. RAISE check_violation `refund_exceeds_order_total` |
| **VR4** | Tender routing | Cashier pickle per-tender split. RPC valide chaque `refund_payments.amount ≤ (SUM(order_payments.amount WHERE method=X) − SUM(prior_refund_payments.amount WHERE method=X))`. RAISE `refund_exceeds_method_paid` |
| **VR5** | Stock + loyalty on refund | Stock : pour chaque `refund_lines.{order_item_id, qty}` → INSERT reversal `stock_movements` (`movement_type='sale_void'`, qty=+refund_qty), UPDATE `products.current_stock`. Loyalty earned : pro-rata `points_to_deduct = floor(refund.total * loyalty_multiplier_at_order_time / 1000)` (use `orders.loyalty_points_earned / orders.total` ratio for safety), UPDATE customers + INSERT loyalty_transaction `'refund'` negative. Loyalty redemption : **NOT restored** sur partial refund (acquis du décision V0). Promotions audit row : non touché |
| **VR6** | Window | RPC raise `cross_shift_refund_not_allowed` (P0011) si `orders.session_id != current_open_pos_session.id`. Cas edge : si pas de shift ouvert → P0001 not authenticated context |
| **VR7** | RBAC perms | NEW `pos.sale.refund` (partial refund), NEW `pos.sale.cancel_item` (cancel-after-send). EXISTING `pos.sale.void` (full void, déjà seedé). Les 3 sur MANAGER+ADMIN+SUPER_ADMIN. `payments.process` (multi-tender) : reste sur CASHIER+ (pas de nouveau perm) |

**JE handling** :
- Void utilise le trigger session 3 existant (`paid → voided` reverse JE).
- Refund insère un NEW JE via NEW trigger `fn_create_je_for_refund` AFTER INSERT ON refunds. Pattern : DR Sales (4100) `refund.total - tax_refunded`, DR PB1 (2110) `tax_refunded`, CR Cash/Card per `refund_payments` rows (sum to `total`). `reference_type='refund'`, `reference_id=refund.id`, `entry_number='JE-REF-' || refund_number`.

**Audit** :
- `audit_logs` insère `'order.void'`, `'order.refund'`, `'order.cancel_item'` actions avec metadata détaillée (manager-PIN authorized_by, original totals, reason).

---

## 2. Stack technique additions

| Addition | Raison |
|---|---|
| Aucun nouveau package | Tout via Supabase + react-query + Zod + lucide existants |
| domain `packages/domain/src/payments/splitTender.ts` | validateTenders, computeRemaining, isLastTenderCashAllowed, sumTenders |
| domain `packages/domain/src/refunds/` | computeRefund (sub+tax), validateRefundCap, validateTenderRouting, types |
| ui `packages/ui/src/components/TenderRow.tsx` | Display 1 tender chip (method icon + amount + remove X) dans PaymentTerminal |
| ui `packages/ui/src/components/TenderListBuilder.tsx` | Wrapper avec liste + add button + remaining display |
| ui `packages/ui/src/components/RefundLineRow.tsx` | Selectable line dans RefundOrderModal (checkbox + qty stepper, max=qty − already_refunded) |
| ui `packages/ui/src/components/RefundTenderSplitter.tsx` | Per-method split inputs |
| ui `packages/ui/src/components/RefundReceiptModal.tsx` | SuccessModal-equivalent post-refund (REFUND header gold sur red) |
| edge `supabase/functions/cancel-item/` | POST verify-pin → call cancel_order_item_rpc → broadcast realtime |
| edge `supabase/functions/void-order/` | POST verify-pin → call void_order_rpc |
| edge `supabase/functions/refund-order/` | POST verify-pin → call refund_order_rpc |
| edge MODIFY `supabase/functions/process-payment/` | Forward `p_payments` to v8 RPC (also pass `p_payment` for legacy) |

---

## 3. Schéma DB — additions

### 3.1 Migrations à créer (résumé)

```
20260512000001_extend_order_payments_reference.sql      # ALTER add reference TEXT
20260512000002_extend_order_items_cancel.sql            # ALTER add 4 cancel cols + index
20260512000003_extend_orders_void_columns.sql           # ALTER add voided_at/by/reason
20260512000004_init_refunds.sql                         # 3 tables + indexes + RLS + refund_sequences
20260512000005_init_refund_je_trigger.sql               # AFTER INSERT trg fn_create_je_for_refund
20260512000006_extend_complete_order_rpc_v8.sql         # p_payments JSONB
20260512000007_create_cancel_order_item_rpc.sql         # manager-PIN cancel
20260512000008_create_void_order_rpc.sql                # full void with reversals
20260512000009_create_refund_order_rpc.sql              # partial refund with line+tender split
20260512000010_seed_refund_perms.sql                    # 2 new perms + has_permission v4
```

### 3.2 ALTER tables

```sql
-- 20260512000001
ALTER TABLE order_payments
  ADD COLUMN reference TEXT;  -- card auth ID, qris ref, etc. NULL pour cash

-- 20260512000002
ALTER TABLE order_items
  ADD COLUMN is_cancelled    BOOLEAN     NOT NULL DEFAULT false,
  ADD COLUMN cancelled_at    TIMESTAMPTZ,
  ADD COLUMN cancelled_reason TEXT,
  ADD COLUMN cancelled_by    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD CONSTRAINT chk_order_items_cancel_consistency CHECK (
    (is_cancelled = false  AND cancelled_at IS NULL AND cancelled_reason IS NULL AND cancelled_by IS NULL)
    OR (is_cancelled = true AND cancelled_at IS NOT NULL AND length(cancelled_reason) >= 3 AND cancelled_by IS NOT NULL)
  );

CREATE INDEX idx_order_items_cancelled
  ON order_items(order_id) WHERE is_cancelled = true;

-- 20260512000003
ALTER TABLE orders
  ADD COLUMN voided_at    TIMESTAMPTZ,
  ADD COLUMN voided_by    UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN void_reason  TEXT,
  ADD CONSTRAINT chk_orders_void_consistency CHECK (
    (status != 'voided' AND voided_at IS NULL AND voided_by IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL AND length(void_reason) >= 3)
  );
```

### 3.3 refunds + refund_lines + refund_payments + refund_sequences

```sql
-- 20260512000004

CREATE TABLE refund_sequences (
  date          DATE PRIMARY KEY,
  last_number   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE refunds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_number   TEXT NOT NULL UNIQUE,            -- 'R-XXXX' format, scoped per-day
  order_id        UUID NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  session_id      UUID NOT NULL REFERENCES pos_sessions(id) ON DELETE RESTRICT,
  total           DECIMAL(14,2) NOT NULL CHECK (total > 0),
  tax_refunded    DECIMAL(14,2) NOT NULL DEFAULT 0 CHECK (tax_refunded >= 0),
  reason          TEXT NOT NULL CHECK (length(reason) >= 3),
  refunded_by     UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  authorized_by   UUID NOT NULL REFERENCES user_profiles(id) ON DELETE RESTRICT,
  is_full_void    BOOLEAN NOT NULL DEFAULT false,  -- true si créé via void_order_rpc (audit shortcut)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refunds_order ON refunds(order_id, created_at DESC);
CREATE INDEX idx_refunds_session ON refunds(session_id, created_at DESC);

CREATE TABLE refund_lines (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id       UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  order_item_id   UUID NOT NULL REFERENCES order_items(id) ON DELETE RESTRICT,
  qty             DECIMAL(14,3) NOT NULL CHECK (qty > 0),
  amount          DECIMAL(14,2) NOT NULL CHECK (amount >= 0),
  UNIQUE (refund_id, order_item_id)
);

CREATE INDEX idx_refund_lines_order_item ON refund_lines(order_item_id);

CREATE TABLE refund_payments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  refund_id       UUID NOT NULL REFERENCES refunds(id) ON DELETE CASCADE,
  method          payment_method NOT NULL,
  amount          DECIMAL(14,2) NOT NULL CHECK (amount > 0),
  reference       TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_refund_payments_refund ON refund_payments(refund_id);
CREATE INDEX idx_refund_payments_method ON refund_payments(method, created_at DESC);

-- RLS : authenticated read only ; INSERT only via SECURITY DEFINER RPCs (no INSERT policy)
ALTER TABLE refunds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_lines     ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_payments  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON refunds         FOR SELECT USING (is_authenticated());
CREATE POLICY "auth_read" ON refund_lines    FOR SELECT USING (is_authenticated());
CREATE POLICY "auth_read" ON refund_payments FOR SELECT USING (is_authenticated());
```

### 3.4 fn_create_je_for_refund trigger

```sql
-- 20260512000005

CREATE OR REPLACE FUNCTION fn_create_je_for_refund()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_je_id        UUID;
  v_entry_no     TEXT;
  v_cash_id      UUID;
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_net          DECIMAL(14,2);
  v_pay          RECORD;
BEGIN
  v_net := NEW.total - NEW.tax_refunded;

  SELECT id INTO v_cash_id  FROM accounts WHERE code = '1110' AND is_active;
  SELECT id INTO v_sales_id FROM accounts WHERE code = '4100' AND is_active;
  SELECT id INTO v_pb1_id   FROM accounts WHERE code = '2110' AND is_active;

  IF v_cash_id IS NULL OR v_sales_id IS NULL OR v_pb1_id IS NULL THEN
    RAISE NOTICE 'fn_create_je_for_refund: missing accounts (1110/%, 4100/%, 2110/%)',
      v_cash_id, v_sales_id, v_pb1_id;
    RETURN NEW;
  END IF;

  v_entry_no := 'JE-REF-' || NEW.refund_number;

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, NEW.created_at::date,
    'Refund ' || NEW.refund_number || ' (order ' ||
      (SELECT order_number FROM orders WHERE id = NEW.order_id) || ')',
    'refund', NEW.id,
    'posted', NEW.total, NEW.total, NEW.refunded_by
  ) RETURNING id INTO v_je_id;

  -- DR side : reverse the sale (sales debited back, PB1 debited back)
  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_sales_id, v_net,            0, 'Sales revenue (refund)'),
    (v_je_id, v_pb1_id,   NEW.tax_refunded, 0, 'PB1 payable (refund)');

  -- CR side : credit the original payment account(s) per refund_payments split.
  -- v1 : all methods route to '1110' Cash account (multi-method posting deferred to session 14 reports).
  FOR v_pay IN SELECT method, amount FROM refund_payments WHERE refund_id = NEW.id LOOP
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cash_id, 0, v_pay.amount,
      'Cash refund (' || v_pay.method::TEXT || ')');
  END LOOP;

  RETURN NEW;
END $$;

CREATE TRIGGER trg_create_je_for_refund
  AFTER INSERT ON refunds
  FOR EACH ROW
  EXECUTE FUNCTION fn_create_je_for_refund();

COMMENT ON FUNCTION fn_create_je_for_refund() IS
  'Auto JE on refund insert. DR Sales (net) + DR PB1 (tax) / CR Cash per refund_payments. v1: all methods → 1110.';
```

> **Note** : le trigger se fire AFTER refund_payments est inséré (les RPC `void_order_rpc` et `refund_order_rpc` insèrent refunds APRÈS refund_payments via DEFERRABLE pattern, OU on inverse l'ordre : insert refunds d'abord puis refund_payments puis refresh JE). **Choix d'implémentation** : insert refund + refund_lines + refund_payments dans cet ordre, puis trigger refait `SELECT FROM refund_payments` qui voit les rows (transaction atomique). C'est valide.

### 3.5 RPC v8 complete_order_with_payment

```sql
-- 20260512000006

DO $drop$
DECLARE _r RECORD;
BEGIN
  FOR _r IN SELECT oid::regprocedure AS sig FROM pg_proc
    WHERE proname = 'complete_order_with_payment' AND pronamespace = 'public'::regnamespace
  LOOP
    EXECUTE 'DROP FUNCTION ' || _r.sig::text || ' CASCADE';
  END LOOP;
END $drop$;

CREATE OR REPLACE FUNCTION complete_order_with_payment(
  p_session_id              UUID,
  p_order_type              order_type,
  p_items                   JSONB,
  p_payment                 JSONB             DEFAULT NULL,    -- v7 single-tender (legacy)
  p_idempotency_key         UUID              DEFAULT NULL,
  p_customer_id             UUID              DEFAULT NULL,
  p_loyalty_points_redeemed INTEGER           DEFAULT 0,
  p_table_number            TEXT              DEFAULT NULL,
  p_discount_amount         DECIMAL(14,2)     DEFAULT 0,
  p_discount_type           TEXT              DEFAULT NULL,
  p_discount_value          DECIMAL(14,2)     DEFAULT NULL,
  p_discount_reason         TEXT              DEFAULT NULL,
  p_discount_authorized_by  UUID              DEFAULT NULL,
  p_loyalty_multiplier      DECIMAL(4,2)      DEFAULT 1.0,
  p_promotions              JSONB             DEFAULT '[]'::jsonb,
  p_payments                JSONB             DEFAULT NULL    -- v8 multi-tender (new)
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  -- ... (all v7 declarations)
  v_payments_arr     JSONB;
  v_payment_entry    JSONB;
  v_pay_count        INTEGER;
  v_pay_idx          INTEGER;
  v_pay_sum          DECIMAL(14,2) := 0;
  v_pay_method       payment_method;
  v_pay_amount       DECIMAL(14,2);
  v_pay_cash_recv    DECIMAL(14,2);
  v_pay_change       DECIMAL(14,2);
  v_pay_reference    TEXT;
  v_total_change     DECIMAL(14,2) := 0;
BEGIN
  -- ... (auth, profile, perm, idempotency, session, redemption, items_total, promotions checks: identique v7)

  -- v8 — normalize payments input
  IF p_payments IS NOT NULL AND p_payment IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot supply both p_payment and p_payments' USING ERRCODE = 'check_violation';
  END IF;
  IF p_payments IS NOT NULL THEN
    v_payments_arr := p_payments;
  ELSIF p_payment IS NOT NULL THEN
    v_payments_arr := jsonb_build_array(p_payment);
  ELSE
    RAISE EXCEPTION 'Must supply p_payment or p_payments' USING ERRCODE = 'check_violation';
  END IF;

  v_pay_count := jsonb_array_length(v_payments_arr);
  IF v_pay_count < 1 OR v_pay_count > 5 THEN
    RAISE EXCEPTION 'Invalid tender count: % (must be 1..5)', v_pay_count
      USING ERRCODE = 'check_violation';
  END IF;

  -- Validate sum + cash overpay rule
  v_pay_idx := 0;
  FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP
    v_pay_idx     := v_pay_idx + 1;
    v_pay_method  := (v_payment_entry->>'method')::payment_method;
    v_pay_amount  := (v_payment_entry->>'amount')::DECIMAL(14,2);
    v_pay_cash_recv := NULLIF(v_payment_entry->>'cash_received','')::DECIMAL(14,2);
    v_pay_change  := NULLIF(v_payment_entry->>'change_given','')::DECIMAL(14,2);

    IF v_pay_amount IS NULL OR v_pay_amount <= 0 THEN
      RAISE EXCEPTION 'Tender %: amount must be > 0', v_pay_idx USING ERRCODE = 'check_violation';
    END IF;

    -- Cash overpay rule (SP2) : only the LAST tender may have cash_received > amount.
    IF v_pay_cash_recv IS NOT NULL AND v_pay_cash_recv > v_pay_amount AND v_pay_idx < v_pay_count THEN
      RAISE EXCEPTION 'Tender % (intermediate): cash_received cannot exceed amount', v_pay_idx
        USING ERRCODE = 'check_violation';
    END IF;

    v_pay_sum := v_pay_sum + v_pay_amount;
    IF v_pay_change IS NOT NULL THEN
      v_total_change := v_total_change + v_pay_change;
    END IF;
  END LOOP;

  IF v_pay_sum != v_total THEN
    RAISE EXCEPTION 'Sum of tender amounts (%) != order total (%)', v_pay_sum, v_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- ... (INSERT order : identique v7)

  -- Replace single payment INSERT with loop
  FOR v_payment_entry IN SELECT * FROM jsonb_array_elements(v_payments_arr) LOOP
    INSERT INTO order_payments (order_id, method, amount, cash_received, change_given, reference)
    VALUES (
      v_order_id,
      (v_payment_entry->>'method')::payment_method,
      (v_payment_entry->>'amount')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'cash_received','')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'change_given','')::DECIMAL(14,2),
      NULLIF(v_payment_entry->>'reference','')
    );
  END LOOP;

  -- ... (loyalty, promotion_applications, audit, RETURN : identique v7 ;
  --       audit metadata adds 'tender_count' = v_pay_count, 'payment_methods' = jsonb_agg(distinct method))

  RETURN jsonb_build_object(
    -- ... (v7 fields)
    'change_given', v_total_change   -- somme cumulée (v8 ; v7 retournait juste p_payment->>'change_given')
  );
END $$;
```

> **Iso-comportement v7** : si `p_payment` fourni seul (et `p_payments=NULL`) → wrap en array de 1 → boucle 1 itération → rigoureusement identique v7. Tablet `pay_existing_order` v4 reste compatible.

### 3.6 RPC cancel_order_item_rpc

```sql
-- 20260512000007

CREATE OR REPLACE FUNCTION cancel_order_item_rpc(
  p_order_item_id UUID,
  p_reason        TEXT,
  p_authorized_by UUID    -- profile_id du manager dont le PIN vient d'être vérifié par l'EF
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order_id       UUID;
  v_order_status   order_status;
  v_kitchen_status TEXT;
  v_is_cancelled   BOOLEAN;
  v_dispatch       TEXT;
  v_order_number   TEXT;
  v_name           TEXT;
  v_new_subtotal   DECIMAL(14,2);
  v_new_tax        DECIMAL(14,2);
  v_new_total      DECIMAL(14,2);
  v_tax_rate       DECIMAL(5,4);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;

  -- Cashier or higher must be the caller, but the cancel ACTION needs manager perm via authorized_by
  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.cancel_item') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.cancel_item'
      USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT oi.order_id, o.status, oi.kitchen_status, oi.is_cancelled,
         oi.dispatch_station, o.order_number, oi.name_snapshot
    INTO v_order_id, v_order_status, v_kitchen_status, v_is_cancelled,
         v_dispatch, v_order_number, v_name
    FROM order_items oi JOIN orders o ON o.id = oi.order_id
    WHERE oi.id = p_order_item_id
    FOR UPDATE;

  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order_status != 'draft' THEN
    RAISE EXCEPTION 'Cannot cancel item on % order (use refund flow)', v_order_status
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_kitchen_status = 'served' THEN
    RAISE EXCEPTION 'Cannot cancel served item (use refund flow)'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_is_cancelled THEN
    RAISE EXCEPTION 'Item already cancelled' USING ERRCODE = 'check_violation';
  END IF;

  UPDATE order_items SET
    is_cancelled    = true,
    cancelled_at    = now(),
    cancelled_reason = p_reason,
    cancelled_by    = p_authorized_by
  WHERE id = p_order_item_id;

  -- Recompute order totals (exclude cancelled)
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;

  SELECT COALESCE(SUM(line_total), 0)
    INTO v_new_subtotal
    FROM order_items
    WHERE order_id = v_order_id AND is_cancelled = false;

  v_new_total := v_new_subtotal;  -- draft = no discounts/promotions yet (those applied at checkout)
  v_new_tax   := round_idr(v_new_total * v_tax_rate / (1 + v_tax_rate));

  UPDATE orders
    SET subtotal = v_new_subtotal,
        tax_amount = v_new_tax,
        total = v_new_total,
        updated_at = now()
    WHERE id = v_order_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.cancel_item', 'order_items', p_order_item_id, jsonb_build_object(
    'order_id',         v_order_id,
    'order_number',     v_order_number,
    'item_name',        v_name,
    'reason',           p_reason,
    'authorized_by',    p_authorized_by,
    'dispatch_station', v_dispatch,
    'new_subtotal',     v_new_subtotal,
    'new_total',        v_new_total
  ));

  RETURN jsonb_build_object(
    'order_item_id',    p_order_item_id,
    'order_id',         v_order_id,
    'order_number',     v_order_number,
    'item_name',        v_name,
    'dispatch_station', v_dispatch,
    'new_subtotal',     v_new_subtotal,
    'new_tax_amount',   v_new_tax,
    'new_total',        v_new_total
  );
END $$;

GRANT EXECUTE ON FUNCTION cancel_order_item_rpc TO authenticated;

COMMENT ON FUNCTION cancel_order_item_rpc IS
  'Session 10 : cancel a draft order item (post-send_to_kitchen). Manager-PIN gate. Recomputes order totals, no stock/loyalty effect (draft).';
```

> **Note**: `has_permission_for_profile(profile_id, code)` doesn't currently exist (only `has_permission(auth_user_id, code)`). We add it inline as a lightweight wrapper :
>
> ```sql
> CREATE OR REPLACE FUNCTION has_permission_for_profile(p_profile_id UUID, p_permission TEXT)
>   RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
> AS $$
>   SELECT EXISTS (
>     SELECT 1 FROM user_profiles up
>     JOIN role_permissions rp ON rp.role_code = up.role_code
>     JOIN permissions p ON p.code = rp.permission_code
>     WHERE up.id = p_profile_id AND up.deleted_at IS NULL AND p.code = p_permission
>   )
> $$;
> ```
>
> Inclu dans `20260512000010_seed_refund_perms.sql` (with the perms seeding).

### 3.7 RPC void_order_rpc

```sql
-- 20260512000008

CREATE OR REPLACE FUNCTION void_order_rpc(
  p_order_id      UUID,
  p_reason        TEXT,
  p_authorized_by UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id        UUID;
  v_profile_id     UUID;
  v_order          RECORD;
  v_open_session   UUID;
  v_item           RECORD;
  v_lifetime       INTEGER;
  v_loyalty_now    INTEGER;
  v_refund_id      UUID;
  v_refund_number  TEXT;
  v_seq_number     INTEGER;
  v_pay            RECORD;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;

  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.void') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.void' USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status != 'paid' THEN
    RAISE EXCEPTION 'Cannot void % order (only paid orders)', v_order.status
      USING ERRCODE = 'check_violation';
  END IF;

  -- Window check : current open session must match order's session
  SELECT id INTO v_open_session FROM pos_sessions
    WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN
    RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.session_id != v_open_session THEN
    RAISE EXCEPTION 'Cross-shift void not allowed in v1' USING ERRCODE = 'P0011';
  END IF;

  -- Update orders → trigger reverses JE automatically
  UPDATE orders SET
    status      = 'voided',
    voided_at   = now(),
    voided_by   = p_authorized_by,
    void_reason = p_reason,
    updated_at  = now()
  WHERE id = p_order_id;

  -- Restore stock for non-cancelled items
  FOR v_item IN SELECT id, product_id, quantity FROM order_items
                WHERE order_id = p_order_id AND is_cancelled = false LOOP
    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    ) VALUES (
      v_item.product_id, 'sale_void', v_item.quantity, 'orders', p_order_id, v_profile_id
    );
    UPDATE products SET
      current_stock = current_stock + v_item.quantity,
      updated_at = now()
    WHERE id = v_item.product_id;
  END LOOP;

  -- Reverse loyalty earned
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 THEN
    UPDATE customers SET
      loyalty_points  = loyalty_points  - v_order.loyalty_points_earned,
      lifetime_points = lifetime_points - v_order.loyalty_points_earned,
      total_spent     = GREATEST(0, total_spent - v_order.total),
      updated_at      = now()
    WHERE id = v_order.customer_id
    RETURNING loyalty_points INTO v_loyalty_now;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      v_order.customer_id, p_order_id, 'refund',
      -v_order.loyalty_points_earned,
      v_loyalty_now,
      'Reversal: void order ' || v_order.order_number, v_profile_id
    );
  END IF;

  -- Restore loyalty redeemed (full void only, per VR5)
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_redeemed > 0 THEN
    UPDATE customers SET
      loyalty_points = loyalty_points + v_order.loyalty_points_redeemed,
      updated_at     = now()
    WHERE id = v_order.customer_id
    RETURNING loyalty_points INTO v_loyalty_now;

    INSERT INTO loyalty_transactions (
      customer_id, order_id, transaction_type, points,
      points_balance_after, description, created_by
    ) VALUES (
      v_order.customer_id, p_order_id, 'refund',
      v_order.loyalty_points_redeemed,
      v_loyalty_now,
      'Restored redemption: void order ' || v_order.order_number, v_profile_id
    );
  END IF;

  -- Insert refunds row (audit trail mirror) with is_full_void=true
  INSERT INTO refund_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = refund_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');

  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded,
                       reason, refunded_by, authorized_by, is_full_void)
  VALUES (v_refund_number, p_order_id, v_open_session, v_order.total, v_order.tax_amount,
          p_reason, v_profile_id, p_authorized_by, true)
  RETURNING id INTO v_refund_id;

  INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
  SELECT v_refund_id, id, quantity, line_total
    FROM order_items WHERE order_id = p_order_id AND is_cancelled = false;

  -- Mirror tenders 1:1 from order_payments → refund_payments
  FOR v_pay IN SELECT method, amount, reference FROM order_payments WHERE order_id = p_order_id LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference)
    VALUES (v_refund_id, v_pay.method, v_pay.amount, v_pay.reference);
  END LOOP;

  -- Trigger fn_create_je_for_refund auto-fires now → creates JE-REF-XXXX
  -- BUT the existing trg_create_sale_journal_entry_upd ALSO fired on status='voided' →
  -- so we have BOTH a JE-XXXX-VOID (from session 3 trigger) AND JE-REF-XXXX (from session 10 trigger).
  -- Decision: that's OK — they're identical accounting-wise (mirror entries). Reports should select on
  -- reference_type ('void' or 'refund') and one of the two. Document in §8 risks.

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.void', 'orders', p_order_id, jsonb_build_object(
    'order_number',  v_order.order_number,
    'total_voided',  v_order.total,
    'reason',        p_reason,
    'authorized_by', p_authorized_by,
    'refund_id',     v_refund_id,
    'refund_number', v_refund_number
  ));

  RETURN jsonb_build_object(
    'order_id',       p_order_id,
    'order_number',   v_order.order_number,
    'refund_id',      v_refund_id,
    'refund_number',  v_refund_number,
    'total_refunded', v_order.total,
    'tax_refunded',   v_order.tax_amount,
    'tenders',        (SELECT jsonb_agg(jsonb_build_object('method', method, 'amount', amount))
                       FROM refund_payments WHERE refund_id = v_refund_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION void_order_rpc TO authenticated;

COMMENT ON FUNCTION void_order_rpc IS
  'Session 10 : full void of a paid order. Manager-PIN gate. Restores stock + reverses loyalty earned + restores loyalty redeemed. Inserts mirror refund row (is_full_void=true). Cross-shift forbidden.';
```

> **Garde-fou JE double-trigger** : voir §8 risque "Double JE on void". Décision : accepté pour v1, documenté en code.

### 3.8 RPC refund_order_rpc

```sql
-- 20260512000009

CREATE OR REPLACE FUNCTION refund_order_rpc(
  p_order_id      UUID,
  p_lines         JSONB,    -- [{order_item_id, qty}]
  p_tenders       JSONB,    -- [{method, amount, reference?}]
  p_reason        TEXT,
  p_authorized_by UUID
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user_id          UUID;
  v_profile_id       UUID;
  v_order            RECORD;
  v_open_session     UUID;
  v_line_entry       JSONB;
  v_oi_id            UUID;
  v_oi               RECORD;
  v_qty_req          DECIMAL(14,3);
  v_qty_already      DECIMAL(14,3);
  v_unit             DECIMAL(14,2);
  v_amount_line      DECIMAL(14,2);
  v_refund_total     DECIMAL(14,2) := 0;
  v_tax_rate         DECIMAL(5,4);
  v_tax_refunded     DECIMAL(14,2);
  v_prior_refunds    DECIMAL(14,2);
  v_tender_entry     JSONB;
  v_tender_method    payment_method;
  v_tender_amt       DECIMAL(14,2);
  v_tender_sum       DECIMAL(14,2) := 0;
  v_method_paid      DECIMAL(14,2);
  v_method_refunded  DECIMAL(14,2);
  v_refund_id        UUID;
  v_refund_number    TEXT;
  v_seq_number       INTEGER;
  v_lifetime_pts     INTEGER;
  v_loyalty_now      INTEGER;
  v_pts_to_deduct    INTEGER := 0;
  v_loyalty_ratio    DECIMAL(8,4);
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile_id FROM user_profiles
    WHERE auth_user_id = v_user_id AND deleted_at IS NULL;

  IF NOT has_permission_for_profile(p_authorized_by, 'pos.sale.refund') THEN
    RAISE EXCEPTION 'Manager permission denied: pos.sale.refund' USING ERRCODE = 'P0003';
  END IF;

  IF length(coalesce(p_reason,'')) < 3 THEN
    RAISE EXCEPTION 'Reason required (≥ 3 chars)' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_order.id IS NULL THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_order.status != 'paid' THEN
    RAISE EXCEPTION 'Cannot refund % order', v_order.status USING ERRCODE = 'check_violation';
  END IF;

  -- Window
  SELECT id INTO v_open_session FROM pos_sessions
    WHERE opened_by = v_profile_id AND status = 'open' LIMIT 1;
  IF v_open_session IS NULL THEN
    RAISE EXCEPTION 'No open session' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.session_id != v_open_session THEN
    RAISE EXCEPTION 'Cross-shift refund not allowed in v1' USING ERRCODE = 'P0011';
  END IF;

  -- Validate lines (qty available)
  IF jsonb_array_length(p_lines) < 1 THEN
    RAISE EXCEPTION 'At least one line required' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id   := (v_line_entry->>'order_item_id')::UUID;
    v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);

    SELECT * INTO v_oi FROM order_items WHERE id = v_oi_id;
    IF v_oi.id IS NULL OR v_oi.order_id != p_order_id THEN
      RAISE EXCEPTION 'Order item % not in order %', v_oi_id, p_order_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF v_oi.is_cancelled THEN
      RAISE EXCEPTION 'Cannot refund cancelled item %', v_oi_id USING ERRCODE = 'check_violation';
    END IF;
    IF v_qty_req <= 0 OR v_qty_req > v_oi.quantity THEN
      RAISE EXCEPTION 'Invalid qty for item % (max %)', v_oi_id, v_oi.quantity
        USING ERRCODE = 'check_violation';
    END IF;

    -- Already refunded check
    SELECT COALESCE(SUM(qty), 0) INTO v_qty_already
      FROM refund_lines rl JOIN refunds r ON r.id = rl.refund_id
      WHERE rl.order_item_id = v_oi_id;

    IF v_qty_already + v_qty_req > v_oi.quantity THEN
      RAISE EXCEPTION 'Refund qty (%) + already refunded (%) exceeds line qty (%) for item %',
        v_qty_req, v_qty_already, v_oi.quantity, v_oi_id USING ERRCODE = 'check_violation';
    END IF;

    -- Compute amount (line gross : (unit_price + modifiers_per_unit) * qty − pro-rata line_discount)
    -- Simpler & more predictable : ratio of line_total
    v_amount_line := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity);
    v_refund_total := v_refund_total + v_amount_line;
  END LOOP;

  -- Cap check : total refunds for this order cannot exceed orders.total
  SELECT COALESCE(SUM(total), 0) INTO v_prior_refunds
    FROM refunds WHERE order_id = p_order_id;
  IF v_prior_refunds + v_refund_total > v_order.total THEN
    RAISE EXCEPTION 'Refund total (% + %) exceeds order total %',
      v_prior_refunds, v_refund_total, v_order.total USING ERRCODE = 'check_violation';
  END IF;

  -- Validate tender routing
  IF jsonb_array_length(p_tenders) < 1 THEN
    RAISE EXCEPTION 'At least one tender required' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    v_tender_method := (v_tender_entry->>'method')::payment_method;
    v_tender_amt    := (v_tender_entry->>'amount')::DECIMAL(14,2);

    IF v_tender_amt <= 0 THEN
      RAISE EXCEPTION 'Tender amount must be > 0' USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(amount),0) INTO v_method_paid
      FROM order_payments WHERE order_id = p_order_id AND method = v_tender_method;
    SELECT COALESCE(SUM(rp.amount),0) INTO v_method_refunded
      FROM refund_payments rp JOIN refunds r ON r.id = rp.refund_id
      WHERE r.order_id = p_order_id AND rp.method = v_tender_method;

    IF v_method_refunded + v_tender_amt > v_method_paid THEN
      RAISE EXCEPTION 'Refund tender % (%) + prior (%) exceeds method paid (%)',
        v_tender_method, v_tender_amt, v_method_refunded, v_method_paid
        USING ERRCODE = 'check_violation';
    END IF;

    v_tender_sum := v_tender_sum + v_tender_amt;
  END LOOP;

  IF v_tender_sum != v_refund_total THEN
    RAISE EXCEPTION 'Sum of refund tenders (%) != refund total (%)', v_tender_sum, v_refund_total
      USING ERRCODE = 'check_violation';
  END IF;

  -- Compute tax_refunded (PB1 inclusive : tax = round_idr(total * 10/110))
  SELECT tax_rate INTO v_tax_rate FROM business_config WHERE id = 1;
  v_tax_refunded := round_idr(v_refund_total * v_tax_rate / (1 + v_tax_rate));

  -- Generate refund_number
  INSERT INTO refund_sequences (date, last_number)
    VALUES (CURRENT_DATE, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = refund_sequences.last_number + 1
    RETURNING last_number INTO v_seq_number;
  v_refund_number := 'R-' || LPAD(v_seq_number::TEXT, 4, '0');

  -- INSERT refund + lines + payments
  INSERT INTO refunds (refund_number, order_id, session_id, total, tax_refunded,
                       reason, refunded_by, authorized_by, is_full_void)
  VALUES (v_refund_number, p_order_id, v_open_session, v_refund_total, v_tax_refunded,
          p_reason, v_profile_id, p_authorized_by, false)
  RETURNING id INTO v_refund_id;

  FOR v_line_entry IN SELECT * FROM jsonb_array_elements(p_lines) LOOP
    v_oi_id   := (v_line_entry->>'order_item_id')::UUID;
    v_qty_req := (v_line_entry->>'qty')::DECIMAL(14,3);
    SELECT line_total, quantity INTO v_oi FROM order_items WHERE id = v_oi_id;
    v_amount_line := round_idr(v_oi.line_total * v_qty_req / v_oi.quantity);

    INSERT INTO refund_lines (refund_id, order_item_id, qty, amount)
    VALUES (v_refund_id, v_oi_id, v_qty_req, v_amount_line);

    -- Restore stock
    INSERT INTO stock_movements (
      product_id, movement_type, quantity, reference_type, reference_id, created_by
    )
    SELECT product_id, 'sale_void', v_qty_req, 'refunds', v_refund_id, v_profile_id
      FROM order_items WHERE id = v_oi_id;

    UPDATE products SET
      current_stock = current_stock + v_qty_req,
      updated_at    = now()
    WHERE id = (SELECT product_id FROM order_items WHERE id = v_oi_id);
  END LOOP;

  FOR v_tender_entry IN SELECT * FROM jsonb_array_elements(p_tenders) LOOP
    INSERT INTO refund_payments (refund_id, method, amount, reference)
    VALUES (
      v_refund_id,
      (v_tender_entry->>'method')::payment_method,
      (v_tender_entry->>'amount')::DECIMAL(14,2),
      NULLIF(v_tender_entry->>'reference','')
    );
  END LOOP;

  -- Loyalty earned pro-rata reversal
  IF v_order.customer_id IS NOT NULL AND v_order.loyalty_points_earned > 0 THEN
    -- Ratio of refund_total to original total → deduct proportional points
    v_loyalty_ratio := v_refund_total::DECIMAL / NULLIF(v_order.total::DECIMAL, 0);
    v_pts_to_deduct := FLOOR(v_order.loyalty_points_earned * v_loyalty_ratio);

    IF v_pts_to_deduct > 0 THEN
      UPDATE customers SET
        loyalty_points  = GREATEST(0, loyalty_points  - v_pts_to_deduct),
        lifetime_points = GREATEST(0, lifetime_points - v_pts_to_deduct),
        total_spent     = GREATEST(0, total_spent - v_refund_total),
        updated_at      = now()
      WHERE id = v_order.customer_id
      RETURNING loyalty_points INTO v_loyalty_now;

      INSERT INTO loyalty_transactions (
        customer_id, order_id, transaction_type, points,
        points_balance_after, description, created_by
      ) VALUES (
        v_order.customer_id, p_order_id, 'refund',
        -v_pts_to_deduct, v_loyalty_now,
        'Refund ' || v_refund_number || ' on order ' || v_order.order_number, v_profile_id
      );
    END IF;
  END IF;

  -- Loyalty redemption : NOT restored on partial (per VR5)

  -- Trigger fn_create_je_for_refund auto-fires → creates JE-REF-XXXX

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_profile_id, 'order.refund', 'orders', p_order_id, jsonb_build_object(
    'refund_id',         v_refund_id,
    'refund_number',     v_refund_number,
    'order_number',      v_order.order_number,
    'total_refunded',    v_refund_total,
    'tax_refunded',      v_tax_refunded,
    'reason',            p_reason,
    'authorized_by',     p_authorized_by,
    'lines_count',       jsonb_array_length(p_lines),
    'tenders_count',     jsonb_array_length(p_tenders),
    'pts_deducted',      v_pts_to_deduct
  ));

  RETURN jsonb_build_object(
    'refund_id',      v_refund_id,
    'refund_number',  v_refund_number,
    'order_id',       p_order_id,
    'order_number',   v_order.order_number,
    'total_refunded', v_refund_total,
    'tax_refunded',   v_tax_refunded,
    'tenders',        p_tenders,
    'pts_deducted',   v_pts_to_deduct
  );
END $$;

GRANT EXECUTE ON FUNCTION refund_order_rpc TO authenticated;

COMMENT ON FUNCTION refund_order_rpc IS
  'Session 10 : partial line refund of a paid order. Manager-PIN gate. Cap = orders.total. Per-tender routing capped by paid-per-method. Restores stock + pro-rata loyalty deduction. Cross-shift forbidden.';
```

### 3.9 Seed perms + has_permission_for_profile + has_permission v4

```sql
-- 20260512000010

-- Helper variant
CREATE OR REPLACE FUNCTION has_permission_for_profile(p_profile_id UUID, p_permission TEXT)
  RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM user_profiles up
    JOIN role_permissions rp ON rp.role_code = up.role_code
    JOIN permissions p ON p.code = rp.permission_code
    WHERE up.id = p_profile_id AND up.deleted_at IS NULL AND p.code = p_permission
  )
$$;
GRANT EXECUTE ON FUNCTION has_permission_for_profile(UUID, TEXT) TO authenticated;

-- New permissions
INSERT INTO permissions (code, description) VALUES
  ('pos.sale.refund',       'Refund a portion of a paid order'),
  ('pos.sale.cancel_item',  'Cancel an order item after send_to_kitchen')
ON CONFLICT (code) DO NOTHING;

-- Grant to MANAGER + ADMIN + SUPER_ADMIN
INSERT INTO role_permissions (role_code, permission_code)
  SELECT r, p FROM (VALUES ('MANAGER'), ('ADMIN'), ('SUPER_ADMIN')) AS roles(r),
                  (VALUES ('pos.sale.refund'), ('pos.sale.cancel_item')) AS perms(p)
  ON CONFLICT DO NOTHING;

-- Refresh has_permission v4 if it's the centralized hardcoded variant — see session 8 §4.1.
-- (No change to has_permission body needed since it queries role_permissions table dynamically.)
```

> Note: `has_permission()` lit `role_permissions` (table) — donc le seed `INSERT INTO role_permissions` suffit ; aucune nouvelle version de `has_permission` PL/pgSQL nécessaire. À vérifier au runtime (cf. session 8 §10.1 caveat sur computePermissionsForRole côté EF).

---

## 4. Edge Functions — additions

### 4.1 NEW `supabase/functions/cancel-item/index.ts`

```ts
// POST { order_item_id: string, reason: string, manager_pin: string }
// 1. requireSession() (cashier+ JWT)
// 2. verify_user_pin RPC against manager_pin → get manager profile_id
// 3. has_permission_for_profile(manager_id, 'pos.sale.cancel_item') = true
// 4. Call cancel_order_item_rpc(order_item_id, reason, manager_id)
// 5. Broadcast realtime channel "kds:cancellations" with payload
//    { order_item_id, order_number, item_name, dispatch_station, action: 'cancelled' }
// 6. Return RPC result + broadcast ack
```

### 4.2 NEW `supabase/functions/void-order/index.ts`

```ts
// POST { order_id: string, reason: string, manager_pin: string }
// 1. requireSession()
// 2. verify manager PIN → manager profile_id
// 3. Call void_order_rpc(order_id, reason, manager_id)
// 4. Return result (refund_number + tenders + totals)
```

### 4.3 NEW `supabase/functions/refund-order/index.ts`

```ts
// POST { order_id, lines: [{order_item_id, qty}], tenders: [{method, amount, reference?}], reason, manager_pin }
// 1-3 as above
// 4. Call refund_order_rpc(order_id, lines, tenders, reason, manager_id)
// 5. Return result
```

### 4.4 MODIFY `supabase/functions/process-payment/index.ts`

Accept body `p_payments: JSONB` (array). Forward to RPC v8. Existing `p_payment` (single) path still works (backwards compat via RPC v8 wrapping).

```ts
const body = await req.json();
const rpcParams = {
  p_session_id, p_order_type, p_items, p_idempotency_key,
  p_customer_id, p_loyalty_points_redeemed, p_table_number,
  p_discount_amount, p_discount_type, p_discount_value, p_discount_reason,
  p_discount_authorized_by, p_loyalty_multiplier, p_promotions,
  ...(body.p_payments ? { p_payments: body.p_payments } : { p_payment: body.p_payment }),
};
const { data, error } = await admin.rpc('complete_order_with_payment', rpcParams);
```

---

## 5. Frontend — additions

### 5.1 Domain `packages/domain/src/payments/`

```
payments/
├── splitTender.ts         # validateTenders, computeRemaining, isLastTenderCashAllowed, sumTenders
├── types.ts               # Tender { method, amount, cash_received?, change_given?, reference? }
└── __tests__/
    └── splitTender.test.ts
```

```ts
export interface Tender {
  method: PaymentMethod;
  amount: number;
  cash_received?: number;
  change_given?: number;
  reference?: string;
}

export function sumTenders(tenders: Tender[]): number {
  return tenders.reduce((s, t) => s + t.amount, 0);
}

export function computeRemaining(total: number, tenders: Tender[]): number {
  return Math.max(0, total - sumTenders(tenders));
}

export function validateTenders(total: number, tenders: Tender[]): { ok: true } | { ok: false; error: string } {
  if (tenders.length < 1) return { ok: false, error: 'No tenders' };
  if (tenders.length > 5) return { ok: false, error: 'Max 5 tenders' };
  const sum = sumTenders(tenders);
  if (sum !== total) return { ok: false, error: `Sum ${sum} != total ${total}` };
  // Cash-overpay rule
  for (let i = 0; i < tenders.length; i++) {
    const t = tenders[i]!;
    if (t.cash_received !== undefined && t.cash_received > t.amount && i < tenders.length - 1) {
      return { ok: false, error: `Tender ${i+1}: cash_received cannot exceed amount on intermediate tenders` };
    }
  }
  return { ok: true };
}
```

### 5.2 Domain `packages/domain/src/refunds/`

```
refunds/
├── types.ts                # Refund, RefundLine, RefundTender, RefundCandidate
├── computeRefund.ts        # computeRefundLineAmount(orderItem, qty), computeRefundTax(total, taxRate)
├── validateRefund.ts       # validateRefundCap(orderTotal, priorRefundsTotal, newRefundTotal)
├── tenderRouter.ts         # validateRefundTenders(orderPayments, priorRefundsByMethod, newTenders)
└── __tests__/
    ├── computeRefund.test.ts
    └── validateRefund.test.ts
```

### 5.3 UI components `packages/ui/src/components/`

| Composant | Rôle |
|---|---|
| `TenderRow.tsx` | Display 1 added tender (method icon + amount + cash overpay marker + delete X) |
| `TenderListBuilder.tsx` | Manages tender list state — emits onChange(Tender[]). Used inside PaymentTerminal RIGHT panel below method selector |
| `RefundLineRow.tsx` | Order line with checkbox + qty stepper (max = qty - already_refunded). Disabled if already fully refunded or cancelled |
| `RefundTenderSplitter.tsx` | Per-method input rows pre-filled with original tender split (cashier can adjust). Validates in-row |
| `RefundReceiptModal.tsx` | Post-refund modal : R-XXXX, refunded amount, tenders restored, "DONE" button |

### 5.4 POS — split payment

MODIFY:
- `apps/pos/src/stores/paymentStore.ts` — replace `selectedMethod` / `cashReceivedStr` with `tenders: Tender[]` + `draftAmount: string` + `draftMethod: PaymentMethod | null`. Actions: `addTender()`, `removeTender(idx)`, `clearTenders()`, `setDraftMethod()`, `setDraftAmount()`.
- `apps/pos/src/features/payment/PaymentTerminal.tsx` — replace single-method UI with method selector + draft amount + Add Tender button + TenderListBuilder display + remaining/process button. When `remaining=0`, `[Add Tender]` becomes disabled and `[Process Payment]` enabled.
- `apps/pos/src/features/payment/hooks/useCheckout.ts` — pass `p_payments: tenders` (array).

### 5.5 POS — item-cancel-after-send

NEW:
- `apps/pos/src/features/cart/CancelItemModal.tsx` — wraps PinVerificationModal with extra reason input. Title "Cancel item: {name}".
- `apps/pos/src/features/cart/hooks/useCancelOrderItem.ts` — mutation that calls `cancel-item` EF, invalidates `useActiveOrder` query.

MODIFY:
- `apps/pos/src/features/cart/CartItemRow.tsx` — show CANCELLED badge (red strikethrough) if `is_cancelled=true`. Add `[X]` button next to qty stepper if `kitchen_status IN ('pending', 'preparing', 'ready')` AND not `is_cancelled`. Click → opens CancelItemModal.
- `apps/pos/src/features/kds/components/KdsOrderCard.tsx` + `apps/pos/src/features/kds/hooks/useKdsRealtime.ts` — extend the existing `postgres_changes` subscription to detect `is_cancelled` flipping to true. KdsOrderCard renders a red `CANCELLED` badge with strikethrough on cancelled item rows; cards do NOT disappear (chef awareness).

### 5.6 POS — order history + refund/void

NEW :
```
apps/pos/src/features/order-history/
├── pages/OrderHistoryPanel.tsx       # full-screen panel ; lists shift's paid orders
├── components/OrderHistoryRow.tsx    # row in list
├── components/OrderDetailDrawer.tsx  # side panel — lines + tenders + Void/Refund buttons
├── components/VoidOrderModal.tsx     # PIN + reason input + confirm
├── components/RefundOrderModal.tsx   # multi-step: pick lines → split tenders → PIN+reason → confirm
└── hooks/
    ├── useOrderHistory.ts            # query orders WHERE session_id = currentSession.id AND status='paid' ORDER BY paid_at DESC
    ├── useOrderDetail.ts             # fetch order + items + payments + prior refunds
    ├── useVoidOrder.ts               # mutation void-order EF
    └── useRefundOrder.ts             # mutation refund-order EF
```

MODIFY:
- `apps/pos/src/features/header/MainHeader.tsx` (or wherever the top-nav lives — grep) — add `[History]` icon button next to existing nav. Click opens OrderHistoryPanel as full-screen modal (FullScreenModal pattern from PaymentTerminal).

### 5.7 KDS realtime cancel notification

The `cancel-item` EF broadcasts via Supabase realtime. KDS subscribes to channel:

```ts
const ch = supabase.channel('kds:cancellations')
  .on('broadcast', { event: 'cancelled' }, (payload) => {
    const { order_item_id, dispatch_station } = payload.payload;
    if (dispatch_station === MY_STATION) {
      markCardCancelled(order_item_id);
    }
  })
  .subscribe();
```

Alternative (simpler) : KDS already uses `postgres_changes` subscription on `order_items` from session 2/4. Just listen for UPDATE events where `is_cancelled` flips to true. No EF broadcast needed.

**Décision** : Use `postgres_changes` (alternative) pour économiser un broadcast layer. EF `cancel-item` n'a pas à broadcaster — le UPDATE déclenche déjà l'event Postgres au subscriber existant.

---

## 6. Tests

### 6.1 Domain tests

| Layer | Cas |
|---|---|
| `splitTender.test.ts` | `sumTenders` empty=0 ; sum 3 tenders. `computeRemaining` >0 et =0 et negative-clamp. `validateTenders` — empty error, >5 error, sum mismatch error, cash overpay intermediate-tender error, last-tender cash overpay OK |
| `computeRefund.test.ts` | `computeRefundLineAmount` qty=full → line_total ; qty=partial → pro-rata round_idr ; tax-inclusive math |
| `validateRefund.test.ts` | cap : prior+new > order.total → err ; cap : prior+new = order.total → ok ; tender routing : per-method paid - prior_refunded < new → err |
| `tenderRouter.test.ts` | original = [60k cash + 40k card] ; refund 50k all-cash → ok ; refund 50k all-card → 10k overflow err ; refund 30k cash + 20k card → ok |

### 6.2 pgTAP

| Cas |
|---|
| `cancel_order_item_rpc` : draft order + manager perm → ok, totals recomputed ; paid order → check_violation ; served item → check_violation ; no manager perm → P0003 |
| `void_order_rpc` : paid+same-session → ok, status='voided', stock restored, loyalty pts deducted ; cross-shift → P0011 ; with redeemed pts → restored to balance ; refund row inserted is_full_void=true ; JE-REF-XXXX created (DOUBLE JE caveat documented) |
| `refund_order_rpc` : 3-line order, refund 1 line full qty → refund row + line + tender+ stock+1+1+0 ; refund partial qty → pro-rata amount ; refund 2nd time same line → cap check uses prior ; tender routing valid ; over-method → check_violation |
| `complete_order_with_payment_v8` : single tender via p_payment → iso v7 ; 2 tenders via p_payments=[60k cash, 40k card] sum=total → 2 order_payments rows ; sum mismatch → check_violation ; 6 tenders → check_violation ; intermediate cash overpay → check_violation |
| `chk_order_items_cancel_consistency` : insert is_cancelled=true with NULL reason → fail ; consistent set → ok |

### 6.3 Vitest UI

| Composant | Cas |
|---|---|
| `TenderListBuilder` | Empty state "No tenders yet" ; add cash 50k → row appears, remaining drops ; add 50k card → remaining=0, Process button enabled |
| `RefundLineRow` | Checkbox toggle ; qty stepper bounded by max=qty-already ; renders amount preview |
| `RefundTenderSplitter` | Pre-filled with original split ; rebalance keeps sum=refund_total |
| `CancelItemModal` | Reason ≥3 char gate ; PIN modal opens ; success closes |

### 6.4 Vitest smoke

| File | Cas |
|---|---|
| `apps/pos/src/__tests__/split-payment.smoke.test.tsx` | Open shift → tap items 100k → Open PaymentTerminal → add cash 50k → add card 50k → Process → DB has 2 rows order_payments |
| `apps/pos/src/__tests__/cancel-item-after-send.smoke.test.tsx` | Open order, send-to-kitchen, click X on item → enter reason + manager PIN → item flagged cancelled, totals updated, KDS card flips |
| `apps/pos/src/__tests__/void-order.smoke.test.tsx` | Recall paid order → void with PIN → status='voided', stock restored visible, refund receipt modal shown |
| `apps/pos/src/__tests__/partial-refund.smoke.test.tsx` | Recall paid order with 3 items → refund 1 item to card → refund_number returned, R-XXXX shown, prior refunds visible on next recall |
| `apps/pos/src/__tests__/refund-cap.smoke.test.tsx` | Try to over-refund → toast error from RPC ; try cross-shift → toast error |

---

## 7. Critères d'acceptation session 10

- [ ] Migrations `20260512000001` → `20260512000010` passent (`supabase db reset` clean)
- [ ] `pnpm lint` 0 warning, `pnpm typecheck` 0 erreur, `pnpm test` ≥ 620+ tests passent (≥40 nouveaux session 10)
- [ ] **POS Split-Pay** : open shift → tap items totalling 100k → open PaymentTerminal → tender 60k cash + 40k card → Process → DB `order_payments` has 2 rows summing to 100k, `orders.total = 100000`. Audit log `order.complete` metadata.tender_count=2
- [ ] **POS Split-Pay change** : tender 40k card + 70k cash (cash_received=70k, change=10k for total 100k) → Process succeeds → `order_payments[0].method=card, amount=40k` ; `order_payments[1].method=cash, amount=60k, cash_received=70k, change_given=10k`. (UI computes change from last cash tender automatically)
- [ ] **POS Cash overpay rule** : try 50k cash (cash_received=70k, change=20k) + 50k card → server rejects intermediate-cash-overpay. UI prevents this in builder before submit
- [ ] **POS Item-cancel-after-send** : send-to-kitchen → cashier clicks X on item → CancelItemModal opens → enter reason "wrong order" + manager PIN → item appears with strikethrough + CANCELLED badge in cart, KDS card flips red CANCELLED, audit log `order.cancel_item` written, `orders.subtotal/tax/total` recomputed excluding cancelled
- [ ] **POS Order History** : tap [History] → panel shows current shift's paid orders most-recent-first → tap one → drawer shows lines + tenders + [VOID] / [REFUND] buttons
- [ ] **POS Void** : tap [VOID] → reason + manager PIN → success → DB `orders.status='voided'`, `voided_at/by/reason` set ; trigger session 3 created `JE-{order}-VOID` reverse JE ; trigger session 10 created `JE-REF-R-XXXX` ; `refunds` row `is_full_void=true` ; `refund_payments` mirrors original tenders ; `stock_movements` reversal rows for non-cancelled items ; `products.current_stock += qty` ; `loyalty_transactions` reversal entry if customer was attached ; refund receipt modal shows
- [ ] **POS Partial Refund** : tap [REFUND] → pick 1 of 3 lines (qty 1 of 2) → split refund 100% to card → reason + PIN → success → DB refund row total=line_total/2, refund_lines.qty=1, refund_payments to card ; partial loyalty pts deducted pro-rata ; original `orders.status` stays `paid` ; refund receipt modal shows
- [ ] **POS Refund cap** : refund 1k more than remaining → server returns check_violation → toast "Refund exceeds order total"
- [ ] **POS Cross-shift block** : void/refund an order from a different (closed) session → server returns P0011 → toast "Cross-shift refund not allowed in v1"
- [ ] **POS Tender routing block** : refund 100k all-cash from a 60k-cash + 40k-card order → server returns "Refund tender cash exceeds method paid (60000)" → toast
- [ ] **EF tests** : cancel-item / void-order / refund-order all return 200 with valid PIN, 401 without auth, 403 with wrong-role PIN, 422 on rule violations
- [ ] **DB iso-comportement v8 vs v7** : 1-tender call (`p_payment=...`) → output strictly identical to v7 ground truth (smoke test `complete-order-v3.test.ts` passe sans modif)
- [ ] **Backwards compat** : tablet `pay_existing_order` v4 → still works single-tender (no v5 needed in this session, deferred per spec)

---

## 8. Risques et garde-fous

| Risque | Mitigation |
|---|---|
| **Double JE on void** : trigger session 3 (`paid → voided`) AND new trigger session 10 (`AFTER INSERT refunds is_full_void=true`) both fire → two JEs for the same void event | **Accepté pour v1** — JE-XXXX-VOID (session 3) and JE-REF-R-XXXX (session 10) are accounting-equivalent. Reports session 14 will dedupe by `reference_type` (prefer 'refund'). Documented in code comment on void_order_rpc |
| **Tender sum rounding** : sum of 3 cash decimals != total because of bank-rounding | RPC sum check is integer-strict (DECIMAL equality). UI must use integer IDR (already the case) |
| **Cancel item during tablet flow** : tablet `tablet_orders` (session 5) extends order_items with locked status — cancel must respect that | `cancel_order_item_rpc` check `kitchen_status != 'served'` already covers it. Tablet locked items not touched |
| **KDS realtime missed** : Postgres realtime hiccup → KDS doesn't see cancellation → chef cooks anyway | Acceptable — physical confirmation by cashier handles it. Realtime is best-effort visual aid |
| **Refund of free promo gift** : an order had `is_promo_gift=true` items priced 0 → refund_lines.amount=0 → refund row total stays equal to non-gift refunds | OK — gifts contribute 0 to refund total. Stock still restored on gift refund (returned to inventory) |
| **Refund exceeds method via concurrent operations** : two cashiers refund the same order at the same time | RPC starts with `SELECT FOR UPDATE` on orders row → serializes refunds for that order |
| **Partial refund + loyalty under-deduct** : if `loyalty_points_earned` was 5 and `refund_total/total = 0.20` → deduct=floor(1)=1 → over-deducts proportionally on small orders | Acceptable v1 (favor customer slightly); document in §10 |
| **EF verify manager-PIN race** : manager PINs same → identical authorized_by, no conflict | Manager PIN is the THIS-action authorization, not a session — no race |
| **Cross-shift edge** : cashier closes shift, customer comes back same session day for refund — current cashier's NEW shift is a different session | Acceptable — cross-shift block is intentional. Future `manual_refund` flow (session 11+) will add cross-shift admin-override |
| **PaymentTerminal cash-only legacy users** : existing flow `cash + Process Payment` button (no Add Tender) breaks UX | Add fast-path : if user types method+amount but never clicks `[Add Tender]`, the `[Process Payment]` button auto-creates a 1-tender array from draft state at submit time. Familiar UX preserved |
| **OrderHistory query perf** : `WHERE session_id=X AND status='paid'` covered by `idx_orders_session` (composite) | OK — uses leftmost prefix |
| **Refund of items that involved BOGO** : refunding the trigger qty doesn't auto-refund the BOGO reward | Acceptable v1 — line refund is gross, not promo-aware. Cashier must manually refund both rows if needed. Documented |

---

## 9. Roadmap session 11+ (mise à jour suite à session 10)

| Session | Module | Statut |
|---|---|---|
| 11 | Backoffice CRUD étendu : products + categories + suppliers + customers + customer_categories + tables + combos admin + discounts + extension `pay_existing_order` v5 split-pay | Inchangé |
| 12 | Customer display (deuxième écran) + QR scan loyalty + recipes/BOM tracking | Inchangé |
| 13 | B2B customers + credit + invoicing | Inchangé |
| 14 | Reports v1 (sales by day/week, void/refund analytics, top products, employee performance) | Inchangé |
| 15 | Settings (business_config CRUD, tax rate, hours, holidays) + idle PIN re-prompt + hub-printing (incl refund receipt) | Inchangé |
| 16+ | Coupons / promo codes nominatifs, multi-tier promotions, A/B tests, cross-shift admin refund override | Inchangé |
