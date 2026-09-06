-- Audit lot 1, P1 sécurité n°5 — le seul gate fail-open avec un vrai appelant humain.
--
-- `retry_sale_journal_entry_v4` porte DEUX défauts sur la même ligne de garde :
--
--   IF v_profile_id IS NOT NULL AND NOT has_permission(v_profile_id, 'pos.sale.create')
--
-- 1. FAIL-OPEN : acteur NULL ⇒ le gate est sauté entièrement. Un jeton PIN sans
--    sujet (P1 n°6, corrigé dans le même lot côté EF `auth-verify-pin`) rend
--    `auth.uid()` NULL sous le rôle `authenticated` — la porte s'ouvre seule.
--
-- 2. MAUVAIS ARGUMENT : `has_permission(p_uid, …)` résout `WHERE auth_user_id = p_uid`
--    (corps live vérifié le 2026-09-06). On lui passe ici un `user_profiles.id`.
--    Pour tout compte créé par le back-office (`id <> auth_user_id`), la recherche
--    ne trouve rien, `has_permission` rend FALSE, et le retry est refusé à un
--    caissier qui en a pourtant le droit. C'est l'image miroir des P0 n°7/n°8 :
--    là on écrivait `auth.uid()` où un profil était attendu, ici on lit un profil
--    où `auth.uid()` est attendu. Balayage du schéma : cette RPC est la SEULE
--    dans ce cas (les 155 autres appels passent bien un uid).
--
-- La v5 sépare les deux usages : `v_user_id` (auth.uid()) pour le gate,
-- `v_profile_id` pour l'identité. Elle échoue franchement dans les trois cas où
-- la v4 se taisait : pas d'acteur, pas de profil, pas la permission.
--
-- Corps repris de `pg_get_functiondef` live (v4), pas du fichier d'origine.

CREATE OR REPLACE FUNCTION public.retry_sale_journal_entry_v5(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_user_id      UUID;
  v_profile_id   UUID;
  v_order        orders;
  v_existing_je  UUID;
  v_rate         NUMERIC;
  v_vat          DECIMAL(14,2);
  v_net          DECIMAL(14,2);
  v_sales_id     UUID;
  v_pb1_id       UUID;
  v_entry_no     TEXT;
  v_je_id        UUID;
  v_pay          RECORD;
  v_acc_id       UUID;
BEGIN
  -- Fail-closed : aucun des trois manques ne passe en silence.
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'permission_denied: authentication required'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT id INTO v_profile_id
    FROM user_profiles
   WHERE auth_user_id = v_user_id AND deleted_at IS NULL
   LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'permission_denied: user profile not found'
      USING ERRCODE = 'P0003';
  END IF;

  -- has_permission attend un auth.uid(), pas un user_profiles.id (cf. en-tête).
  IF NOT has_permission(v_user_id, 'pos.sale.create') THEN
    RAISE EXCEPTION 'permission_denied: pos.sale.create required'
      USING ERRCODE = 'P0003';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found: %', p_order_id;
  END IF;

  -- ADR-009 déc. 4 : le retry couvre paid ET completed (transition _189).
  IF v_order.status NOT IN ('paid', 'completed') THEN
    RAISE EXCEPTION 'invalid_state: order status is %, expected paid or completed', v_order.status;
  END IF;

  -- Parité trigger : les imports historiques n'émettent jamais de JE vente —
  -- une JE manquante y est intentionnelle, pas un échec à rattraper.
  IF v_order.is_historical_import THEN
    RAISE EXCEPTION 'invalid_state: historical import orders have no sale JE';
  END IF;

  SELECT id INTO v_existing_je FROM journal_entries
    WHERE reference_type = 'sale' AND reference_id = p_order_id
    LIMIT 1;
  IF v_existing_je IS NOT NULL THEN
    RETURN jsonb_build_object(
      'order_id',          p_order_id,
      'journal_entry_id',  v_existing_je,
      'created',           false,
      'idempotent_replay', true
    );
  END IF;

  PERFORM check_fiscal_period_open(v_order.created_at::date);

  v_rate     := current_pb1_rate();
  v_vat      := COALESCE(v_order.tax_amount, 0);
  v_net      := v_order.total - v_vat;
  v_sales_id := resolve_mapping_account('SALE_POS_REVENUE');
  v_pb1_id   := resolve_mapping_account('SALE_PB1_TAX');

  v_entry_no := next_journal_entry_number(v_order.created_at::date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, v_order.created_at::date,
    'Sale ' || v_order.order_number || ' (retry)', 'sale', v_order.id,
    'posted', v_order.total, v_order.total, v_order.served_by
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_sales_id, 0, v_net, 'Sales revenue (net of PB1)');

  IF v_vat > 0 THEN
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
      (v_je_id, v_pb1_id, 0, v_vat, 'PB1 payable (rate=' || (v_rate * 100)::TEXT || '%)');
  END IF;

  FOR v_pay IN
    SELECT method::TEXT AS method, amount
      FROM order_payments
      WHERE order_id = v_order.id
      ORDER BY paid_at ASC
  LOOP
    v_acc_id := resolve_mapping_account(_sale_payment_mapping_key_v1(v_pay.method));

    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_acc_id, v_pay.amount, 0,
        'Payment receipt (' || v_pay.method || ')');
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM order_payments WHERE order_id = v_order.id) THEN
    v_acc_id := resolve_mapping_account('SALE_PAYMENT_CASH');
    INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
      VALUES (v_je_id, v_acc_id, v_order.total, 0,
        'Payment receipt (no order_payments rows — fallback to cash)');
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_order.served_by, 'je.payment_fallback_cash', 'orders', v_order.id,
              jsonb_build_object('order_number', v_order.order_number, 'total', v_order.total,
                                 'direction', 'sale_retry'));
  END IF;

  RETURN jsonb_build_object(
    'order_id',          p_order_id,
    'journal_entry_id',  v_je_id,
    'created',           true,
    'idempotent_replay', false
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.retry_sale_journal_entry_v5(uuid) FROM PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.retry_sale_journal_entry_v5(uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.retry_sale_journal_entry_v4(uuid);
