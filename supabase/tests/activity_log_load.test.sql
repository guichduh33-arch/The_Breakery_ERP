-- Charge et contexte RLS proches du journal réel ; fixtures exclusivement DEV, annulées.
BEGIN;
\ir helpers/pin_session.sql
CREATE TEMP TABLE load_results(seq serial, tap text);
INSERT INTO load_results(tap) SELECT no_plan();

CREATE FUNCTION pg_temp.test_activity_load() RETURNS SETOF text LANGUAGE plpgsql AS $$
DECLARE
  v_actor uuid; v_auth uuid; v_device uuid := gen_random_uuid();
  v_started timestamptz; v_elapsed interval; v_cursor text; v_ids text[];
  v_previous text[]; v_count integer; v_round integer;
BEGIN
  SELECT id,auth_user_id INTO STRICT v_actor,v_auth FROM user_profiles
  WHERE role_code='SUPER_ADMIN' AND is_active AND deleted_at IS NULL LIMIT 1;
  PERFORM pg_temp.authenticate_pin(v_auth);
  INSERT INTO pos_devices(id,device_token,label)
  VALUES(v_device,gen_random_uuid()::text,'Activity load fixture');
  -- Historique hors plage supérieur à la production observée le 08/11/2026.
  INSERT INTO audit_logs(actor_id,action,entity_type,created_at)
  SELECT v_actor,'activity.load_history','activity_load',
    '2026-10-01T00:00:00+08:00'::timestamptz + (i%30)*interval '1 day'
  FROM generate_series(1,25000) i;
  INSERT INTO pos_events(client_event_id,event_type,occurred_at,device_id,actor_id)
  SELECT gen_random_uuid(),'item_added',
    '2026-10-01T00:00:00+08:00'::timestamptz + (i%30)*interval '1 day',v_device,v_actor
  FROM generate_series(1,8000) i;
  INSERT INTO audit_logs(actor_id,action,entity_type,created_at)
  SELECT v_actor,'activity.load_day','activity_load',
    '2026-11-07T12:00:00+08:00'::timestamptz + i*interval '1 second'
  FROM generate_series(1,1000) i;
  INSERT INTO pos_events(client_event_id,event_type,occurred_at,device_id,actor_id)
  SELECT gen_random_uuid(),'item_added',
    '2026-11-07T12:00:00+08:00'::timestamptz + i*interval '1 second',v_device,v_actor
  FROM generate_series(1,1800) i;
  -- Même lorsque l'appelant réutilise un plan générique, les filtres internes sont connus.
  PERFORM set_config('plan_cache_mode','force_generic_plan',true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  FOR v_round IN 1..6 LOOP
    v_started := clock_timestamp();
    SELECT array_agg(r.id ORDER BY r.created_at DESC,r.id DESC),
      (array_agg(r.created_at::text || '|' || r.id ORDER BY r.created_at,r.id))[1]
    INTO v_ids,v_cursor FROM get_activity_logs_v3(
      p_date_start:='2026-11-07',p_date_end:='2026-11-07',p_limit:=50) r;
    v_elapsed := clock_timestamp()-v_started;
    RETURN NEXT is(cardinality(v_ids),50,'page authentifiée sous charge, appel ' || v_round);
    RETURN NEXT ok(v_elapsed < interval '2 seconds',
      'garde de régression 2 s, appel ' || v_round || ' : ' || v_elapsed::text);
    IF v_previous IS NOT NULL THEN
      RETURN NEXT is(v_ids,v_previous,'résultat stable après réutilisation du plan');
    END IF;
    v_previous := v_ids;
  END LOOP;
  v_started := clock_timestamp();
  SELECT count(*)::integer INTO v_count FROM get_activity_logs_v3(
    p_cursor:=v_cursor,p_date_start:='2026-11-07',p_date_end:='2026-11-07') r;
  RETURN NEXT is(v_count,50,'deuxième page sous charge');
  RETURN NEXT ok(clock_timestamp()-v_started < interval '2 seconds','curseur dans le budget');
  v_started := clock_timestamp();
  SELECT count(*)::integer INTO v_count FROM get_activity_logs_v3(
    p_date_start:='2026-11-07',p_date_end:='2026-11-07',p_action:='activity.load_day') r;
  RETURN NEXT is(v_count,50,'filtre audit sous charge');
  RETURN NEXT ok(clock_timestamp()-v_started < interval '2 seconds','filtre audit dans le budget');
  v_started := clock_timestamp();
  SELECT count(*)::integer INTO v_count FROM get_activity_logs_v3(
    p_date_start:='2026-11-07',p_date_end:='2026-11-07',p_action:='activity.load_absent') r;
  RETURN NEXT is(v_count,0,'filtre sans résultat sous charge');
  RETURN NEXT ok(clock_timestamp()-v_started < interval '2 seconds','filtre vide dans le budget');
  RETURN NEXT is(current_setting('plan_cache_mode'),'force_generic_plan','configuration de l’appelant restaurée');
  EXECUTE 'RESET ROLE';
END;
$$;
INSERT INTO load_results(tap) SELECT * FROM pg_temp.test_activity_load();
INSERT INTO load_results(tap) SELECT * FROM finish();
SELECT tap FROM load_results ORDER BY seq;
ROLLBACK;
