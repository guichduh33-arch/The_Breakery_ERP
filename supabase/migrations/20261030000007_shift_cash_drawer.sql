-- Le tiroir du shift est distinct du coffre ; le fonds provient de Small Money.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM accounts WHERE code='1119' AND (name <> 'Cash Drawer'
    OR account_type <> 'asset' OR account_class <> 1 OR cash_flow_section <> 'none'
    OR balance_type <> 'debit' OR NOT is_active OR NOT is_postable OR deleted_at IS NOT NULL)) THEN
    RAISE EXCEPTION 'account_1119_conflict';
  END IF;
  IF EXISTS (SELECT 1 FROM accounting_mappings WHERE mapping_key='SALE_PAYMENT_CASH'
    AND (account_code NOT IN ('1110','1119') OR NOT is_active)) THEN
    RAISE EXCEPTION 'sale_cash_mapping_conflict';
  END IF;
END $$;
INSERT INTO accounts(code,name,account_type,account_class,balance_type,cash_flow_section,is_active,is_postable,is_system)
SELECT '1119','Cash Drawer','asset',1,'debit','none',true,true,true
WHERE NOT EXISTS (SELECT 1 FROM accounts WHERE code='1119');
UPDATE accounting_mappings SET account_code='1119',description='Cash sales received in the shift cash drawer'
WHERE mapping_key='SALE_PAYMENT_CASH' AND account_code='1110';

CREATE TABLE public.shift_cash_treasury (
  session_id uuid PRIMARY KEY REFERENCES pos_sessions(id),
  opening_float numeric(14,2) NOT NULL CHECK (opening_float >= 0),
  issued_je_id uuid UNIQUE REFERENCES journal_entries(id),
  settlement_je_id uuid UNIQUE REFERENCES journal_entries(id),
  settled_at timestamptz,
  returned_float numeric(14,2),
  safe_deposit numeric(14,2)
);
ALTER TABLE shift_cash_treasury ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON shift_cash_treasury FROM PUBLIC,anon,authenticated;
GRANT SELECT ON shift_cash_treasury TO authenticated;
CREATE POLICY shift_cash_treasury_read ON shift_cash_treasury FOR SELECT TO authenticated
USING (has_permission(auth.uid(),'accounting.cash.read'));

CREATE FUNCTION public._emit_shift_cash_transfer_v1(
  p_session uuid,p_kind text,p_date date,p_actor uuid,p_lines jsonb
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE je uuid; total numeric; credits numeric; line jsonb;
BEGIN
  SELECT sum((x->>'debit')::numeric),sum((x->>'credit')::numeric) INTO total,credits
    FROM jsonb_array_elements(p_lines) x;
  IF total IS NULL OR total <> credits OR total <= 0 THEN RAISE EXCEPTION 'invalid_shift_transfer'; END IF;
  PERFORM check_fiscal_period_open(p_date);
  INSERT INTO journal_entries(entry_number,entry_date,description,reference_type,reference_id,
    status,total_debit,total_credit,created_by,metadata)
  VALUES(next_journal_entry_number(p_date),p_date,
    CASE p_kind WHEN 'shift_float_issued' THEN 'Shift opening float from Small Money'
      ELSE 'Shift cash settlement: float returned and cash deposited' END,
    'cash_movement',p_session,'posted',total,total,p_actor,jsonb_build_object('movement_type',p_kind,'session_id',p_session))
    RETURNING id INTO je;
  FOR line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    INSERT INTO journal_entry_lines(journal_entry_id,account_id,debit,credit,description)
    VALUES(je,(line->>'account_id')::uuid,(line->>'debit')::numeric,(line->>'credit')::numeric,line->>'description');
  END LOOP;
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
    VALUES(p_actor,'shift.cash_transferred','pos_sessions',p_session,
      jsonb_build_object('movement_type',p_kind,'journal_entry_id',je,'amount',total));
  RETURN je;
END $$;

CREATE FUNCTION public._issue_shift_cash_float_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE je uuid; drawer uuid; small uuid;
BEGIN
  IF NEW.status <> 'open' THEN RETURN NEW; END IF;
  IF NEW.opening_cash < 0 OR NEW.opening_cash::text IN ('NaN','Infinity','-Infinity')
    OR NEW.opening_cash <> round(NEW.opening_cash,2) THEN RAISE EXCEPTION 'invalid_opening_cash'; END IF;
  IF NEW.opening_cash > 0 THEN
    drawer:=resolve_mapping_account('SALE_PAYMENT_CASH');
    small:=resolve_mapping_account('CASH_WALLET_SMALL_MONEY');
    je:=_emit_shift_cash_transfer_v1(NEW.id,'shift_float_issued',NEW.opened_at::date,NEW.opened_by,
      jsonb_build_array(
        jsonb_build_object('account_id',drawer,'debit',NEW.opening_cash,'credit',0,'description','Opening float received in Cash Drawer'),
        jsonb_build_object('account_id',small,'debit',0,'credit',NEW.opening_cash,'description','Opening float issued from Small Money')));
  END IF;
  INSERT INTO shift_cash_treasury(session_id,opening_float,issued_je_id) VALUES(NEW.id,NEW.opening_cash,je);
  RETURN NEW;
END $$;
CREATE TRIGGER issue_shift_cash_float AFTER INSERT ON pos_sessions
FOR EACH ROW EXECUTE FUNCTION _issue_shift_cash_float_v1();

CREATE FUNCTION public._guard_shift_cash_treasury_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM shift_cash_treasury WHERE session_id=OLD.id) THEN
    IF NEW.opening_cash IS DISTINCT FROM OLD.opening_cash OR NEW.opened_by IS DISTINCT FROM OLD.opened_by
      OR NEW.opened_at IS DISTINCT FROM OLD.opened_at THEN RAISE EXCEPTION 'issued_shift_float_is_immutable'; END IF;
    IF EXISTS (SELECT 1 FROM shift_cash_treasury WHERE session_id=OLD.id AND settled_at IS NOT NULL)
      AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.closing_cash IS DISTINCT FROM OLD.closing_cash
        OR NEW.closed_by IS DISTINCT FROM OLD.closed_by OR NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
      RAISE EXCEPTION 'settled_shift_is_immutable';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER guard_shift_cash_treasury BEFORE UPDATE ON pos_sessions
