-- Précondition de lecture des ventes : shifts clos, sans opname ni libération.
-- Inclure après BEGIN ; le ROLLBACK annule la clôture synthétique des shifts DEV.
CREATE OR REPLACE FUNCTION pg_temp.fixture_released_days(p_start date,p_end date)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $fixture$
BEGIN
 IF current_user<>'postgres' THEN RAISE EXCEPTION 'fixture_owner_required'; END IF;
 IF p_start IS NULL OR p_end IS NULL OR p_start>p_end OR p_end>current_date THEN
  RAISE EXCEPTION 'fixture_requires_past_or_current_days'; END IF;
 UPDATE public.pos_sessions SET status='closed',closed_at=GREATEST(opened_at,COALESCE(closed_at,now()))
 WHERE opened_at::date<=p_end AND (status<>'closed' OR closed_at IS NULL);
END $fixture$;
REVOKE ALL ON FUNCTION pg_temp.fixture_released_days(date,date) FROM PUBLIC,anon,authenticated;
