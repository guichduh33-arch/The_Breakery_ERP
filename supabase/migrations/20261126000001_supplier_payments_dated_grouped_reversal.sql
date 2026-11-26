-- Paiements fournisseurs : date réelle, règlement groupé, contre-passation.
--
-- ADR-048 (décisions de Mamat du 2026-11-26).
--
-- 1. Date réelle : un paiement porte la date de décaissement choisie à la
--    saisie. Elle date la ligne `purchase_payments`, l'écriture et le contrôle
--    de période. Le serveur garde un défaut à l'instant courant si l'argument
--    manque, comme la famille `record_b2b_payment`.
-- 2. Règlement groupé : `record_supplier_payment_v1` règle plusieurs bons d'un
--    même fournisseur en une saisie. Une ligne et une écriture par bon (les
--    lecteurs existants retrouvent l'écriture par la ligne de paiement), liées
--    par `payment_group_id`. Répartition du plus ancien bon au plus récent.
-- 3. Contre-passation : `purchase_payments` reste append-only. Une erreur se
--    corrige par une ligne NÉGATIVE liée à l'originale (`reversal_of_id`) et une
--    écriture inverse datée du jour d'origine. Toutes les sommes existantes
--    (reste dû, encours fournisseur, annulation de réception, rapport) se
--    corrigent d'elles-mêmes. Réservée au super admin, sous son propre PIN,
--    avec motif. Période fermée : refus. Paiement rapproché en banque : permis.
--    Un paiement groupé se contre-passe en entier.

-- ─── Schéma ──────────────────────────────────────────────────────────────────
ALTER TABLE public.purchase_payments
  ADD COLUMN payment_group_id uuid,
  ADD COLUMN reversal_of_id   uuid REFERENCES public.purchase_payments(id) ON DELETE RESTRICT,
  ADD COLUMN reversal_reason  text;

ALTER TABLE public.purchase_payments DROP CONSTRAINT purchase_payments_amount_check;
ALTER TABLE public.purchase_payments ADD CONSTRAINT purchase_payments_amount_check CHECK (
  (reversal_of_id IS NULL AND amount > 0 AND reversal_reason IS NULL)
  OR (reversal_of_id IS NOT NULL AND amount < 0 AND reversal_reason IS NOT NULL));

-- Une seule contre-passation par paiement.
CREATE UNIQUE INDEX purchase_payments_reversal_of_uq
  ON public.purchase_payments (reversal_of_id) WHERE reversal_of_id IS NOT NULL;
CREATE INDEX purchase_payments_group_idx
  ON public.purchase_payments (payment_group_id) WHERE payment_group_id IS NOT NULL;

COMMENT ON COLUMN public.purchase_payments.payment_group_id IS
  'Règlement groupé (ADR-048) : même valeur sur chaque ligne d''une même saisie.';
COMMENT ON COLUMN public.purchase_payments.reversal_of_id IS
  'Contre-passation (ADR-048) : ligne négative liée au paiement annulé.';

-- Une contre-passation ne réclame pas de facture : le paiement d'origine l'a
-- déjà exigée, et la facture ne peut plus être retirée après paiement.
CREATE OR REPLACE FUNCTION public._guard_po_payment_invoice_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE p public.purchase_orders%ROWTYPE;
BEGIN
 IF NEW.reversal_of_id IS NOT NULL THEN RETURN NEW; END IF;
 SELECT * INTO p FROM public.purchase_orders WHERE id=NEW.purchase_order_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'po_not_found' USING ERRCODE='P0002'; END IF;
 IF NOT p.invoice_exempt AND NOT public._payment_invoice_valid_v1(
   'purchase-invoices',p.invoice_path,'purchase-orders/'||p.id||'/') THEN
  RAISE EXCEPTION 'invoice_required_before_payment' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $function$;

-- ─── Helper interne daté ─────────────────────────────────────────────────────
-- Copie du corps live de `_record_po_payment_internal` (2026-11-26), avec la
-- date de paiement et le groupe. Interdit aux appelants : il fait confiance à
-- `p_actor`.
CREATE FUNCTION public._record_po_payment_internal_v2(
  p_po_id uuid, p_amount numeric, p_method text, p_reference text,
  p_idempotency_key uuid, p_actor uuid, p_paid_at timestamptz, p_payment_group_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_po             RECORD;
  v_existing_pay   RECORD;
  v_payment_id     UUID;
  v_total_paid     NUMERIC(14,2);
  v_total_amount   NUMERIC(14,2);
  v_remaining_due  NUMERIC(14,2);
  v_derived_status TEXT;
  v_je_id          UUID;
  v_entry_no       TEXT;
  v_ap_id          UUID;
  v_cr_id          UUID;
  v_paid_at        TIMESTAMPTZ := COALESCE(p_paid_at, now());
  v_date           DATE := (COALESCE(p_paid_at, now()))::date;
BEGIN
  SELECT * INTO v_existing_pay
    FROM purchase_payments
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;
  IF FOUND THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
      FROM purchase_payments WHERE purchase_order_id = v_existing_pay.purchase_order_id;
    SELECT total_amount INTO v_total_amount
      FROM purchase_orders WHERE id = v_existing_pay.purchase_order_id;
    v_remaining_due  := v_total_amount - v_total_paid;
    v_derived_status := CASE
      WHEN v_remaining_due <= 0 THEN 'paid'
      WHEN v_total_paid > 0     THEN 'partial'
      ELSE 'unpaid'
    END;
    SELECT id INTO v_je_id FROM journal_entries
      WHERE reference_type = 'purchase_payment' AND reference_id = v_existing_pay.id
      LIMIT 1;
    RETURN jsonb_build_object(
      'payment_id',        v_existing_pay.id,
      'je_id',             v_je_id,
      'amount_paid',       v_existing_pay.amount,
      'paid_at',           v_existing_pay.paid_at,
      'total_paid',        v_total_paid,
      'remaining_due',     v_remaining_due,
      'derived_status',    v_derived_status,
      'idempotent_replay', true
    );
  END IF;

  SELECT * INTO v_po FROM purchase_orders
    WHERE id = p_po_id AND deleted_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
    FROM purchase_payments WHERE purchase_order_id = p_po_id;

  v_remaining_due := v_po.total_amount - v_total_paid;

  IF p_amount > v_remaining_due THEN
    RAISE EXCEPTION 'overpayment_not_allowed: remaining=% requested=%',
      v_remaining_due, p_amount
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM check_fiscal_period_open(v_date);

  v_ap_id := resolve_mapping_account('PURCHASE_PAYABLE');
  v_cr_id := CASE
    WHEN lower(p_method) = 'cash' THEN resolve_mapping_account('PURCHASE_CASH_OUT')
    ELSE                               resolve_mapping_account('PURCHASE_PAYMENT_BANK')
  END;

  BEGIN
    INSERT INTO purchase_payments (
      purchase_order_id, amount, method, paid_at, paid_by,
      reference, idempotency_key, payment_group_id
    ) VALUES (
      p_po_id, p_amount, p_method, v_paid_at, p_actor,
      p_reference, p_idempotency_key, p_payment_group_id
    ) RETURNING id INTO v_payment_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_existing_pay
      FROM purchase_payments WHERE idempotency_key = p_idempotency_key;
    SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
      FROM purchase_payments WHERE purchase_order_id = p_po_id;
    v_remaining_due  := v_po.total_amount - v_total_paid;
    v_derived_status := CASE
      WHEN v_remaining_due <= 0 THEN 'paid'
      WHEN v_total_paid > 0     THEN 'partial'
      ELSE 'unpaid'
    END;
    SELECT id INTO v_je_id FROM journal_entries
      WHERE reference_type = 'purchase_payment' AND reference_id = v_existing_pay.id
      LIMIT 1;
    RETURN jsonb_build_object(
      'payment_id',        v_existing_pay.id,
      'je_id',             v_je_id,
      'amount_paid',       v_existing_pay.amount,
      'paid_at',           v_existing_pay.paid_at,
      'total_paid',        v_total_paid,
      'remaining_due',     v_remaining_due,
      'derived_status',    v_derived_status,
      'idempotent_replay', true
    );
  END;

  v_entry_no := next_journal_entry_number(v_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description,
    reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no,
    v_date,
    'PO payment: ' || v_po.po_number || ' (' || p_method || ')',
    'purchase_payment', v_payment_id,
    'posted', p_amount, p_amount,
    p_actor
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_ap_id, p_amount, 0,
      'AP settlement for PO ' || v_po.po_number);

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
    VALUES (v_je_id, v_cr_id, 0, p_amount,
      'Payment via ' || p_method || COALESCE(' ref: ' || p_reference, ''));

  v_total_paid    := v_total_paid + p_amount;
  v_remaining_due := v_po.total_amount - v_total_paid;
  v_derived_status := CASE
    WHEN v_remaining_due <= 0 THEN 'paid'
    WHEN v_total_paid > 0     THEN 'partial'
    ELSE 'unpaid'
  END;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    p_actor,
    'po.payment_recorded',
    'purchase_order',
    p_po_id,
    jsonb_build_object(
      'payment_id',       v_payment_id,
      'po_number',        v_po.po_number,
      'amount',           p_amount,
      'method',           p_method,
      'reference',        p_reference,
      'paid_at',          v_paid_at,
      'payment_group_id', p_payment_group_id,
      'total_paid',       v_total_paid,
      'remaining_due',    v_remaining_due,
      'derived_status',   v_derived_status,
      'je_id',            v_je_id,
      'idempotency_key',  p_idempotency_key,
      'rpc_version',      'internal_v2'
    )
  );

  RETURN jsonb_build_object(
    'payment_id',        v_payment_id,
    'je_id',             v_je_id,
    'amount_paid',       p_amount,
    'paid_at',           v_paid_at,
    'total_paid',        v_total_paid,
    'remaining_due',     v_remaining_due,
    'derived_status',    v_derived_status,
    'idempotent_replay', false
  );
END $function$;

-- L'ancien helper (appelé par l'écriture d'achat direct au comptant) devient
-- un relais : même signature, paiement daté de l'instant courant.
CREATE OR REPLACE FUNCTION public._record_po_payment_internal(
  p_po_id uuid, p_amount numeric, p_method text, p_reference text,
  p_idempotency_key uuid, p_actor uuid)
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT public._record_po_payment_internal_v2(
    p_po_id, p_amount, p_method, p_reference, p_idempotency_key, p_actor, now(), NULL);
$function$;

-- ─── Paiement d'un bon : v3, daté ────────────────────────────────────────────
CREATE FUNCTION public.record_po_payment_v3(
  p_po_id uuid, p_amount numeric, p_method text, p_reference text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid, p_paid_at timestamptz DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_po_status TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.pay') THEN
    RAISE EXCEPTION 'permission_denied: purchasing.po.pay' USING ERRCODE = 'P0003';
  END IF;

  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_method IS NULL OR length(trim(p_method)) = 0 THEN
    RAISE EXCEPTION 'method_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT status INTO v_po_status FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po_status = 'cancelled' THEN
    RAISE EXCEPTION 'po_cancelled: payment refused on a cancelled purchase order' USING ERRCODE = 'P0001';
  END IF;

  RETURN _record_po_payment_internal_v2(
    p_po_id            := p_po_id,
    p_amount           := p_amount,
    p_method           := p_method,
    p_reference        := p_reference,
    p_idempotency_key  := p_idempotency_key,
    p_actor            := v_profile,
    p_paid_at          := COALESCE(p_paid_at, now()),
    p_payment_group_id := NULL
  );
END $function$;

DROP FUNCTION public.record_po_payment_v2(uuid, numeric, text, text, uuid);

-- ─── Règlement groupé de plusieurs bons d'un fournisseur ─────────────────────
CREATE FUNCTION public.record_supplier_payment_v1(
  p_supplier_id uuid, p_po_ids uuid[], p_amount numeric, p_method text,
  p_reference text DEFAULT NULL::text, p_paid_at timestamptz DEFAULT now(),
  p_idempotency_key uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid       uuid := auth.uid();
  v_profile   uuid;
  v_ids       uuid[];
  v_po        record;
  v_due       numeric(14,2);
  v_total_due numeric(14,2) := 0;
  v_left      numeric(14,2);
  v_part      numeric(14,2);
  v_res       jsonb;
  v_lines     jsonb := '[]'::jsonb;
  v_replay    boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT has_permission(v_uid, 'purchasing.po.pay') THEN
    RAISE EXCEPTION 'permission_denied: purchasing.po.pay' USING ERRCODE = 'P0003';
  END IF;

  IF p_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_method IS NULL OR length(trim(p_method)) = 0 THEN
    RAISE EXCEPTION 'method_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT array_agg(DISTINCT x) INTO v_ids FROM unnest(p_po_ids) x WHERE x IS NOT NULL;
  IF v_ids IS NULL OR cardinality(v_ids) < 1 THEN
    RAISE EXCEPTION 'po_ids_required' USING ERRCODE = 'P0001';
  END IF;

  -- Rejeu : la saisie a déjà abouti, on rend ses lignes.
  IF EXISTS (SELECT 1 FROM purchase_payments WHERE payment_group_id = p_idempotency_key) THEN
    v_replay := true;
  END IF;

  -- Verrous dans un ordre stable, puis contrôles de chaque bon.
  FOR v_po IN
    SELECT po.* FROM purchase_orders po
     WHERE po.id = ANY (v_ids)
     ORDER BY po.id
     FOR UPDATE
  LOOP
    IF v_po.supplier_id IS DISTINCT FROM p_supplier_id THEN
      RAISE EXCEPTION 'po_supplier_mismatch: %', v_po.po_number USING ERRCODE = 'P0001';
    END IF;
    IF v_po.deleted_at IS NOT NULL THEN
      RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
    END IF;
    IF v_po.status = 'cancelled' THEN
      RAISE EXCEPTION 'po_cancelled: %', v_po.po_number USING ERRCODE = 'P0001';
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM purchase_orders WHERE id = ANY (v_ids)) <> cardinality(v_ids) THEN
    RAISE EXCEPTION 'po_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_replay THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'po_id', pp.purchase_order_id, 'payment_id', pp.id, 'amount', pp.amount)
             ORDER BY pp.created_at, pp.id), '[]'::jsonb)
      INTO v_lines
      FROM purchase_payments pp WHERE pp.payment_group_id = p_idempotency_key;
    RETURN jsonb_build_object(
      'payment_group_id', p_idempotency_key,
      'amount_paid', (SELECT SUM(amount) FROM purchase_payments WHERE payment_group_id = p_idempotency_key),
      'lines', v_lines,
      'idempotent_replay', true);
  END IF;

  -- Reste dû de chaque bon : la somme du grand livre, contre-passations comprises.
  FOR v_po IN
    SELECT po.id, po.po_number, po.total_amount - COALESCE(
             (SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_order_id = po.id), 0) AS due
      FROM purchase_orders po WHERE po.id = ANY (v_ids)
  LOOP
    IF v_po.due <= 0 THEN
      RAISE EXCEPTION 'po_nothing_due: %', v_po.po_number USING ERRCODE = 'P0001';
    END IF;
    v_total_due := v_total_due + v_po.due;
  END LOOP;

  IF p_amount > v_total_due THEN
    RAISE EXCEPTION 'overpayment_not_allowed: remaining=% requested=%', v_total_due, p_amount
      USING ERRCODE = 'P0001';
  END IF;

  -- Répartition du plus ancien bon au plus récent.
  v_left := p_amount;
  FOR v_po IN
    SELECT po.id, po.total_amount - COALESCE(
             (SELECT SUM(pp.amount) FROM purchase_payments pp WHERE pp.purchase_order_id = po.id), 0) AS due
      FROM purchase_orders po WHERE po.id = ANY (v_ids)
     ORDER BY po.order_date NULLS LAST, po.created_at, po.id
  LOOP
    EXIT WHEN v_left <= 0;
    v_part := LEAST(v_left, v_po.due);
    v_res := _record_po_payment_internal_v2(
      p_po_id            := v_po.id,
      p_amount           := v_part,
      p_method           := p_method,
      p_reference        := p_reference,
      p_idempotency_key  := md5(p_idempotency_key::text || ':' || v_po.id::text)::uuid,
      p_actor            := v_profile,
      p_paid_at          := COALESCE(p_paid_at, now()),
      p_payment_group_id := p_idempotency_key);
    v_lines := v_lines || jsonb_build_object(
      'po_id', v_po.id, 'payment_id', v_res->>'payment_id', 'amount', v_part,
      'remaining_due', v_res->'remaining_due', 'derived_status', v_res->'derived_status');
    v_left := v_left - v_part;
  END LOOP;

  RETURN jsonb_build_object(
    'payment_group_id', p_idempotency_key,
    'amount_paid', p_amount,
    'lines', v_lines,
    'idempotent_replay', false);
