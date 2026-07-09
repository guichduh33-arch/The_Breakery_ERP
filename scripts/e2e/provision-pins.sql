-- scripts/e2e/provision-pins.sql
-- S71 — set the 2 E2E users' PINs from CI secrets (never committed).
-- Invoked by playwright-e2e.yml:
--   psql "$V3_DEV_PG_POOLER_URL" -v ON_ERROR_STOP=1 \
--     -v adminpin="$E2E_PIN_ADMIN" -v cashpin="$E2E_PIN_CASHIER" \
--     -f scripts/e2e/provision-pins.sql
-- hash_pin() = crypt(pin, gen_salt('bf',10)) — verified by verify_user_pin().
UPDATE public.user_profiles
   SET pin_hash = public.hash_pin(:'adminpin'),
       failed_login_attempts = 0,
       locked_until = NULL
 WHERE id = '0e2e0000-0000-4000-a000-000000000001';

UPDATE public.user_profiles
   SET pin_hash = public.hash_pin(:'cashpin'),
       failed_login_attempts = 0,
       locked_until = NULL
 WHERE id = '0e2e0000-0000-4000-a000-000000000002';

-- S71 Plan 2 — ensure an OPEN shift exists for the E2E cashier so POS sale
-- flows aren't blocked by the "No shift open" dialog. Idempotent: insert only
-- if the cashier has no open shift. pos_sessions.status defaults to 'open'.
INSERT INTO public.pos_sessions (opened_by, opening_cash)
SELECT '0e2e0000-0000-4000-a000-000000000002', 100000
 WHERE NOT EXISTS (
   SELECT 1 FROM public.pos_sessions
    WHERE opened_by = '0e2e0000-0000-4000-a000-000000000002'
      AND status = 'open'
 );
