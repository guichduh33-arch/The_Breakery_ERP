-- Appareils LAN : autorisations distinctes des sessions employé.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE public.lan_device_credentials (
 device_id uuid PRIMARY KEY REFERENCES public.lan_devices(id),
 pairing_hash text UNIQUE,
 pairing_expires_at timestamptz,
 secret_hash text,
 paired_at timestamptz,
 revoked_at timestamptz,
 permissions text[] NOT NULL DEFAULT '{}',
 created_by uuid NOT NULL REFERENCES public.user_profiles(id),
 CHECK (pairing_hash IS NULL OR pairing_hash ~ '^[0-9a-f]{64}$'),
 CHECK (secret_hash IS NULL OR secret_hash ~ '^[0-9a-f]{64}$'),
 CHECK (permissions <@ ARRAY['orders.publish','orders.read','kitchen.publish','kitchen.read','receipts.print','tickets.print','drawer.open','payments.publish','payments.read','cart.publish','cart.read','diagnostics']::text[])
);
ALTER TABLE public.lan_device_credentials ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.lan_device_credentials FROM PUBLIC, anon, authenticated, kiosk_display;
GRANT ALL ON public.lan_device_credentials TO service_role;

CREATE FUNCTION public.manage_lan_device_v1(p_actor_id uuid, p_action text, p_device_id uuid DEFAULT NULL, p_permissions text[] DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE actor public.user_profiles%ROWTYPE; device public.lan_devices%ROWTYPE; code text; caps text[]; result jsonb;
BEGIN
 SELECT * INTO actor FROM public.user_profiles WHERE id=p_actor_id AND is_active AND deleted_at IS NULL;
 IF NOT FOUND OR NOT public.has_permission(actor.auth_user_id,'lan.devices.manage') THEN
  RAISE EXCEPTION 'permission_denied' USING ERRCODE='42501';
 END IF;
 IF p_action='list' THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'name',d.name,'device_type',d.device_type,
   'is_active',d.is_active,'paired_at',c.paired_at,'revoked_at',c.revoked_at,
   'permissions',coalesce(c.permissions,'{}'::text[])) ORDER BY d.code),'[]'::jsonb) INTO result
  FROM public.lan_devices d LEFT JOIN public.lan_device_credentials c ON c.device_id=d.id
  WHERE d.deleted_at IS NULL AND d.device_type IN ('pos','tablet','kds');
  RETURN result;
 END IF;
 SELECT * INTO device FROM public.lan_devices WHERE id=p_device_id AND deleted_at IS NULL FOR UPDATE;
 IF NOT FOUND OR device.device_type NOT IN ('pos','tablet','kds') THEN
  RAISE EXCEPTION 'invalid_device' USING ERRCODE='22023';
 END IF;
 IF p_action='issue' THEN
  IF NOT device.is_active THEN RAISE EXCEPTION 'device_inactive' USING ERRCODE='22023'; END IF;
  caps:=CASE device.device_type
   WHEN 'pos' THEN ARRAY['orders.publish','orders.read','kitchen.read','receipts.print','tickets.print','drawer.open','payments.publish','payments.read','cart.publish']
   WHEN 'tablet' THEN ARRAY['orders.publish','orders.read','kitchen.read','tickets.print']
   ELSE ARRAY['orders.read','kitchen.publish','kitchen.read'] END;
  -- Une réactivation ne rétablit pas implicitement les capacités supplémentaires.
  code:=encode(extensions.gen_random_bytes(8),'hex');
  INSERT INTO public.lan_device_credentials(device_id,pairing_hash,pairing_expires_at,permissions,created_by)
   VALUES(device.id,encode(extensions.digest(code,'sha256'),'hex'),now()+interval '10 minutes',caps,actor.id)
  ON CONFLICT(device_id) DO UPDATE SET pairing_hash=EXCLUDED.pairing_hash,pairing_expires_at=EXCLUDED.pairing_expires_at,
   secret_hash=NULL,paired_at=NULL,revoked_at=NULL,permissions=EXCLUDED.permissions,created_by=EXCLUDED.created_by;
  result:=jsonb_build_object('device_id',device.id,'pairing_code',code,'expires_at',now()+interval '10 minutes');
 ELSIF p_action='revoke' THEN
  UPDATE public.lan_device_credentials SET revoked_at=now(),secret_hash=NULL,pairing_hash=NULL WHERE device_id=device.id;
  result:=jsonb_build_object('ok',true);
 ELSIF p_action='permissions' THEN
  IF p_permissions IS NULL OR cardinality(p_permissions)>12 THEN RAISE EXCEPTION 'invalid_permissions' USING ERRCODE='22023'; END IF;
  UPDATE public.lan_device_credentials SET permissions=p_permissions WHERE device_id=device.id AND revoked_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'pairing_required' USING ERRCODE='22023'; END IF;
  result:=jsonb_build_object('ok',true);
 ELSE RAISE EXCEPTION 'invalid_action' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
 VALUES(actor.id,'lan.device.'||p_action,'lan_device',device.id,jsonb_build_object('permissions',CASE WHEN p_action='permissions' THEN p_permissions ELSE NULL END));
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.manage_lan_device_v1(uuid,text,uuid,text[]) FROM PUBLIC,anon,authenticated,kiosk_display;
GRANT EXECUTE ON FUNCTION public.manage_lan_device_v1(uuid,text,uuid,text[]) TO service_role;

