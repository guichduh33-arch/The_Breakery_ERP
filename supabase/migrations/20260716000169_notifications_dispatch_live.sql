-- 20260716000169_notifications_dispatch_live.sql
-- Settings §6.A (audit 2026-07-16) — make the notifications pipeline actually
-- run, and let the dispatcher render email_templates HTML.
--
-- Findings this closes:
--   * NOTHING triggered the dispatcher: rows enqueued by the birthday cron sat
--     in `queued` forever (no cron on notification-dispatch). A minutely
--     pg_cron + pg_net job now POSTs the EF, authenticated by the shared
--     secret read from Vault (name: notification_dispatch_secret) — the secret
--     itself is NOT in this file (CLAUDE.md: never commit secrets).
--   * The outbox stored only the SUBSTITUTED text, so the dispatcher could not
--     re-render the message as HTML (email_templates.body_html needs the raw
--     variables). enqueue v2 persists them in a new `variables` column.
--
-- RPC bumps (versioning monotone, bodies copied from live pg_get_functiondef):
--   enqueue_notification_v1      -> v2  (persists p_variables)
--   pick_notifications_batch_v1  -> v2  (returns variables)
--   notify_birthday_customers_v1 -> v2  (repointed to enqueue v2; dormant
--                                        DB-side fallback, the live producer is
--                                        the customer-birthday-notify EF)
-- Old versions DROPped here; the EF call-sites are repointed in this commit.

-- =============================================================================
-- 1. Outbox: persist the raw template variables for deferred HTML rendering
-- =============================================================================

ALTER TABLE notification_outbox
  ADD COLUMN IF NOT EXISTS variables JSONB;

COMMENT ON COLUMN notification_outbox.variables IS
  'Raw {{var}} substitution map captured at enqueue time — lets the dispatcher render email_templates.body_html without re-deriving business context.';

-- =============================================================================
-- 2. enqueue_notification_v2 (live v1 body + variables persisted)
-- =============================================================================

CREATE FUNCTION public.enqueue_notification_v2(
  p_template_code text,
  p_recipient text,
  p_variables jsonb DEFAULT '{}'::jsonb,
  p_channel text DEFAULT NULL::text,
  p_scheduled_for timestamp with time zone DEFAULT NULL::timestamp with time zone,
  p_idempotency_key uuid DEFAULT NULL::uuid
)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_template  notification_templates%ROWTYPE;
  v_channel   TEXT;
  v_subject   TEXT;
  v_body      TEXT;
  v_existing  UUID;
  v_id        UUID;
