-- Contrat identique au corps live précédent, pagination dense et lecture authentifiée.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE pagination_results(seq serial, tap text);
INSERT INTO pagination_results(tap) SELECT no_plan();

CREATE FUNCTION pg_temp.activity_baseline(p_cursor text DEFAULT NULL::text, p_limit integer DEFAULT 50, p_actor_id uuid DEFAULT NULL::uuid, p_action text DEFAULT NULL::text, p_entity_type text DEFAULT NULL::text, p_entity_id uuid DEFAULT NULL::uuid, p_date_start text DEFAULT NULL::text, p_date_end text DEFAULT NULL::text)
 RETURNS TABLE(id text, actor_id uuid, actor_name text, action text, entity_type text, entity_id uuid, metadata jsonb, payload jsonb, created_at timestamp with time zone, source text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cfg AS (
    SELECT COALESCE(MAX(timezone), 'Asia/Makassar') AS tz
    FROM business_config WHERE id = 1
  ), bounds AS (
    SELECT
      CASE WHEN p_date_start IS NULL THEN NULL
           ELSE p_date_start::date::timestamp AT TIME ZONE (SELECT tz FROM cfg) END AS lo,
      CASE WHEN p_date_end IS NULL THEN NULL
           ELSE (p_date_end::date + 1)::timestamp AT TIME ZONE (SELECT tz FROM cfg) END AS hi
  ), unified AS (
    SELECT 'audit:' || lpad(al.id::text, 20, '0') AS id, al.actor_id,
      al.action, al.entity_type, al.entity_id, al.metadata, al.payload,
      al.created_at, 'audit'::text AS source
    FROM audit_logs al, bounds b
    WHERE (b.lo IS NULL OR al.created_at >= b.lo)
      AND (b.hi IS NULL OR al.created_at < b.hi)
    UNION ALL
    SELECT 'pos:' || e.id::text, e.actor_id, 'pos.' || e.event_type::text,
      CASE WHEN e.order_id IS NULL THEN 'pos_device' ELSE 'order' END,
      COALESCE(e.order_id, e.device_id),
      jsonb_strip_nulls(jsonb_build_object(
        'order_number', e.order_number_snap, 'amount', e.amount, 'reason', e.reason,
        'device_id', e.device_id, 'session_id', e.session_id,
        'order_item_id', e.order_item_id, 'recorded_at', e.recorded_at,
        'synced_by', e.synced_by, 'source', 'client'
      )), e.payload, e.occurred_at, 'pos'::text
    FROM pos_events e, bounds b
    WHERE (b.lo IS NULL OR e.occurred_at >= b.lo)
      AND (b.hi IS NULL OR e.occurred_at < b.hi)
  ), page AS (
    SELECT u.* FROM unified u
    WHERE (p_cursor IS NULL OR (u.created_at, u.id) <
      (split_part(p_cursor, '|', 1)::timestamptz, split_part(p_cursor, '|', 2)))
      AND (p_actor_id IS NULL OR u.actor_id = p_actor_id)
      AND (p_action IS NULL OR u.action = p_action)
      AND (p_entity_type IS NULL OR u.entity_type = p_entity_type)
      AND (p_entity_id IS NULL OR u.entity_id = p_entity_id)
    ORDER BY u.created_at DESC, u.id DESC
    LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200)
  )
  SELECT p.id, p.actor_id, up.full_name, p.action, p.entity_type, p.entity_id,
    p.metadata, p.payload, p.created_at, p.source
  FROM page p LEFT JOIN user_profiles up ON up.id = p.actor_id
  ORDER BY p.created_at DESC, p.id DESC;
$function$;


CREATE FUNCTION pg_temp.test_activity_pagination() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid; v_auth uuid; v_low_auth uuid; v_device uuid := gen_random_uuid();
  v_entity uuid := gen_random_uuid(); v_cursor text; v_cfg jsonb; v_actual jsonb; v_expected jsonb;
  v_ids text[] := ARRAY[]::text[]; v_page text[]; v_last text; v_round integer := 0;
  v_started timestamptz; v_elapsed interval; v_rows integer;
  v_negative bigint := -1000000000000000000 - floor(random()*1000000)::bigint*10;