END $function$;

-- ─── Contre-passation d'un paiement fournisseur ──────────────────────────────
CREATE FUNCTION public.reverse_po_payment_v1(
  p_payment_id uuid, p_reason text, p_manager_pin text, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid     uuid := auth.uid();
  v_profile uuid;
  v_reason  text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_pay     purchase_payments%ROWTYPE;
  v_target  record;
  v_po      purchase_orders%ROWTYPE;
  v_orig_je journal_entries%ROWTYPE;
  v_debit   uuid;
  v_credit  uuid;
  v_date    date;
  v_rev_id  uuid;
  v_je      uuid;
  v_desc    text;
  v_lines   jsonb := '[]'::jsonb;
  v_ids     uuid[];
BEGIN
  IF p_payment_id IS NULL OR p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'invalid_request' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(btrim(p_manager_pin), '') = '' THEN
    RAISE EXCEPTION 'pin_required' USING ERRCODE = 'P0001';
  END IF;
  IF v_reason IS NULL OR length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL AND is_active
   LIMIT 1;
  IF v_profile IS NULL OR NOT public.is_business_owner_v1() THEN
    RAISE EXCEPTION 'super_admin_only' USING ERRCODE = '42501';
  END IF;

  -- Rejeu : la clé de la première ligne de contre-passation fait foi.
  IF EXISTS (SELECT 1 FROM purchase_payments
              WHERE idempotency_key = md5(p_idempotency_key::text || ':' || p_payment_id::text)::uuid) THEN
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'reversal_id', r.id, 'reversed_payment_id', r.reversal_of_id, 'amount', r.amount)
             ORDER BY r.created_at, r.id), '[]'::jsonb)
      INTO v_lines
      FROM purchase_payments r
     WHERE r.reversal_of_id IS NOT NULL AND r.paid_by = v_profile
       AND r.idempotency_key = md5(p_idempotency_key::text || ':' || r.reversal_of_id::text)::uuid;
    RETURN jsonb_build_object('ok', true, 'lines', v_lines, 'replayed', true);
  END IF;

  -- Un PIN faux se RETOURNE au lieu de lever : le compteur de verrouillage
  -- incrémenté par _verify_pin_with_lockout doit survivre à la réponse.
  IF p_manager_pin !~ '^\d{6}$'
     OR NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  SELECT * INTO v_pay FROM purchase_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_pay.reversal_of_id IS NOT NULL THEN
    RAISE EXCEPTION 'reversal_not_reversible' USING ERRCODE = 'P0001';
  END IF;

  -- Un paiement groupé se contre-passe en entier : la saisie fautive est une.
  IF v_pay.payment_group_id IS NOT NULL THEN
    SELECT array_agg(id ORDER BY id) INTO v_ids FROM purchase_payments
     WHERE payment_group_id = v_pay.payment_group_id AND reversal_of_id IS NULL;
  ELSE
    v_ids := ARRAY[v_pay.id];
  END IF;

  -- Verrous : les bons, dans un ordre stable.
  PERFORM 1 FROM purchase_orders
   WHERE id IN (SELECT purchase_order_id FROM purchase_payments WHERE id = ANY (v_ids))
   ORDER BY id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM purchase_payments WHERE reversal_of_id = ANY (v_ids)) THEN
    RAISE EXCEPTION 'payment_already_reversed' USING ERRCODE = 'P0001';
  END IF;

  FOR v_target IN
    SELECT pp.* FROM purchase_payments pp WHERE pp.id = ANY (v_ids) ORDER BY pp.id
  LOOP
    SELECT * INTO v_po FROM purchase_orders WHERE id = v_target.purchase_order_id;
    -- Bon importé de l'ancienne caisse : la garde d'import n'admet que des
    -- ajouts positifs. Refus explicite plutôt qu'une erreur de garde opaque.
    IF COALESCE(v_po.is_historical_import, false) OR v_po.financial_import_document_id IS NOT NULL THEN
      RAISE EXCEPTION 'imported_payment_not_reversible' USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_orig_je FROM journal_entries
     WHERE reference_type = 'purchase_payment' AND reference_id = v_target.id
       AND status IN ('posted', 'locked')
     ORDER BY created_at LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'payment_entry_missing' USING ERRCODE = 'P0001';
    END IF;
    v_date := v_orig_je.entry_date;
    PERFORM check_fiscal_period_open(v_date);

    -- Comptes réellement mouvementés par l'écriture d'origine (le mapping a pu
    -- changer depuis : petite caisse au 2026-11-15).
    SELECT account_id INTO v_debit FROM journal_entry_lines
     WHERE journal_entry_id = v_orig_je.id AND credit > 0 ORDER BY id LIMIT 1;
    SELECT account_id INTO v_credit FROM journal_entry_lines
     WHERE journal_entry_id = v_orig_je.id AND debit > 0 ORDER BY id LIMIT 1;
    IF v_debit IS NULL OR v_credit IS NULL THEN
      RAISE EXCEPTION 'payment_entry_mismatch' USING ERRCODE = 'P0001';
    END IF;

    -- Une ligne neuve sur un compte bancaire dans une période de rapprochement
    -- finalisée casserait l'empreinte de ce rapprochement.
    IF EXISTS (SELECT 1 FROM bank_reconciliations r
                WHERE r.status = 'finalized' AND r.account_id IN (v_debit, v_credit)
                  AND v_date BETWEEN r.period_start AND r.period_end) THEN
      RAISE EXCEPTION 'bank_period_finalized' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO purchase_payments (
      purchase_order_id, amount, method, paid_at, paid_by, reference,
      idempotency_key, payment_group_id, reversal_of_id, reversal_reason)
    VALUES (
      v_target.purchase_order_id, -v_target.amount, v_target.method, v_target.paid_at, v_profile,
      v_target.reference, md5(p_idempotency_key::text || ':' || v_target.id::text)::uuid,
      v_target.payment_group_id, v_target.id, v_reason)
    RETURNING id INTO v_rev_id;

    v_desc := 'PO payment reversal: ' || v_po.po_number || ' (' || v_target.method || ')';
    INSERT INTO journal_entries (entry_number, entry_date, description, reference_type,
                                 reference_id, status, total_debit, total_credit,
                                 created_by, metadata)
    VALUES (next_journal_entry_number(v_date), v_date, v_desc, 'purchase_payment', v_rev_id,
            'posted', v_target.amount, v_target.amount, v_profile,
            jsonb_build_object('kind', 'purchase_payment_reversal',
                               'reversal_of', v_target.id,
                               'original_je_id', v_orig_je.id))
    RETURNING id INTO v_je;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je, v_debit,  v_target.amount, 0, v_desc),
      (v_je, v_credit, 0, v_target.amount, v_desc);

    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata, payload)
    VALUES (
      v_profile, 'po.payment_reversed', 'purchase_order', v_po.id,
      jsonb_build_object(
        'reason',           v_reason,
        'payment_id',       v_target.id,
        'reversal_id',      v_rev_id,
        'po_number',        v_po.po_number,
        'payment_group_id', v_target.payment_group_id,
        'je_id',            v_je,
        'entry_date',       v_date),
      jsonb_build_object(
        'amount', v_target.amount, 'method', v_target.method, 'paid_at', v_target.paid_at));

    v_lines := v_lines || jsonb_build_object(
      'reversal_id', v_rev_id, 'reversed_payment_id', v_target.id, 'amount', -v_target.amount,
      'je_id', v_je, 'entry_date', v_date);
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'lines', v_lines, 'replayed', false);
END $function$;

