-- Appairage validé par Mamat : appareil révocable, sans droits d'employé.
CREATE ROLE kiosk_display NOLOGIN NOINHERIT NOBYPASSRLS;
GRANT kiosk_display TO authenticator;
GRANT USAGE ON SCHEMA public TO kiosk_display;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE public.kiosk_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 80),
  pairing_hash text NOT NULL UNIQUE,
  pairing_expires_at timestamptz NOT NULL,
  secret_hash text,
  paired_at timestamptz,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES public.user_profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (pairing_hash ~ '^[0-9a-f]{64}$'),
  CHECK (secret_hash IS NULL OR secret_hash ~ '^[0-9a-f]{64}$')
);
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.kiosk_devices FROM PUBLIC, anon, authenticated, kiosk_display;
GRANT ALL ON public.kiosk_devices TO service_role;

-- Appel exclusivement serveur, après validation de la session opaque dans l'EF.
CREATE FUNCTION public.manage_display_device_v1(
  p_actor_id uuid, p_action text, p_device_id uuid DEFAULT NULL, p_label text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor public.user_profiles%ROWTYPE;
  v_device public.kiosk_devices%ROWTYPE;
  v_code text;
  v_result jsonb;
BEGIN
  SELECT * INTO v_actor FROM public.user_profiles
  WHERE id = p_actor_id AND is_active AND deleted_at IS NULL;
  IF NOT FOUND OR NOT public.has_permission(v_actor.auth_user_id, 'kiosk.issue') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;
  IF p_action = 'list' THEN
    SELECT coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'label', label, 'paired_at', paired_at,
      'revoked_at', revoked_at, 'pairing_expires_at', pairing_expires_at
    ) ORDER BY created_at DESC), '[]'::jsonb) INTO v_result FROM public.kiosk_devices;
    RETURN v_result;
  ELSIF p_action = 'create' THEN
    IF p_label IS NULL OR length(trim(p_label)) NOT BETWEEN 1 AND 80 THEN
      RAISE EXCEPTION 'invalid_label' USING ERRCODE = '22023';
    END IF;
    v_code := encode(extensions.gen_random_bytes(8), 'hex');
    INSERT INTO public.kiosk_devices(label, pairing_hash, pairing_expires_at, created_by)
    VALUES (trim(p_label), encode(extensions.digest(v_code, 'sha256'), 'hex'), now() + interval '10 minutes', p_actor_id)
    RETURNING * INTO v_device;
    INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_actor_id, 'kiosk.pairing.created', 'kiosk_device', v_device.id,
      jsonb_build_object('label', v_device.label));
    RETURN jsonb_build_object('id', v_device.id, 'pairing_code', v_code,
      'expires_at', v_device.pairing_expires_at);
  ELSIF p_action = 'revoke' THEN
    UPDATE public.kiosk_devices SET revoked_at = now(), secret_hash = NULL
      WHERE id = p_device_id AND revoked_at IS NULL RETURNING * INTO v_device;
    IF FOUND THEN
      INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
      VALUES (p_actor_id, 'kiosk.revoked', 'kiosk_device', v_device.id, '{}'::jsonb);
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;
  RAISE EXCEPTION 'invalid_action' USING ERRCODE = '22023';
END;
$$;
REVOKE ALL ON FUNCTION public.manage_display_device_v1(uuid, text, uuid, text) FROM PUBLIC, anon, authenticated, kiosk_display;
GRANT EXECUTE ON FUNCTION public.manage_display_device_v1(uuid, text, uuid, text) TO service_role;

