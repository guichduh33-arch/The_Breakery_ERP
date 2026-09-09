-- 20260909000002_set_expense_threshold_v3_approver_validation.sql
-- Audit expense-governance 2026-08-31, finding n°5 (P1) — une chaîne d'approbation pouvait
-- être configurée avec un rôle qui ne peut PAS approuver, et les dépenses de la tranche
-- gelaient sans issue.
--
-- La v2 ne validait que la FORME des steps (tableau non vide + libellé). Un palier
-- `role_codes:['CASHIER']` était donc accepté, alors que `approve_expense` exige d'abord
-- `has_permission('expenses.approve')` — que CASHIER ne détient pas — puis teste
-- l'appartenance à `role_codes`. Résultat : personne ne peut satisfaire l'étape, toutes les
-- dépenses de la tranche restent en `submitted`, et la seule sortie est le rejet — or une
-- dépense rejetée ne se re-soumet pas, il faut la recréer.
--
-- La v3 refuse à la SOURCE : tout rôle cité doit exister, et chaque étape doit compter au
-- moins un rôle porteur de `expenses.approve`. La liste proposée par l'écran est corrigée
-- dans le même lot, mais l'écran n'est pas une protection — le serveur l'est.
--
-- Corps repris de `pg_get_functiondef('set_expense_threshold_v2')` live au 2026-09-09 ;
-- seul le bloc de validation 4b est neuf.

