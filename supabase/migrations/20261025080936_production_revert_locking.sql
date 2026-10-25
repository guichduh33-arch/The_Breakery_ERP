-- Corps live ; annulation sérialisée par production et produit fini.
CREATE OR REPLACE FUNCTION public.revert_production_v3(p_production_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid           UUID := auth.uid();
  v_profile       UUID;
  v_pr            RECORD;
  v_orig_mv       RECORD;
  v_orig_je       RECORD;
  v_je_line       RECORD;
  v_new_je_id     UUID;
  v_entry_no      TEXT;
  v_mv_count      INT := 0;
  v_je_count      INT := 0;
  v_orig_lot_id   UUID;
  v_in_created_at TIMESTAMPTZ;
  v_blockers      JSONB := '[]'::JSONB;
BEGIN
  IF NOT has_permission(v_uid, 'inventory.production.delete') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  IF p_reason IS NULL OR length(trim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'reason_required' USING ERRCODE='P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
  END IF;

  SELECT * INTO v_pr FROM production_records WHERE id = p_production_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_not_found' USING ERRCODE='P0002';
  END IF;

  IF v_pr.reverted_at IS NOT NULL THEN
    RAISE EXCEPTION 'already_reverted' USING ERRCODE='P0001';
  END IF;

  IF v_pr.production_date < now() - INTERVAL '24 hours' THEN
    RAISE EXCEPTION 'production_too_old' USING ERRCODE='P0001';
  END IF;

  -- Sérialiser le contrôle des sorties et la contrepassation avec les écrivains stock.
  -- La lecture des sorties reste une instruction séparée après une éventuelle attente.
  PERFORM 1 FROM products WHERE id = v_pr.product_id FOR UPDATE;

  SELECT sm.created_at INTO v_in_created_at
    FROM stock_movements sm
   WHERE sm.metadata->>'production_id' = p_production_id::text
     AND sm.movement_type = 'production_in'
     AND COALESCE(sm.metadata->>'reverse_of_production','false') = 'false'
   ORDER BY sm.created_at
   LIMIT 1;

  IF v_in_created_at IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(
             jsonb_build_object(
               'movement_id',   x.id,
               'movement_type', x.movement_type,
               'quantity',      x.quantity,
               'occurred_at',   x.created_at,
               'reason',        x.reason
             ) ORDER BY x.created_at), '[]'::JSONB)
      INTO v_blockers
      FROM stock_movements x
     WHERE x.product_id = v_pr.product_id
       AND x.quantity < 0
       AND x.created_at >= v_in_created_at
       AND COALESCE(x.metadata->>'production_id','') <> p_production_id::text;

    IF jsonb_array_length(v_blockers) > 0 THEN
      RAISE EXCEPTION 'already_consumed' USING ERRCODE='P0001',
        DETAIL = v_blockers::text,
        HINT = 'The produced stock has already left inventory. Correct it with a stock adjustment (adjust_stock) instead of reverting the production.';
    END IF;
  END IF;

  FOR v_orig_mv IN
    SELECT sm.*
      FROM stock_movements sm
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND COALESCE(sm.metadata->>'reverse_of_production','false') = 'false'
        AND sm.movement_type IN ('production_in','production_out')
      ORDER BY sm.created_at
  LOOP
    PERFORM record_stock_movement_v1(
      p_product_id      := v_orig_mv.product_id,
      p_movement_type   := v_orig_mv.movement_type,
      p_quantity        := -v_orig_mv.quantity,
      p_reason          := 'Reversal of ' || v_orig_mv.reason,
      p_unit_cost       := v_orig_mv.unit_cost,
      p_supplier_id     := v_orig_mv.supplier_id,
      p_idempotency_key := NULL,
      p_unit            := v_orig_mv.unit,
      p_from_section_id := v_orig_mv.to_section_id,
      p_to_section_id   := v_orig_mv.from_section_id,
      p_metadata        := jsonb_build_object(
                            'reverse_of_production',  true,
                            'original_movement_id',   v_orig_mv.id,
                            'production_id',          p_production_id,
                            'production_number',      v_pr.production_number,
                            'reason',                 p_reason
                           ),
      p_lot_id          := NULL,
      p_allow_negative  := TRUE
    );
    v_mv_count := v_mv_count + 1;
  END LOOP;

  FOR v_orig_je IN
    SELECT je.id AS je_id, je.entry_date, je.total_debit, je.total_credit, je.reference_id, je.metadata
      FROM journal_entries je
      JOIN stock_movements sm ON sm.id = je.reference_id
      WHERE sm.metadata->>'production_id' = p_production_id::text
        AND je.reference_type = 'stock_movement'
        AND COALESCE(je.metadata->>'reverse_of_production','false') = 'false'
  LOOP
    PERFORM check_fiscal_period_open(now()::date);
    v_entry_no := next_journal_entry_number(now()::date);

    INSERT INTO journal_entries (
      entry_number, entry_date, description, reference_type, reference_id,
      status, total_debit, total_credit, created_by, metadata
    ) VALUES (
      v_entry_no,
      now()::date,
      'Reversal of production ' || v_pr.production_number,
      'production',
      p_production_id,
      'posted',
      v_orig_je.total_debit,
      v_orig_je.total_credit,
      v_profile,
      jsonb_build_object(
        'reverse_of_production', true,
        'original_je_id',        v_orig_je.je_id,
        'production_id',         p_production_id,
        'production_number',     v_pr.production_number,
        'reason',                p_reason,
        'movement_type',         'reversal:' || (v_orig_je.metadata->>'movement_type') || ':' || v_orig_je.je_id::text
      )
    ) RETURNING id INTO v_new_je_id;

    FOR v_je_line IN
      SELECT account_id, debit, credit, description
        FROM journal_entry_lines
        WHERE journal_entry_id = v_orig_je.je_id
    LOOP
      INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description)
        VALUES (
          v_new_je_id,
          v_je_line.account_id,
          v_je_line.credit,
          v_je_line.debit,
          'Reversal: ' || v_je_line.description
        );
    END LOOP;

    v_je_count := v_je_count + 1;
  END LOOP;

  SELECT lot_id INTO v_orig_lot_id
    FROM stock_movements
    WHERE metadata->>'production_id' = p_production_id::text
      AND movement_type = 'production_in'
      AND COALESCE(metadata->>'reverse_of_production','false') = 'false'
      AND lot_id IS NOT NULL
    LIMIT 1;

  IF v_orig_lot_id IS NOT NULL THEN
    UPDATE stock_lots
      SET quantity = 0, status = 'consumed', updated_at = now()
      WHERE id = v_orig_lot_id;
  END IF;

  UPDATE production_records
    SET reverted_at        = now(),
        reverted_by        = v_profile,
        reverted_reason    = p_reason,
        materials_consumed = FALSE,
        stock_updated      = FALSE,
        je_posted          = FALSE,
        updated_at         = now()
    WHERE id = p_production_id;

  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'production.revert', 'production_records', p_production_id,
    jsonb_build_object(
      'reason',                  p_reason,
      'reverse_movements_count', v_mv_count,
      'reverse_je_count',        v_je_count,
      'voided_lot_id',           v_orig_lot_id
    ),
    v_profile
  );

  RETURN jsonb_build_object(
    'production_id',           p_production_id,
    'reverse_movements_count', v_mv_count,
    'reverse_je_count',        v_je_count,
    'voided_lot_id',           v_orig_lot_id
  );
END $function$
;
REVOKE ALL ON FUNCTION public.revert_production_v3(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revert_production_v3(uuid,text) TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
DROP FUNCTION public.revert_production_v2(uuid,text);