FOR EACH ROW EXECUTE FUNCTION _guard_shift_cash_treasury_v1();

-- La création du Z-report survient après tous les contrôles de clôture et la JE d'écart.
CREATE FUNCTION public._settle_shift_cash_drawer_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s pos_sessions%ROWTYPE; track shift_cash_treasury%ROWTYPE;
  returned numeric; deposited numeric; je uuid; lines jsonb := '[]'; drawer uuid;
BEGIN
  SELECT * INTO s FROM pos_sessions WHERE id=NEW.shift_id FOR UPDATE;
  IF s.status <> 'closed' THEN RETURN NEW; END IF;
  SELECT * INTO track FROM shift_cash_treasury WHERE session_id=s.id FOR UPDATE;
  -- Les sessions antérieures à la bascule ne sont pas réécrites.
  IF NOT FOUND OR track.settled_at IS NOT NULL THEN RETURN NEW; END IF;
  IF s.closing_cash IS NULL OR s.closing_cash < 0 OR s.closing_cash::text IN ('NaN','Infinity','-Infinity')
    OR s.closing_cash <> round(s.closing_cash,2) OR s.closed_by IS NULL THEN
    RAISE EXCEPTION 'invalid_shift_settlement';
  END IF;
  returned:=least(track.opening_float,s.closing_cash);
  deposited:=s.closing_cash-returned;
  IF s.closing_cash > 0 THEN
    drawer:=resolve_mapping_account('SALE_PAYMENT_CASH');
    IF returned > 0 THEN lines:=lines||jsonb_build_array(jsonb_build_object(
      'account_id',resolve_mapping_account('CASH_WALLET_SMALL_MONEY'),'debit',returned,'credit',0,'description','Shift float returned to Small Money')); END IF;
    IF deposited > 0 THEN lines:=lines||jsonb_build_array(jsonb_build_object(
      'account_id',resolve_mapping_account('CASH_WALLET_UNDEPOSITED'),'debit',deposited,'credit',0,'description','Counted shift receipts deposited in Undeposited cash')); END IF;
    lines:=lines||jsonb_build_array(jsonb_build_object('account_id',drawer,'debit',0,'credit',s.closing_cash,'description','Cash Drawer emptied after validated shift close'));
    je:=_emit_shift_cash_transfer_v1(s.id,'shift_cash_settlement',s.closed_at::date,s.closed_by,lines);
  END IF;
  UPDATE shift_cash_treasury SET settlement_je_id=je,settled_at=now(),returned_float=returned,safe_deposit=deposited
    WHERE session_id=s.id;
  RETURN NEW;
END $$;
CREATE TRIGGER settle_shift_cash_drawer AFTER INSERT ON z_reports
FOR EACH ROW EXECUTE FUNCTION _settle_shift_cash_drawer_v1();

REVOKE ALL ON FUNCTION _emit_shift_cash_transfer_v1(uuid,text,date,uuid,jsonb) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _issue_shift_cash_float_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _settle_shift_cash_drawer_v1() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION _guard_shift_cash_treasury_v1() FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.get_cash_wallet_balances_v3()
 RETURNS TABLE(account_code text, account_name text, balance numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT has_permission(auth.uid(), 'accounting.cash.read') THEN
    RAISE EXCEPTION 'permission denied: accounting.cash.read' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT a.code, a.name,
         COALESCE(SUM(jel.debit - jel.credit) FILTER (WHERE je.id IS NOT NULL), 0)::numeric AS balance
  FROM accounts a
  LEFT JOIN journal_entry_lines jel ON jel.account_id = a.id
  LEFT JOIN journal_entries je ON je.id = jel.journal_entry_id AND je.status = 'posted'
  WHERE a.code IN ('1110','1111','1117','1118','1119')
  GROUP BY a.code, a.name
  ORDER BY a.code;
END $function$;
DROP FUNCTION public.get_cash_wallet_balances_v2();
REVOKE ALL ON FUNCTION public.get_cash_wallet_balances_v3() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_cash_wallet_balances_v3() TO authenticated;
