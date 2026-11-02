-- Exception de transition approuvée : les terminaux anciens restent utilisables.
CREATE OR REPLACE FUNCTION public.reopen_held_order_v6(p_order_id uuid,p_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
 SELECT public.reopen_held_order_v9(p_order_id,p_session_id);
$fn$;
REVOKE ALL ON FUNCTION public.reopen_held_order_v6(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reopen_held_order_v6(uuid,uuid) TO authenticated,service_role;
CREATE OR REPLACE FUNCTION public.close_shift_v10(p_session_id uuid,p_counted_cash numeric,p_notes text DEFAULT NULL,
 p_idempotency_key uuid DEFAULT NULL,p_approver_id uuid DEFAULT NULL,p_manager_pin text DEFAULT NULL,
 p_counted_qris numeric DEFAULT NULL,p_counted_card numeric DEFAULT NULL,p_denominations jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE sql SECURITY INVOKER SET search_path=public,pg_temp AS $fn$
 SELECT public.close_shift_v13(p_session_id,p_counted_cash,p_notes,p_idempotency_key,p_approver_id,p_manager_pin,
   p_counted_qris,p_counted_card,p_denominations);
$fn$;
REVOKE ALL ON FUNCTION public.close_shift_v10(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_shift_v10(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb) TO authenticated,service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
