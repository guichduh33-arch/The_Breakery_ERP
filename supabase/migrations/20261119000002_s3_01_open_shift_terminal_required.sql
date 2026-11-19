-- S3-01 — Le terminal est obligatoire à l'ouverture, et une session est unique
-- par terminal (master plan de finition, arbitrage §2bis lot 2 ; RÈGLE de
-- SPECS_OFFICIELS_ERP_POS.md §6.3).
--
-- Partie ADDITIVE. Le POS ouvrait sa session par un INSERT direct dans
-- pos_sessions, terminal facultatif. On ajoute :
--   1. l'unicité d'une session ouverte par terminal (index partiel unique) ;
--   2. la fonction d'ouverture open_shift_v1, qui exige un terminal de caisse
--      actif et traduit les deux refus en codes lisibles.
-- Le retrait du droit d'INSERT direct vit dans une migration séparée, posée
-- APRÈS l'installation du paquet caisse qui appelle open_shift_v1 : l'ancien
-- paquet ouvre encore par INSERT direct.
--
-- On garde l'exclusion « une session ouverte par utilisateur » : la règle
-- ajoute l'unicité par terminal, elle ne retire rien.
--
-- Les sessions historiques sans terminal (6 en production, toutes clôturées,
-- du 2026-10-31 au 2026-11-02) restent telles quelles : rien ne prouve le
-- poste qui les a ouvertes. Elles sont marquées par le commentaire de la
-- colonne : un terminal NULL désigne une session ouverte avant cette règle.

-- 1. Unicité par terminal. NULL ne collisionne pas : les lignes historiques
--    et les fixtures de test sans terminal restent valides.
DROP INDEX IF EXISTS public.idx_pos_sessions_terminal_open;
CREATE UNIQUE INDEX one_open_session_per_terminal
  ON public.pos_sessions (terminal_id)
  WHERE status = 'open'::shift_status;

COMMENT ON COLUMN public.pos_sessions.terminal_id IS
  'Terminal de caisse (lan_devices, device_type pos). Obligatoire à l''ouverture '
  'depuis S3-01 (open_shift_v1). NULL = session historique ouverte avant cette '
  'règle, terminal inconnu ; aucune session neuve ne peut en porter.';

-- 2. Fonction d'ouverture. Le verrou FOR UPDATE sur le terminal sérialise deux
--    ouvertures simultanées sur le même poste ; l'index unique reste le filet,
--    et sa violation est traduite en code lisible.
CREATE FUNCTION public.open_shift_v1(
  p_terminal_id           uuid,
  p_opening_cash          numeric,
  p_opening_notes         text  DEFAULT NULL,
  p_opening_denominations jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid      uuid := auth.uid();
  v_profile  uuid;
  v_type     text;
  v_active   boolean;
  v_deleted  timestamptz;
  v_row      public.pos_sessions%ROWTYPE;
  v_cname    text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
   WHERE auth_user_id = v_uid AND deleted_at IS NULL AND is_active
   LIMIT 1;
  IF v_profile IS NULL
     OR NOT public.has_permission(v_uid, 'pos.session.open') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF p_terminal_id IS NULL THEN
    RAISE EXCEPTION 'terminal_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_opening_cash IS NULL OR p_opening_cash < 0 THEN
    RAISE EXCEPTION 'invalid_opening_cash' USING ERRCODE = 'P0001';
  END IF;

  SELECT device_type::text, is_active, deleted_at
    INTO v_type, v_active, v_deleted
    FROM lan_devices WHERE id = p_terminal_id
    FOR UPDATE;
  IF NOT FOUND OR v_type <> 'pos' OR NOT v_active OR v_deleted IS NOT NULL THEN
    RAISE EXCEPTION 'terminal_invalid' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (SELECT 1 FROM pos_sessions
              WHERE terminal_id = p_terminal_id AND status = 'open') THEN
    RAISE EXCEPTION 'terminal_session_open' USING ERRCODE = 'P0001';
  END IF;
  IF EXISTS (SELECT 1 FROM pos_sessions
              WHERE opened_by = v_profile AND status = 'open') THEN
    RAISE EXCEPTION 'user_session_open' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    INSERT INTO pos_sessions (opened_by, opening_cash, opening_notes,
                              terminal_id, opening_denominations)
    VALUES (v_profile, p_opening_cash, NULLIF(btrim(p_opening_notes), ''),
            p_terminal_id, p_opening_denominations)
    RETURNING * INTO v_row;
  EXCEPTION
    WHEN unique_violation OR exclusion_violation THEN
      GET STACKED DIAGNOSTICS v_cname = CONSTRAINT_NAME;
      IF v_cname = 'one_open_session_per_terminal' THEN
        RAISE EXCEPTION 'terminal_session_open' USING ERRCODE = 'P0001';
      ELSIF v_cname = 'one_open_session_per_user' THEN
        RAISE EXCEPTION 'user_session_open' USING ERRCODE = 'P0001';
      END IF;
      RAISE;
  END;

  RETURN jsonb_build_object(
    'id',           v_row.id,
    'opened_at',    v_row.opened_at,
    'opening_cash', v_row.opening_cash,
    'terminal_id',  v_row.terminal_id
  );
END;
$function$;

COMMENT ON FUNCTION public.open_shift_v1(uuid, numeric, text, jsonb) IS
  'S3-01 — ouvre une session de caisse sur un terminal de caisse actif. '
  'Refus : terminal_required, terminal_invalid, terminal_session_open, '
  'user_session_open, invalid_opening_cash, forbidden.';

REVOKE ALL ON FUNCTION public.open_shift_v1(uuid, numeric, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.open_shift_v1(uuid, numeric, text, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.open_shift_v1(uuid, numeric, text, jsonb) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