BEGIN
  SELECT id, auth_user_id INTO STRICT v_actor, v_auth FROM user_profiles
  WHERE role_code='SUPER_ADMIN' AND is_active AND deleted_at IS NULL LIMIT 1;
  PERFORM pg_temp.authenticate_pin(v_auth);
  INSERT INTO pos_devices(id,device_token,label) VALUES(v_device,gen_random_uuid()::text,'Pagination fixture');
  INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata,payload,created_at)
  SELECT CASE WHEN i%10=0 THEN NULL ELSE v_actor END,'pagination.fixture','order',v_entity,
    jsonb_build_object('amount',i),jsonb_build_object('before',i-1,'after',i),
    '2026-11-07T23:55:00+08:00'::timestamptz + (i%3)*interval '1 minute'
  FROM generate_series(1,350) i;
  -- Les identifiants historiques suivent le tri texte du curseur, même négatifs.
  INSERT INTO audit_logs(id,actor_id,action,entity_type,entity_id,created_at)
  SELECT v_negative-i,v_actor,'pagination.fixture','order',v_entity,'2026-11-07T23:57:00+08:00'
  FROM generate_series(1,2) i;
  INSERT INTO pos_events(client_event_id,event_type,occurred_at,device_id,actor_id,order_id,order_number_snap,payload)
  SELECT gen_random_uuid(),'item_added','2026-11-07T23:55:00+08:00'::timestamptz + (i%3)*interval '1 minute',
    v_device,CASE WHEN i%10=0 THEN NULL ELSE v_actor END,
    CASE WHEN i%2=0 THEN v_entity ELSE NULL END,'PAGINATION-TEST',jsonb_build_object('qty',i)
  FROM generate_series(1,350) i;
  SELECT r.created_at::text || '|' || r.id INTO v_cursor
  FROM pg_temp.activity_baseline(p_entity_id:=v_entity,p_limit:=17) r ORDER BY r.created_at,r.id LIMIT 1;
  FOR v_cfg IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    jsonb_build_object('limit',50,'entity',v_entity),
    jsonb_build_object('limit',1,'entity',v_entity,'action','pagination.fixture',
      'cursor','2026-11-07T23:57:00+08:00|audit:00000000000000000000'),
    jsonb_build_object('limit',17,'entity',v_entity,'cursor',v_cursor),
    jsonb_build_object('limit',200,'entity',v_entity,'action','pagination.fixture'),
    jsonb_build_object('limit',200,'entity',v_entity,'action','pos.item_added'),
    jsonb_build_object('limit',200,'entity',v_entity,'actor',v_actor),
    jsonb_build_object('limit',50,'entity',v_entity,'actor',gen_random_uuid()),
    jsonb_build_object('limit',50,'entity',v_device,'type','pos_device'),
    jsonb_build_object('limit',50,'entity',v_entity,'start','2026-11-07','end','2026-11-07'),
    jsonb_build_object('limit',50,'entity',v_entity,'end','2026-11-06'),
    jsonb_build_object('limit',0,'entity',v_entity),
    jsonb_build_object('limit',500,'entity',v_entity),
    jsonb_build_object('entity',v_entity))) LOOP
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC),'[]') INTO v_expected
    FROM pg_temp.activity_baseline(p_cursor:=v_cfg->>'cursor',p_limit:=(v_cfg->>'limit')::integer,
      p_actor_id:=(v_cfg->>'actor')::uuid,p_action:=v_cfg->>'action',p_entity_type:=v_cfg->>'type',
      p_entity_id:=(v_cfg->>'entity')::uuid,p_date_start:=v_cfg->>'start',p_date_end:=v_cfg->>'end') r;
    SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.created_at DESC,r.id DESC),'[]') INTO v_actual
    FROM get_activity_logs_v2(p_cursor:=v_cfg->>'cursor',p_limit:=(v_cfg->>'limit')::integer,
      p_actor_id:=(v_cfg->>'actor')::uuid,p_action:=v_cfg->>'action',p_entity_type:=v_cfg->>'type',
      p_entity_id:=(v_cfg->>'entity')::uuid,p_date_start:=v_cfg->>'start',p_date_end:=v_cfg->>'end') r;
    RETURN NEXT is(v_actual,v_expected,'contrat complet identique : ' || v_cfg::text);
  END LOOP;
  v_cursor := NULL;
  LOOP
    SELECT array_agg(r.id ORDER BY r.created_at DESC,r.id DESC),
      (array_agg(r.created_at::text || '|' || r.id ORDER BY r.created_at,r.id))[1]
    INTO v_page,v_last FROM get_activity_logs_v2(p_cursor:=v_cursor,p_limit:=37,p_entity_id:=v_entity) r;
    EXIT WHEN v_page IS NULL;
    v_ids := v_ids || v_page; v_cursor := v_last; v_round := v_round+1;
    IF v_round > 20 THEN RAISE EXCEPTION 'pagination_not_terminating'; END IF;
  END LOOP;
  RETURN NEXT is(cardinality(v_ids),527,'toutes les lignes des deux sources sont paginées');
  RETURN NEXT is((SELECT count(DISTINCT id)::integer FROM unnest(v_ids) id),527,'aucun doublon aux horodatages identiques');
  RETURN NEXT ok(to_regprocedure('public.get_activity_logs_v1(text,integer,uuid,text,text,uuid,text,text)') IS NULL,'ancien endpoint retiré');
  RETURN NEXT ok(NOT has_function_privilege('anon','public.get_activity_logs_v2(text,integer,uuid,text,text,uuid,text,text)','EXECUTE'),'anon et PUBLIC exclus');
  RETURN NEXT ok(NOT (SELECT prosecdef FROM pg_proc WHERE oid='public.get_activity_logs_v2(text,integer,uuid,text,text,uuid,text,text)'::regprocedure),'SECURITY INVOKER conservé');
  RETURN NEXT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='audit_logs_activity_cursor_idx'),'index du curseur audit présent');
  RETURN NEXT ok(EXISTS(SELECT 1 FROM pg_indexes WHERE indexname='pos_events_activity_cursor_idx'),'index du curseur POS présent');
  EXECUTE 'SET LOCAL ROLE authenticated';
  v_started := clock_timestamp();
  SELECT count(*)::integer INTO v_rows FROM get_activity_logs_v2(p_date_start:='2026-11-07',p_date_end:='2026-11-07');
  v_elapsed := clock_timestamp()-v_started;
  RETURN NEXT is(v_rows,50,'lecture non filtrée authentifiée bornée');
  RETURN NEXT ok(v_elapsed < interval '8 seconds','lecture dans le budget PostgREST : ' || v_elapsed::text);
  EXECUTE 'RESET ROLE';
  SELECT auth_user_id INTO STRICT v_low_auth FROM user_profiles
  WHERE role_code='ADMIN' AND is_active AND deleted_at IS NULL LIMIT 1;
  PERFORM pg_temp.authenticate_pin(v_low_auth);
  EXECUTE 'SET LOCAL ROLE authenticated';
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v2(p_entity_id:=v_entity)),0,'confidentialité non-Owner conservée');
  PERFORM set_config('request.jwt.claims','{}',true);
  PERFORM set_config('request.jwt.claim.sub','',true);
  RETURN NEXT is((SELECT count(*)::integer FROM get_activity_logs_v2(p_entity_id:=v_entity)),0,'session absente sans accès');
  EXECUTE 'RESET ROLE';
END;
$$;
INSERT INTO pagination_results(tap) SELECT * FROM pg_temp.test_activity_pagination();
INSERT INTO pagination_results(tap) SELECT * FROM finish();
SELECT tap FROM pagination_results ORDER BY seq;
ROLLBACK;
