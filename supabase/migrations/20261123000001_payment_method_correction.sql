-- ADR-046 — Correction du moyen de paiement d'une vente par le super admin.
--
-- Le caissier se trompe de moyen (carte/QRIS saisi en espèces, ou l'inverse).
-- Le super admin corrige UN règlement entier depuis le back-office, sous son
-- propre PIN (vérifié avec verrouillage) et un motif.
--
-- Choix techniques :
-- * L'écriture de vente d'origine n'est jamais touchée. La correction est une
--   écriture NEUVE, rattachée à la vente (reference_type 'sale', même commande),
--   distinguée par metadata.kind = 'payment_method_correction' et un
--   movement_type propre (index d'idempotence des écritures). Ce rattachement
--   fait trois choses sans toucher d'autre fonction : la visibilité suit le
--   shift de la commande (can_view_financial_entry), le rapprochement bancaire
--   propose la ligne carte/QRIS avec les ventes du jour, et les lectures
--   existantes du type 'sale' ne testent que l'existence d'une écriture.
-- * Date de l'écriture = date de l'écriture de vente d'origine.
-- * Shift clos et espèces concernées : l'écart de caisse constaté à la clôture
--   était faux du même montant. On le corrige au compte d'écart, sans toucher
--   le tiroir, déjà soldé par la clôture. Les totaux figés et le rapport Z ne
--   bougent pas (ADR-046 §7).
-- * La table payment_method_corrections sert d'historique ET de clé
--   d'idempotence métier (réservation de la clé avant tout effet, rejeu = le
--   résultat de la première exécution).

CREATE TABLE public.payment_method_corrections (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  idempotency_key  uuid NOT NULL UNIQUE,
  payment_id       uuid NOT NULL REFERENCES public.order_payments(id) ON DELETE RESTRICT,
  order_id         uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  old_method       public.payment_method NOT NULL,
  new_method       public.payment_method NOT NULL,
  amount           numeric NOT NULL CHECK (amount > 0),
  reason           text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 500),
  session_id       uuid REFERENCES public.pos_sessions(id),
  session_closed   boolean NOT NULL,
  journal_entry_id uuid REFERENCES public.journal_entries(id),
  corrected_by     uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  result           jsonb,
  CONSTRAINT payment_method_corrections_method_changes CHECK (old_method <> new_method)
);
CREATE INDEX payment_method_corrections_payment_idx ON public.payment_method_corrections (payment_id, created_at);
CREATE INDEX payment_method_corrections_order_idx ON public.payment_method_corrections (order_id);

COMMENT ON TABLE public.payment_method_corrections IS
  'ADR-046 : historique des corrections de moyen de paiement (super admin). Écrite uniquement par correct_order_payment_method_v1.';

ALTER TABLE public.payment_method_corrections ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.payment_method_corrections FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.payment_method_corrections TO authenticated;
-- Lecture : qui voit le règlement voit sa correction. La sous-requête s'exécute
-- sous la RLS de l'appelant sur order_payments, elle en hérite la confidentialité.
CREATE POLICY payment_method_corrections_read ON public.payment_method_corrections
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.order_payments p WHERE p.id = payment_id));