-- Les secrets bruts restent dans les headers EF ; seuls leurs SHA-256 arrivent ici.
CREATE FUNCTION public.authenticate_display_device_v1(
  p_secret_hash text, p_pairing_hash text DEFAULT NULL, p_device_id uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_device public.kiosk_devices%ROWTYPE;
BEGIN
  IF p_secret_hash IS NULL OR p_secret_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'kiosk_unauthorized' USING ERRCODE = '42501';
  END IF;
  IF p_pairing_hash IS NOT NULL THEN
    SELECT * INTO v_device FROM public.kiosk_devices WHERE pairing_hash = p_pairing_hash FOR UPDATE;
    IF NOT FOUND OR v_device.revoked_at IS NOT NULL OR v_device.pairing_expires_at <= now()
      OR (v_device.secret_hash IS NOT NULL AND v_device.secret_hash <> p_secret_hash) THEN
      RAISE EXCEPTION 'kiosk_unauthorized' USING ERRCODE = '42501';
    END IF;
    -- Même code et même secret : retry autorisé après perte de la réponse HTTP.
    IF v_device.secret_hash IS NULL THEN
      UPDATE public.kiosk_devices SET secret_hash = p_secret_hash, paired_at = now() WHERE id = v_device.id;
      INSERT INTO public.audit_logs(actor_id, action, entity_type, entity_id, metadata)
      VALUES (v_device.created_by, 'kiosk.paired', 'kiosk_device', v_device.id, '{}'::jsonb);
    END IF;
  ELSE
    SELECT * INTO v_device FROM public.kiosk_devices WHERE id = p_device_id
      AND secret_hash = p_secret_hash AND revoked_at IS NULL AND paired_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'kiosk_unauthorized' USING ERRCODE = '42501'; END IF;
  END IF;
  RETURN jsonb_build_object('id', v_device.id, 'label', v_device.label);
END;
$$;
REVOKE ALL ON FUNCTION public.authenticate_display_device_v1(text, text, uuid) FROM PUBLIC, anon, authenticated, kiosk_display;
GRANT EXECUTE ON FUNCTION public.authenticate_display_device_v1(text, text, uuid) TO service_role;

-- Seul accès applicatif du rôle écran. Révocation vérifiée à CHAQUE lecture,
-- même lorsque le JWT n'a pas encore expiré. Aucun client, paiement ou coût.
CREATE FUNCTION public.get_kiosk_display_v1() RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_config public.business_config%ROWTYPE;
  v_products jsonb := '[]'::jsonb;
  v_orders jsonb := '[]'::jsonb;
  v_ready jsonb := '[]'::jsonb;
BEGIN
  IF v_claims->>'role' IS DISTINCT FROM 'kiosk_display'
    OR v_claims->'app_metadata'->>'provider' IS DISTINCT FROM 'kiosk'
    OR v_claims->'app_metadata'->>'scope' IS DISTINCT FROM 'display'
    OR NOT EXISTS (SELECT 1 FROM public.kiosk_devices WHERE id = auth.uid()
      AND revoked_at IS NULL AND paired_at IS NOT NULL) THEN
    RAISE EXCEPTION 'kiosk_unauthorized' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_config FROM public.business_config LIMIT 1;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name,
    'image_url', p.image_url, 'retail_price', p.retail_price) ORDER BY s.ordinality), '[]'::jsonb)
    INTO v_products
  FROM jsonb_array_elements_text(coalesce(v_config.display_showcase_product_ids, '[]'::jsonb))
    WITH ORDINALITY AS s(id, ordinality)
  JOIN public.products p ON p.id::text = s.id
  WHERE p.is_active AND p.visible_on_pos AND p.deleted_at IS NULL AND s.ordinality <= 12;
  IF coalesce(v_config.display_show_ready_orders, false) THEN
    SELECT coalesce(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO v_orders FROM (
      SELECT id, order_number, status, order_type, table_number, paid_at
      FROM public.orders WHERE status IN ('paid', 'completed')
        AND paid_at >= now() - interval '15 minutes'
      ORDER BY paid_at DESC, id LIMIT 5
    ) o;
    SELECT coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_ready FROM (
      SELECT o.id AS order_id, o.order_number, o.order_type, o.table_number, min(i.ready_at) AS ready_at
      FROM public.order_items i JOIN public.orders o ON o.id = i.order_id
      WHERE i.kitchen_status = 'ready' AND NOT i.is_cancelled AND o.voided_at IS NULL
      GROUP BY o.id, o.order_number, o.order_type, o.table_number
      ORDER BY min(i.ready_at) ASC NULLS LAST, o.id LIMIT 5
    ) r;
  END IF;
  RETURN jsonb_build_object('footer', coalesce(v_config.display_footer_message, ''),
    'slogan', coalesce(v_config.display_slogan, ''),
    'show_ready_orders', coalesce(v_config.display_show_ready_orders, false),
    'products', v_products, 'orders', v_orders, 'ready_orders', v_ready);
END;
$$;
REVOKE ALL ON FUNCTION public.get_kiosk_display_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_kiosk_display_v1() TO kiosk_display;