CREATE OR REPLACE FUNCTION public.set_expense_threshold_v3(
  p_threshold_id uuid DEFAULT NULL,
  p_category_id uuid DEFAULT NULL,
  p_amount_min numeric DEFAULT 0,
  p_amount_max numeric DEFAULT NULL,
  p_steps jsonb DEFAULT '[]'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_caller_uid     UUID := auth.uid();
  v_caller_profile UUID;
  v_result_id      UUID;
  v_overlap        INT;
  v_step           JSONB;
  v_unknown        TEXT;
  v_approvers      INT;
BEGIN
  -- 1. Auth check
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v3: caller not authenticated'
      USING ERRCODE = '28000';
  END IF;

  -- 2. Permission gate
  IF NOT has_permission(v_caller_uid, 'expenses.thresholds.write') THEN
    RAISE EXCEPTION 'set_expense_threshold_v3: missing permission expenses.thresholds.write'
      USING ERRCODE = '42501';
  END IF;

  -- 2b. Résolution du profil acteur — audit_logs.actor_id référence user_profiles(id).
  SELECT id INTO v_caller_profile FROM user_profiles
    WHERE auth_user_id = v_caller_uid AND deleted_at IS NULL LIMIT 1;
  IF v_caller_profile IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v3: no user_profile for caller' USING ERRCODE = '28000';
  END IF;

  -- 3. Validate p_steps is a JSONB array
  IF jsonb_typeof(p_steps) != 'array' THEN
    RAISE EXCEPTION 'set_expense_threshold_v3: p_steps must be a JSONB array'
      USING ERRCODE = '22023';
  END IF;

  -- 4. Validate each step shape: { role_codes: TEXT[] non-empty, label: TEXT non-empty }
  FOR v_step IN SELECT jsonb_array_elements(p_steps) LOOP
    IF jsonb_typeof(v_step -> 'role_codes') != 'array'
       OR jsonb_array_length(v_step -> 'role_codes') = 0
       OR jsonb_typeof(v_step -> 'label') != 'string'
       OR length(v_step ->> 'label') = 0
    THEN
      RAISE EXCEPTION 'set_expense_threshold_v3: invalid step shape — each step needs non-empty role_codes array + non-empty label'
        USING ERRCODE = '22023';
    END IF;

    -- 4b (2026-09-09, audit finding n°5) : le rôle doit EXISTER, et l'étape doit être
    -- satisfiable par au moins un rôle porteur de `expenses.approve`. Sinon la tranche
    -- gèle sans issue.
    SELECT rc INTO v_unknown
      FROM jsonb_array_elements_text(v_step -> 'role_codes') AS rc
     WHERE NOT EXISTS (SELECT 1 FROM roles r WHERE r.code = rc)
     LIMIT 1;
    IF v_unknown IS NOT NULL THEN
      RAISE EXCEPTION 'set_expense_threshold_v3: unknown role_code % in step "%"',
        v_unknown, v_step ->> 'label'
        USING ERRCODE = '22023';
    END IF;

    SELECT count(*) INTO v_approvers
      FROM jsonb_array_elements_text(v_step -> 'role_codes') AS rc
      JOIN role_permissions rp
        ON rp.role_code = rc
       AND rp.permission_code = 'expenses.approve'
       AND rp.is_granted;
    IF v_approvers = 0 THEN
      RAISE EXCEPTION 'set_expense_threshold_v3: step "%" has no role holding expenses.approve — nobody could ever approve it',
        v_step ->> 'label'
        USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 5. Validate p_amount_max not NULL
  IF p_amount_max IS NULL THEN
    RAISE EXCEPTION 'set_expense_threshold_v3: p_amount_max must not be NULL'
      USING ERRCODE = '22023';
  END IF;

  -- 6. Validate range: p_amount_max > p_amount_min
  IF p_amount_max <= p_amount_min THEN
    RAISE EXCEPTION 'set_expense_threshold_v3: p_amount_max must be > p_amount_min'
      USING ERRCODE = '22023';
  END IF;

  -- 7. Overlap check
  SELECT COUNT(*) INTO v_overlap
  FROM expense_approval_thresholds
  WHERE id IS DISTINCT FROM p_threshold_id
    AND category_id IS NOT DISTINCT FROM p_category_id
    AND p_amount_min < amount_max
    AND p_amount_max > amount_min;

  IF v_overlap > 0 THEN
    RAISE EXCEPTION 'set_expense_threshold_v3: threshold_overlap — another row covers part of [%, %) for this category',
      p_amount_min, p_amount_max
      USING ERRCODE = 'P0002';
  END IF;

  -- 8. INSERT or UPDATE
  IF p_threshold_id IS NULL THEN
    INSERT INTO expense_approval_thresholds (category_id, amount_min, amount_max, steps)
    VALUES (p_category_id, p_amount_min, p_amount_max, p_steps)
    RETURNING id INTO v_result_id;
  ELSE
    UPDATE expense_approval_thresholds
    SET category_id = p_category_id,
        amount_min  = p_amount_min,
        amount_max  = p_amount_max,
        steps       = p_steps
    WHERE id = p_threshold_id
    RETURNING id INTO v_result_id;

    IF v_result_id IS NULL THEN
      RAISE EXCEPTION 'set_expense_threshold_v3: threshold % not found', p_threshold_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 9. Audit log
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_profile,
    CASE WHEN p_threshold_id IS NULL
         THEN 'expense_threshold.created'
         ELSE 'expense_threshold.updated'
    END,
    'expense_approval_thresholds',
    v_result_id,
    jsonb_build_object(
      'category_id', p_category_id,
      'amount_min',  p_amount_min,
      'amount_max',  p_amount_max,
      'steps',       p_steps
    )
  );

  -- 10. Return the threshold UUID
  RETURN v_result_id;
END $function$;

-- Paire REVOKE canonique sur la NOUVELLE signature
REVOKE ALL ON FUNCTION public.set_expense_threshold_v3(uuid, uuid, numeric, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_expense_threshold_v3(uuid, uuid, numeric, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.set_expense_threshold_v3(uuid, uuid, numeric, numeric, jsonb) TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.set_expense_threshold_v3(uuid, uuid, numeric, numeric, jsonb) IS
  'Crée ou met à jour un palier d''approbation de dépense. Depuis la v3, une étape dont aucun '
  'role_code ne détient expenses.approve est REFUSÉE (22023) : elle produirait une tranche '
  'que personne ne peut approuver et que le rejet seul peut vider (audit expense-governance '
  'finding 5). Un role_code inexistant est refusé de même.';

DROP FUNCTION IF EXISTS public.set_expense_threshold_v2(uuid, uuid, numeric, numeric, jsonb);