CREATE FUNCTION public.correct_order_payment_method_v1(
  p_payment_id      uuid,
  p_new_method      public.payment_method,
  p_reason          text,
  p_manager_pin     text,
  p_idempotency_key uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid        uuid := auth.uid();
  v_profile    uuid;
  v_reason     text := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_prior      payment_method_corrections%ROWTYPE;
  v_pay        order_payments%ROWTYPE;
  v_order      orders%ROWTYPE;
  v_sale       journal_entries%ROWTYPE;
  v_order_id   uuid;
  v_corr_id    uuid := gen_random_uuid();
  v_session_id uuid;
  v_closed     boolean := false;
  v_date       date;
  v_old_acc    uuid;
  v_new_acc    uuid;
  v_debit_acc  uuid;
  v_credit_acc uuid;
  v_old_bal    numeric;
  v_je         uuid;
  v_desc       text;
  v_result     jsonb;
BEGIN
  IF p_payment_id IS NULL OR p_new_method IS NULL OR p_idempotency_key IS NULL THEN
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

  -- Rejeu rapide : la même demande rend le résultat de la première exécution,
  -- même si le moyen a changé depuis (sinon un retry réseau lirait same_method).
  SELECT * INTO v_prior FROM payment_method_corrections WHERE idempotency_key = p_idempotency_key;
  IF FOUND THEN
    IF v_prior.corrected_by <> v_profile OR v_prior.payment_id <> p_payment_id
       OR v_prior.new_method <> p_new_method OR v_prior.result IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', true);
  END IF;

  -- Un PIN faux se RETOURNE au lieu de lever : le compteur de verrouillage
  -- incrémenté par _verify_pin_with_lockout doit survivre à la réponse.
  IF p_manager_pin !~ '^\d{6}$'
     OR NOT public._verify_pin_with_lockout(v_profile, p_manager_pin) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_pin');
  END IF;

  -- Verrous : la commande, puis le règlement.
  SELECT order_id INTO v_order_id FROM order_payments WHERE id = p_payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0002';
  END IF;
  SELECT * INTO v_order FROM orders WHERE id = v_order_id FOR UPDATE;
  SELECT * INTO v_pay FROM order_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND OR v_pay.order_id <> v_order.id THEN
    RAISE EXCEPTION 'payment_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order.financial_import_document_id IS NOT NULL OR COALESCE(v_order.is_historical_import, false) THEN
    RAISE EXCEPTION 'imported_sale_not_correctable' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.status = 'voided' THEN
    RAISE EXCEPTION 'order_voided' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.status NOT IN ('paid', 'completed') THEN
    RAISE EXCEPTION 'order_not_paid' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.order_type = 'b2b' THEN
    RAISE EXCEPTION 'b2b_not_correctable' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.outstanding_at IS NOT NULL THEN
    RAISE EXCEPTION 'outstanding_sale_not_correctable' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM refunds WHERE order_id = v_order.id) THEN
    RAISE EXCEPTION 'order_refunded' USING ERRCODE = 'P0001';
  END IF;
  IF v_pay.method = p_new_method THEN
    RAISE EXCEPTION 'same_method' USING ERRCODE = '22023';
  END IF;
  IF v_pay.method = 'store_credit' OR p_new_method = 'store_credit' THEN
    RAISE EXCEPTION 'store_credit_not_correctable' USING ERRCODE = 'P0001';
  END IF;

  -- Réservation de la clé AVANT tout effet : une demande concurrente de même clé
  -- attend ce commit, puis rejoue le résultat.
  BEGIN
    INSERT INTO payment_method_corrections (
      id, idempotency_key, payment_id, order_id, old_method, new_method, amount,
      reason, session_id, session_closed, corrected_by)
    VALUES (v_corr_id, p_idempotency_key, v_pay.id, v_order.id, v_pay.method, p_new_method,
      v_pay.amount, v_reason, NULL, false, v_profile);
  EXCEPTION WHEN unique_violation THEN
    SELECT * INTO v_prior FROM payment_method_corrections WHERE idempotency_key = p_idempotency_key;
    IF v_prior.corrected_by <> v_profile OR v_prior.payment_id <> p_payment_id
       OR v_prior.new_method <> p_new_method OR v_prior.result IS NULL THEN
      RAISE EXCEPTION 'idempotency_key_reused' USING ERRCODE = '22023';
    END IF;
    RETURN v_prior.result || jsonb_build_object('replayed', true);
  END;

  -- Shift du règlement. FOR SHARE : une clôture concurrente attend ce commit,
  -- puis lit le moyen corrigé.
  v_session_id := COALESCE(v_pay.session_id, v_order.session_id);
  IF v_session_id IS NOT NULL THEN
    SELECT status = 'closed' INTO v_closed FROM pos_sessions WHERE id = v_session_id FOR SHARE;
    v_closed := COALESCE(v_closed, false);
  END IF;

  SELECT * INTO v_sale FROM journal_entries
   WHERE reference_type = 'sale' AND reference_id = v_order.id
     AND COALESCE(metadata->>'kind', '') <> 'payment_method_correction'
     AND status IN ('posted', 'locked')
   ORDER BY created_at
   LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_entry_missing' USING ERRCODE = 'P0001';
  END IF;
  v_date := v_sale.entry_date;

  v_old_acc := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method::text));
  v_new_acc := resolve_mapping_account(_sale_payment_mapping_key_v1(p_new_method::text));

  -- L'écriture de vente doit porter ce règlement au compte de l'ancien moyen.
  SELECT COALESCE(SUM(l.debit - l.credit), 0) INTO v_old_bal
    FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
   WHERE j.reference_type = 'sale' AND j.reference_id = v_order.id
     AND j.status IN ('posted', 'locked') AND l.account_id = v_old_acc;
  IF v_old_bal < v_pay.amount THEN
    -- Le mapping a pu changer depuis la vente (espèces repointées de 1110 vers
    -- 1119 le 2026-10-30 sur dev) : on reprend alors le compte RÉELLEMENT débité
    -- par la ligne de règlement de l'écriture d'origine.
    SELECT l.account_id INTO v_old_acc
      FROM journal_entry_lines l
     WHERE l.journal_entry_id = v_sale.id
       AND l.description = format('Payment receipt (%s)', v_pay.method)
       AND l.debit >= v_pay.amount
     ORDER BY l.debit, l.id
     LIMIT 1;
    IF v_old_acc IS NULL THEN
      RAISE EXCEPTION 'sale_entry_mismatch' USING ERRCODE = 'P0001';
    END IF;
    SELECT COALESCE(SUM(l.debit - l.credit), 0) INTO v_old_bal
      FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
     WHERE j.reference_type = 'sale' AND j.reference_id = v_order.id
       AND j.status IN ('posted', 'locked') AND l.account_id = v_old_acc;
    IF v_old_bal < v_pay.amount THEN
      RAISE EXCEPTION 'sale_entry_mismatch' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF v_old_acc <> v_new_acc THEN
    -- ADR-046 §8 : un règlement déjà rapproché ne se corrige pas.
    IF EXISTS (
      SELECT 1 FROM journal_entry_lines l JOIN journal_entries j ON j.id = l.journal_entry_id
       WHERE j.reference_type = 'sale' AND j.reference_id = v_order.id AND l.account_id = v_old_acc
         AND (EXISTS (SELECT 1 FROM bank_reconciliation_clearing_claims c WHERE c.gl_line_id = l.id)
           OR EXISTS (SELECT 1 FROM bank_reconciliation_gl_claims g
                        JOIN bank_reconciliation_matches m ON m.id = g.match_id
                       WHERE g.gl_line_id = l.id AND m.removed_at IS NULL)
           OR EXISTS (SELECT 1 FROM bank_reconciliation_transit t WHERE t.gl_line_id = l.id))
    ) THEN
      RAISE EXCEPTION 'payment_already_reconciled' USING ERRCODE = 'P0001';
    END IF;

    IF v_closed AND v_pay.method = 'cash' THEN
      v_debit_acc  := v_new_acc;
      v_credit_acc := resolve_mapping_account('SHIFT_CASH_VARIANCE_INCOME');
    ELSIF v_closed AND p_new_method = 'cash' THEN
      v_debit_acc  := resolve_mapping_account('SHIFT_CASH_VARIANCE_EXPENSE');
      v_credit_acc := v_old_acc;
    ELSE
      v_debit_acc  := v_new_acc;
      v_credit_acc := v_old_acc;
    END IF;

    -- Une ligne neuve dans une période bancaire finalisée casserait son empreinte.
    IF EXISTS (SELECT 1 FROM bank_reconciliations r
                WHERE r.status = 'finalized' AND r.account_id IN (v_debit_acc, v_credit_acc)
                  AND v_date BETWEEN r.period_start AND r.period_end) THEN
      RAISE EXCEPTION 'bank_period_finalized' USING ERRCODE = 'P0001';
    END IF;

    PERFORM check_fiscal_period_open(v_date);

    v_desc := format('Payment method correction %s: %s -> %s', v_order.order_number, v_pay.method, p_new_method);
    INSERT INTO journal_entries (entry_number, entry_date, description, reference_type,
                                 reference_id, status, total_debit, total_credit,
                                 created_by, metadata)
    VALUES (next_journal_entry_number(v_date), v_date, v_desc, 'sale', v_order.id, 'posted',
            v_pay.amount, v_pay.amount, v_profile,
            jsonb_build_object(
              'movement_type',  'payment_method_correction:' || v_corr_id::text,
              'kind',           'payment_method_correction',
              'correction_id',  v_corr_id,
              'payment_id',     v_pay.id,
              'old_method',     v_pay.method,
              'new_method',     p_new_method,
              'session_id',     v_session_id,
              'session_closed', v_closed))
    RETURNING id INTO v_je;
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je, v_debit_acc,  v_pay.amount, 0, v_desc),
      (v_je, v_credit_acc, 0, v_pay.amount, v_desc);
  END IF;

  -- Remis et rendu ne valent que pour les espèces.
  UPDATE order_payments
     SET method        = p_new_method,
         cash_received = CASE WHEN p_new_method = 'cash' THEN amount END,
         change_given  = CASE WHEN p_new_method = 'cash' THEN 0 END
   WHERE id = v_pay.id;

  v_result := jsonb_build_object(
    'ok',               true,
    'correction_id',    v_corr_id,
    'payment_id',       v_pay.id,
    'order_id',         v_order.id,
    'old_method',       v_pay.method,
    'new_method',       p_new_method,
    'amount',           v_pay.amount,
    'journal_entry_id', v_je,
    'entry_date',       v_date,
    'session_closed',   v_closed);

  UPDATE payment_method_corrections
     SET session_id = v_session_id, session_closed = v_closed,
         journal_entry_id = v_je, result = v_result
   WHERE id = v_corr_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, payload, actor_id)
  VALUES (
    'order.payment_method_corrected', 'orders', v_order.id,
    jsonb_build_object(
      'reason',           v_reason,
      'payment_id',       v_pay.id,
      'correction_id',    v_corr_id,
      'journal_entry_id', v_je,
      'session_id',       v_session_id,
      'session_closed',   v_closed),
    jsonb_build_object(
      'before', jsonb_build_object('method', v_pay.method, 'cash_received', v_pay.cash_received,
                                   'change_given', v_pay.change_given),
      'after',  jsonb_build_object('method', p_new_method),
      'amount', v_pay.amount),
    v_profile);

  RETURN v_result;
END;
$function$;

COMMENT ON FUNCTION public.correct_order_payment_method_v1(uuid, public.payment_method, text, text, uuid) IS
  'ADR-046 : le super admin corrige le moyen d''un règlement de vente (PIN + motif). Écriture de correction neuve, écriture d''origine intacte.';

REVOKE EXECUTE ON FUNCTION public.correct_order_payment_method_v1(uuid, public.payment_method, text, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.correct_order_payment_method_v1(uuid, public.payment_method, text, text, uuid) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.correct_order_payment_method_v1(uuid, public.payment_method, text, text, uuid) TO authenticated, service_role;
