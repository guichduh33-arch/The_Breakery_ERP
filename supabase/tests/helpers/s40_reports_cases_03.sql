SELECT ok(
  current_setting('breakery.t23_pass')::boolean,
  'T23: get_daily_sales_v3 → summary discount/void keys present, voids cover the seeded void'
);

-- T24 : MANAGER → sessions is a non-empty jsonb array ; the seeded S40 session's
-- cashier name resolves via user_profiles (LEFT JOIN, not null for a real opener).
DO $$
DECLARE
  v_result       JSONB;
  v_sessions     JSONB;
  v_cashier_name TEXT;
  v_ok           BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_daily_sales_v3(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  );
  v_sessions := v_result->'sessions';

  SELECT full_name INTO v_cashier_name
    FROM user_profiles WHERE auth_user_id = '00000000-0000-0000-0000-000000000002' LIMIT 1;

  v_ok := (jsonb_typeof(v_sessions) = 'array')
      AND (jsonb_array_length(v_sessions) >= 1)
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(v_sessions) elem
         WHERE elem->>'cashier' = v_cashier_name
      );
  PERFORM set_config('breakery.t24_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t24_pass')::boolean,
  'T24: get_daily_sales_v3 → sessions non-empty jsonb array, cashier name resolved'
);

-- ============================================================
-- S40.14 — get_daily_sales_v3 settlement split (bump 2026-08-21, T25-T26)
-- summary +tendered_total/tendered_order_count (commandes portant au moins une
-- ligne order_payments) et +on_account_total/on_account_order_count (le reste).
-- Le partage se fait sur la PRÉSENCE D'UN TENDER, pas sur order_type : c'est ce
-- qui rend le rapprochement avec get_payments_by_method_v3 vrai par
-- construction. Ces deux assertions portent donc sur le RAPPORT entre les
-- chiffres — la seule présence des clés ne prouverait rien.
-- ============================================================

-- T25 : le rapprochement se referme, en montant ET en nombre de commandes.
-- Assertion d'invariant : vraie quelles que soient les données de la base dev
-- partagée, fausse dès qu'une commande tomberait des deux côtés ou d'aucun.
DO $$
DECLARE
  v_result  JSONB;
  v_summary JSONB;
  v_ok      BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_result := get_daily_sales_v3(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  );
  v_summary := v_result->'summary';
  v_ok := ((v_summary->>'total')::numeric
             = (v_summary->>'tendered_total')::numeric
             + (v_summary->>'on_account_total')::numeric)
      AND ((v_summary->>'order_count')::int
             = (v_summary->>'tendered_order_count')::int
             + (v_summary->>'on_account_order_count')::int);
  PERFORM set_config('breakery.t25_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t25_pass')::boolean,
  'T25: get_daily_sales_v3 → total = tendered_total + on_account_total, et idem sur order_count'
);

-- T26 : une commande B2B réglée au grand livre AR — payée, dans la fenêtre,
-- SANS aucune ligne order_payments — tombe du côté on_account et laisse le côté
-- tendered strictement inchangé. Mesure en DELTA (base dev partagée, la valeur
-- absolue ne veut rien dire), et le rapprochement de T25 est revérifié APRÈS le
-- seed : une ventilation qui perdrait la commande passerait les deux premières
-- égalités mais pas celle-là.
DO $$
DECLARE
  v_before JSONB;
  v_after  JSONB;
  v_b2b_id UUID;
  v_ok     BOOLEAN;
BEGIN
  SET LOCAL "request.jwt.claims" = '{"sub":"00000000-0000-0000-0000-000000000004"}';
  v_before := (get_daily_sales_v3(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  ))->'summary';

  -- session_id NULL est légal pour order_type='b2b'
  -- (orders_session_id_required_for_pos, 20260620000015) : une commande B2B
  -- naît au back-office, hors caisse. Aucune ligne order_payments n'est écrite
  -- — c'est précisément ce qui la range du côté on_account.
  INSERT INTO orders (
    order_number, order_type, status,
    subtotal, tax_amount, total, paid_at
  )
  VALUES (
    'ORD-S40-B2B-AR-001', 'b2b', 'paid',
    120000, 0, 120000,
    (CURRENT_DATE - INTERVAL '3 days')::timestamptz + INTERVAL '10 hours'
  )
  RETURNING id INTO v_b2b_id;

  v_after := (get_daily_sales_v3(
    current_setting('breakery.t_s40_date_start'),
    current_setting('breakery.t_s40_date_end')
  ))->'summary';

  v_ok := (NOT EXISTS (SELECT 1 FROM order_payments op WHERE op.order_id = v_b2b_id))
      AND ((v_after->>'on_account_total')::numeric
             - (v_before->>'on_account_total')::numeric = 120000)
      AND ((v_after->>'on_account_order_count')::int
             - (v_before->>'on_account_order_count')::int = 1)
      AND ((v_after->>'tendered_total')::numeric
             = (v_before->>'tendered_total')::numeric)
      AND ((v_after->>'tendered_order_count')::int
             = (v_before->>'tendered_order_count')::int)
      AND ((v_after->>'total')::numeric
             = (v_after->>'tendered_total')::numeric
             + (v_after->>'on_account_total')::numeric);
  PERFORM set_config('breakery.t26_pass', v_ok::text, false);
END $$;
SELECT ok(
  current_setting('breakery.t26_pass')::boolean,
  'T26: commande B2B sans ligne order_payments → +on_account (montant et compte), tendered inchangé'
);

SELECT * FROM finish();
