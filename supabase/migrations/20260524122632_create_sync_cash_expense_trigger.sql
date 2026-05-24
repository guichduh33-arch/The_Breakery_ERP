CREATE OR REPLACE FUNCTION sync_cash_expense_to_session()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session_id  UUID;
  v_total       NUMERIC(15,2);
BEGIN
  -- Defensive guard (trigger WHEN already filters but keep RPC-safe)
  IF OLD.status = 'paid' OR NEW.status != 'paid' OR NEW.payment_method != 'cash' THEN
    RETURN NEW;
  END IF;

  -- Total to deduct from cash: amount + vat (VAT also paid in cash)
  v_total := NEW.amount + COALESCE(NEW.vat_amount, 0);

  -- Find the open session of the paid_by user.
  -- Both expenses.paid_by and pos_sessions.opened_by are FK to user_profiles(id),
  -- so we can join directly without going through auth.users.
  SELECT s.id INTO v_session_id
  FROM pos_sessions s
  WHERE s.opened_by = NEW.paid_by
    AND s.status = 'open'
  LIMIT 1;

  IF v_session_id IS NULL THEN
    -- No open session: log + WARNING, do NOT block
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (auth.uid(), 'expense.cash_paid_no_session', 'expenses', NEW.id,
            jsonb_build_object(
              'expense_id', NEW.id,
              'amount', v_total,
              'paid_by', NEW.paid_by,
              'reason', 'no_open_session_for_paid_by_user'
            ));
    RAISE WARNING 'sync_cash_expense_to_session: no open session for paid_by % — cash_out_total NOT updated', NEW.paid_by;
    RETURN NEW;
  END IF;

  UPDATE pos_sessions
  SET cash_out_total = cash_out_total + v_total
  WHERE id = v_session_id;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (auth.uid(), 'expense.cash_synced_to_session', 'expenses', NEW.id,
          jsonb_build_object(
            'expense_id', NEW.id,
            'session_id', v_session_id,
            'amount_added', v_total
          ));

  RETURN NEW;
END $$;

-- NOTE: Trigger functions invoked by trigger machinery do not need REVOKE EXECUTE.
-- There is no SQL-callable EXECUTE path for this function — it is only called
-- by the trigger engine via trg_expenses_sync_cash below. The SECURITY DEFINER
-- + restricted search_path is sufficient isolation.

DROP TRIGGER IF EXISTS trg_expenses_sync_cash ON expenses;
CREATE TRIGGER trg_expenses_sync_cash
  AFTER UPDATE OF status ON expenses
  FOR EACH ROW
  WHEN (NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' AND NEW.payment_method = 'cash')
  EXECUTE FUNCTION sync_cash_expense_to_session();