BEGIN
  IF auth.uid() IS NOT NULL AND NOT has_permission(auth.uid(), 'notifications.send') THEN
    RAISE EXCEPTION 'permission_denied: notifications.send' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_existing
    FROM notification_outbox
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN RETURN v_existing; END IF;
  END IF;

  SELECT * INTO v_template
  FROM notification_templates
  WHERE code = p_template_code AND is_active = true;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'template_not_found: %', p_template_code USING ERRCODE = 'P0002';
  END IF;

  v_channel := COALESCE(p_channel, v_template.channel);
  IF v_channel NOT IN ('email','sms','push','inapp') THEN
    RAISE EXCEPTION 'invalid_channel: %', v_channel USING ERRCODE = '22023';
  END IF;

  v_subject := _notif_substitute(v_template.subject_template, COALESCE(p_variables, '{}'::jsonb));
  v_body    := _notif_substitute(v_template.body_template,    COALESCE(p_variables, '{}'::jsonb));

  INSERT INTO notification_outbox (
    template_code, channel, recipient, subject, body, status,
    idempotency_key, scheduled_for, variables
  ) VALUES (
    p_template_code, v_channel, p_recipient, v_subject, v_body, 'queued',
    p_idempotency_key, COALESCE(p_scheduled_for, now()),
    COALESCE(p_variables, '{}'::jsonb)
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

DROP FUNCTION public.enqueue_notification_v1(text, text, jsonb, text, timestamp with time zone, uuid);

-- =============================================================================
-- 3. pick_notifications_batch_v2 (live v1 body + variables in the return set)
-- =============================================================================

CREATE FUNCTION public.pick_notifications_batch_v2(p_limit integer DEFAULT 50)
 RETURNS TABLE(
   id uuid, template_code text, channel text, recipient text, subject text,
   body text, status text, retries integer,
   scheduled_for timestamp with time zone, variables jsonb
 )
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  WITH picked AS (
    SELECT o.id
    FROM   notification_outbox o
    WHERE  o.status IN ('queued','retry')
      AND  o.scheduled_for <= now()
    ORDER  BY o.scheduled_for ASC, o.created_at ASC
    LIMIT  GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  bumped AS (
    UPDATE notification_outbox o
       SET status = 'sending'
      FROM picked p
     WHERE o.id = p.id
   RETURNING o.id, o.template_code, o.channel, o.recipient, o.subject, o.body,
             o.status, o.retries, o.scheduled_for, o.variables
  )
  SELECT b.id, b.template_code, b.channel, b.recipient, b.subject, b.body,
         b.status, b.retries, b.scheduled_for, b.variables
  FROM bumped b;
END;
$function$;

DROP FUNCTION public.pick_notifications_batch_v1(integer);

-- =============================================================================
-- 4. notify_birthday_customers_v2 (dormant DB fallback, repointed to enqueue v2)
-- =============================================================================

CREATE FUNCTION public.notify_birthday_customers_v2()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_today          DATE := current_date;
  v_today_month    INT  := EXTRACT(MONTH FROM current_date)::INT;
  v_today_day      INT  := EXTRACT(DAY   FROM current_date)::INT;
  v_namespace      UUID := 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'::UUID;
  v_count          INT  := 0;
  v_cust           RECORD;
  v_idem           UUID;
  v_vars           JSONB;
BEGIN
  FOR v_cust IN
    SELECT id, name, email, lifetime_points
    FROM public.customers
    WHERE deleted_at IS NULL
      AND birth_date IS NOT NULL
      AND EXTRACT(MONTH FROM birth_date)::INT = v_today_month
      AND EXTRACT(DAY   FROM birth_date)::INT = v_today_day
      AND email IS NOT NULL
      AND length(trim(email)) > 0
      AND marketing_consent = true
  LOOP
    v_idem := extensions.uuid_generate_v5(
      v_namespace,
      'birthday-' || v_cust.id::TEXT || '-' || v_today::TEXT
    );

    v_vars := jsonb_build_object(
      'customer_name', COALESCE(v_cust.name, 'friend'),
      'bonus_points',  50
    );

    BEGIN
      PERFORM public.enqueue_notification_v2(
        p_template_code   => 'customer_birthday',
        p_recipient       => v_cust.email,
        p_variables       => v_vars,
        p_channel         => 'email',
        p_scheduled_for   => NULL,
        p_idempotency_key => v_idem
      );
      v_count := v_count + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'notify_birthday_customers_v2 skipped customer %: %',
        v_cust.id, SQLERRM;
    END;
  END LOOP;

  RETURN v_count;
END;
$function$;

DROP FUNCTION public.notify_birthday_customers_v1();

-- =============================================================================
-- 5. Grants — REVOKE pair (anon defense-in-depth) + mirror of the v1 ACLs
-- =============================================================================

REVOKE EXECUTE ON FUNCTION public.enqueue_notification_v2(text, text, jsonb, text, timestamp with time zone, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.enqueue_notification_v2(text, text, jsonb, text, timestamp with time zone, uuid) FROM anon;
GRANT  EXECUTE ON FUNCTION public.enqueue_notification_v2(text, text, jsonb, text, timestamp with time zone, uuid) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.pick_notifications_batch_v2(integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pick_notifications_batch_v2(integer) FROM anon;
GRANT  EXECUTE ON FUNCTION public.pick_notifications_batch_v2(integer) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.notify_birthday_customers_v2() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_birthday_customers_v2() FROM anon;
GRANT  EXECUTE ON FUNCTION public.notify_birthday_customers_v2() TO service_role;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- =============================================================================
-- 6. Minutely dispatcher cron — pg_cron + pg_net, secret read from Vault.
--    Provisioning (owner action, NOT in this file):
--      SELECT vault.create_secret('<value>', 'notification_dispatch_secret');
--      supabase secrets set NOTIFICATION_DISPATCH_SECRET=<same value>
--    Until both exist the EF answers 401 and rows stay queued — safe no-op.
-- =============================================================================

DO $$
BEGIN
  PERFORM cron.unschedule('notification-dispatch-minutely');
EXCEPTION WHEN OTHERS THEN NULL;
END$$;

SELECT cron.schedule(
  'notification-dispatch-minutely',
  '* * * * *',
  $cron$
    SELECT net.http_post(
      'https://ikcyvlovptebroadgtvd.functions.supabase.co/notification-dispatch',
      jsonb_build_object('triggered_at', now()::text),
      '{}'::jsonb,
      jsonb_build_object(
        'Content-Type', 'application/json',
        'x-dispatch-secret', COALESCE(
          (SELECT decrypted_secret FROM vault.decrypted_secrets
            WHERE name = 'notification_dispatch_secret' LIMIT 1),
          'unset')
      )
    );
  $cron$
);
