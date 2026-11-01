-- Outstanding est une créance ; seuls les règlements réels vont dans order_payments.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS outstanding_at timestamptz;
DO $backfill$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='order_payments' AND column_name='session_id') THEN
    ALTER TABLE public.order_payments ADD COLUMN session_id uuid REFERENCES public.pos_sessions(id);
    UPDATE public.order_payments p SET session_id=o.session_id FROM public.orders o WHERE o.id=p.order_id;
  END IF;
END $backfill$;
CREATE INDEX IF NOT EXISTS order_payments_session_idx ON public.order_payments(session_id);
CREATE INDEX IF NOT EXISTS orders_outstanding_idx ON public.orders(created_at, id)
  WHERE outstanding_at IS NOT NULL AND status IN ('draft','pending_payment');
CREATE TABLE IF NOT EXISTS public.pos_payment_attempt_keys (
  key uuid PRIMARY KEY, order_id uuid NOT NULL REFERENCES public.orders(id),
  actor_id uuid NOT NULL REFERENCES public.user_profiles(id), request jsonb NOT NULL,
  result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.pos_payment_attempt_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.pos_payment_attempt_keys FROM PUBLIC, anon, authenticated;
INSERT INTO public.accounting_mappings(mapping_key, account_code, description)
  VALUES('POS_RECEIVABLE','1131','POS outstanding customer receivables')
  ON CONFLICT(mapping_key) DO NOTHING;

CREATE FUNCTION public._capture_payment_session_v2() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $fn$
BEGIN
  NEW.session_id := CASE WHEN current_setting('breakery.payment_origin',true)='backoffice' THEN NULL
    ELSE COALESCE(NULLIF(current_setting('breakery.payment_session_id',true),'')::uuid,
      NEW.session_id,(SELECT session_id FROM orders WHERE id=NEW.order_id)) END;
  RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS capture_payment_session ON public.order_payments;
CREATE TRIGGER capture_payment_session BEFORE INSERT ON public.order_payments
  FOR EACH ROW EXECUTE FUNCTION public._capture_payment_session_v2();
REVOKE ALL ON FUNCTION public._capture_payment_session_v2() FROM PUBLIC,anon,authenticated;
DROP FUNCTION IF EXISTS public._capture_payment_session_v1();

CREATE SCHEMA IF NOT EXISTS pos_deferred_private;
REVOKE ALL ON SCHEMA pos_deferred_private FROM PUBLIC,anon,authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA pos_deferred_private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