-- ─── Droits ──────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public._record_po_payment_internal_v2(uuid, numeric, text, text, uuid, uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._record_po_payment_internal(uuid, numeric, text, text, uuid, uuid) FROM PUBLIC, anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.record_po_payment_v3(uuid, numeric, text, text, uuid, timestamptz) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_po_payment_v3(uuid, numeric, text, text, uuid, timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_po_payment_v3(uuid, numeric, text, text, uuid, timestamptz) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.record_supplier_payment_v1(uuid, uuid[], numeric, text, text, timestamptz, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_supplier_payment_v1(uuid, uuid[], numeric, text, text, timestamptz, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_supplier_payment_v1(uuid, uuid[], numeric, text, text, timestamptz, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.reverse_po_payment_v1(uuid, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reverse_po_payment_v1(uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_po_payment_v1(uuid, text, text, uuid) TO authenticated, service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.record_po_payment_v3(uuid, numeric, text, text, uuid, timestamptz) IS
  'ADR-048 : paiement fournisseur d''un bon, daté de la date réelle de décaissement.';
COMMENT ON FUNCTION public.record_supplier_payment_v1(uuid, uuid[], numeric, text, text, timestamptz, uuid) IS
  'ADR-048 : règlement groupé de plusieurs bons d''un même fournisseur.';
COMMENT ON FUNCTION public.reverse_po_payment_v1(uuid, text, text, uuid) IS
  'ADR-048 : contre-passation d''un paiement fournisseur, super admin sous PIN, motif obligatoire.';