CREATE FUNCTION public.authenticate_lan_device_v1(p_secret_hash text,p_pairing_hash text DEFAULT NULL,p_device_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE credential public.lan_device_credentials%ROWTYPE; device public.lan_devices%ROWTYPE;
BEGIN
 IF p_secret_hash IS NULL OR p_secret_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'device_unauthorized' USING ERRCODE='42501'; END IF;
 IF p_pairing_hash IS NOT NULL THEN
  SELECT * INTO credential FROM public.lan_device_credentials WHERE pairing_hash=p_pairing_hash FOR UPDATE;
  IF NOT FOUND OR credential.revoked_at IS NOT NULL OR credential.pairing_expires_at<=now()
   OR (credential.secret_hash IS NOT NULL AND credential.secret_hash<>p_secret_hash) THEN
   RAISE EXCEPTION 'device_unauthorized' USING ERRCODE='42501';
  END IF;
 ELSE
  SELECT * INTO credential FROM public.lan_device_credentials WHERE device_id=p_device_id
   AND secret_hash=p_secret_hash AND paired_at IS NOT NULL AND revoked_at IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'device_unauthorized' USING ERRCODE='42501'; END IF;
 END IF;
 SELECT * INTO device FROM public.lan_devices WHERE id=credential.device_id AND is_active AND deleted_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'device_unauthorized' USING ERRCODE='42501'; END IF;
 IF credential.secret_hash IS NULL THEN
  UPDATE public.lan_device_credentials SET secret_hash=p_secret_hash,paired_at=now() WHERE device_id=device.id;
  INSERT INTO public.audit_logs(actor_id,action,entity_type,entity_id,metadata)
   VALUES(credential.created_by,'lan.device.paired','lan_device',device.id,'{}');
 END IF;
 RETURN jsonb_build_object('id',device.id,'code',device.code,'device_type',device.device_type,'permissions',credential.permissions);
END $$;
REVOKE ALL ON FUNCTION public.authenticate_lan_device_v1(text,text,uuid) FROM PUBLIC,anon,authenticated,kiosk_display;
GRANT EXECUTE ON FUNCTION public.authenticate_lan_device_v1(text,text,uuid) TO service_role;

CREATE FUNCTION public.get_lan_registry_v1() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('version',1,'generated_at',now(),
 'devices',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'code',d.code,'device_type',d.device_type,
  'secret_hash',c.secret_hash,'permissions',c.permissions) ORDER BY d.id),'[]') FROM public.lan_devices d
  JOIN public.lan_device_credentials c ON c.device_id=d.id WHERE d.is_active AND d.deleted_at IS NULL
   AND c.revoked_at IS NULL AND c.secret_hash IS NOT NULL AND c.paired_at IS NOT NULL),
 'printers',(SELECT coalesce(jsonb_agg(jsonb_build_object('ip_address',host(d.ip_address),'port',d.port) ORDER BY d.id),'[]')
  FROM public.lan_devices d WHERE d.device_type='printer' AND d.is_active AND d.deleted_at IS NULL
  AND d.ip_address IS NOT NULL AND d.port BETWEEN 1 AND 65535));
$$;
REVOKE ALL ON FUNCTION public.get_lan_registry_v1() FROM PUBLIC,anon,authenticated,kiosk_display;
GRANT EXECUTE ON FUNCTION public.get_lan_registry_v1() TO service_role;

CREATE FUNCTION public.update_lan_heartbeat_v3(p_device_codes text[]) RETURNS TABLE(code text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_device_codes IS NULL OR cardinality(p_device_codes)>100 THEN RAISE EXCEPTION 'invalid_device_codes' USING ERRCODE='22023'; END IF;
 RETURN QUERY UPDATE public.lan_devices d SET last_heartbeat_at=now()
 WHERE d.code=ANY(p_device_codes) AND d.is_active AND d.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM public.lan_device_credentials c WHERE c.device_id=d.id AND c.revoked_at IS NULL AND c.secret_hash IS NOT NULL)
 RETURNING d.code;
END $$;
REVOKE ALL ON FUNCTION public.update_lan_heartbeat_v3(text[]) FROM PUBLIC,anon,authenticated,kiosk_display;
GRANT EXECUTE ON FUNCTION public.update_lan_heartbeat_v3(text[]) TO service_role;
DROP FUNCTION public.update_lan_heartbeat_v2(text[]);
REVOKE EXECUTE ON FUNCTION public.send_items_to_kitchen(uuid[]) FROM PUBLIC,anon,authenticated,kiosk_display;
GRANT EXECUTE ON FUNCTION public.send_items_to_kitchen(uuid[]) TO service_role;
