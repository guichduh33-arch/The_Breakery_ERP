-- ADR-013 Lot 4 (D7) — job d'expiration des avoirs client.
--
-- Sémantique FIFO : les consommations (spend + expirations passées) éteignent
-- les crédits les plus anciens d'abord ; seule la part restante d'un crédit
-- expiré est reprise en produit (DR 2220 / CR 4920).
-- Idempotence : index unique ux_scl_expiry_per_credit (au plus une ligne expiry
-- par crédit) + prédicat NOT EXISTS — un second run ne trouve plus rien.
-- Kill-switch : si business_config.store_credit_expiry_months = 0, le job ne
-- reprend RIEN, y compris les crédits déjà estampillés expires_at (désactiver
-- le réglage suspend l'expiration globalement).
-- Concurrence : FOR UPDATE SKIP LOCKED sur customers — un client en cours de
-- vente est sauté jusqu'au run suivant ; une vente qui démarre pendant
-- l'expiration attend le verrou puis relit le solde déjà réduit (gate D8).

CREATE FUNCTION public.expire_store_credit_v1() RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_months          integer;
  v_count           integer := 0;
  v_cust            uuid;
  v_consumed        numeric(14,2);
  v_cum             numeric(14,2);
  v_credit          RECORD;
  v_remaining       numeric(14,2);
  v_ledger_id       uuid;
  v_balance_after   numeric;
  v_sc_liability_id uuid;
  v_expiry_inc_id   uuid;
  v_entry_no        text;
  v_je_id           uuid;
BEGIN
  SELECT store_credit_expiry_months INTO v_months FROM business_config WHERE id = 1;
  IF COALESCE(v_months, 0) = 0 THEN
    RETURN 0;
  END IF;

  PERFORM check_fiscal_period_open(now()::date);

  v_sc_liability_id := resolve_mapping_account('SALE_PAYMENT_STORE_CREDIT');
  v_expiry_inc_id   := resolve_mapping_account('STORE_CREDIT_EXPIRY_INCOME');

  FOR v_cust IN
    SELECT DISTINCT c.customer_id
      FROM customer_store_credit_ledger c
     WHERE c.delta > 0
       AND c.expires_at IS NOT NULL
       AND c.expires_at <= now()
       AND NOT EXISTS (SELECT 1 FROM customer_store_credit_ledger e
                        WHERE e.source = 'expiry' AND e.reference_id = c.id)
  LOOP
    PERFORM 1 FROM customers WHERE id = v_cust FOR UPDATE SKIP LOCKED;
    IF NOT FOUND THEN
      CONTINUE;  -- vente en cours sur ce client -> prochain run
    END IF;

    -- Consommation totale déjà imputée (spends + expirations passées), FIFO.
    SELECT COALESCE(SUM(-delta), 0) INTO v_consumed
      FROM customer_store_credit_ledger
     WHERE customer_id = v_cust AND delta < 0;

    v_cum := 0;
    FOR v_credit IN
      SELECT id, delta, expires_at
        FROM customer_store_credit_ledger
       WHERE customer_id = v_cust AND delta > 0
       ORDER BY created_at ASC, id ASC
    LOOP
      v_cum := v_cum + v_credit.delta;

      IF v_credit.expires_at IS NOT NULL AND v_credit.expires_at <= now()
         AND NOT EXISTS (SELECT 1 FROM customer_store_credit_ledger e
                          WHERE e.source = 'expiry' AND e.reference_id = v_credit.id)
      THEN
        v_remaining := LEAST(v_credit.delta, GREATEST(0, v_cum - v_consumed));
        IF v_remaining > 0 THEN
          SELECT a.ledger_id, a.balance_after INTO v_ledger_id, v_balance_after
            FROM _apply_store_credit_v1(v_cust, -v_remaining, 'expiry',
                   'customer_store_credit_ledger', v_credit.id, NULL, NULL, NULL) a;
          -- L'expiration compte comme consommation pour les crédits suivants.
          v_consumed := v_consumed + v_remaining;

          -- JE D7 : reprise en produit — DR 2220 / CR 4920.
          v_entry_no := next_journal_entry_number(now()::date);
          INSERT INTO journal_entries (
            entry_number, entry_date, description, reference_type, reference_id,
            status, total_debit, total_credit, created_by
          ) VALUES (
            v_entry_no, now()::date,
            'Store credit expiry (customer ' || v_cust || ')',
            'store_credit_expiry', v_ledger_id,
            'posted', v_remaining, v_remaining, NULL
          ) RETURNING id INTO v_je_id;

          INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
            (v_je_id, v_sc_liability_id, v_remaining, 0,           'Store credit expiry -- DR liability 2220'),
            (v_je_id, v_expiry_inc_id,   0,           v_remaining, 'Store credit expiry -- CR breakage income');

          v_count := v_count + 1;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  RETURN v_count;
END;
$function$;

REVOKE ALL ON FUNCTION public.expire_store_credit_v1() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_store_credit_v1() FROM anon;
REVOKE ALL ON FUNCTION public.expire_store_credit_v1() FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_store_credit_v1() TO postgres;

COMMENT ON FUNCTION public.expire_store_credit_v1() IS
  'ADR-013 Lot 4 (D7) : job pg_cron quotidien de reprise des avoirs périmés '
  '(FIFO, part restante seulement). Idempotent (ux_scl_expiry_per_credit). '
  'Kill-switch : store_credit_expiry_months = 0.';

-- Schedule (modèle _132) : quotidien 02:15, unschedule gardé.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('expire-store-credit')
      FROM cron.job WHERE jobname = 'expire-store-credit';
    PERFORM cron.schedule('expire-store-credit', '15 2 * * *',
      $cron$ SELECT public.expire_store_credit_v1(); $cron$);
  END IF;
END $$;
