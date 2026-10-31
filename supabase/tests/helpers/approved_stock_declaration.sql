-- Fixture de cycle complet : déclarant et Owner distincts, aucune écriture hors rollback.
\ir pin_session.sql
CREATE OR REPLACE FUNCTION pg_temp.approved_stock_declaration(
 p_operation text,p_product_id uuid,p_quantity numeric,p_reason text,p_key uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=public,pg_temp AS $$
DECLARE
 v_original_sub text:=current_setting('request.jwt.claim.sub',true);
 v_original_claims text:=current_setting('request.jwt.claims',true);
 v_actor uuid:=auth.uid(); v_owner uuid; v_declarant uuid;
 v_permission text; v_declaration jsonb; v_result jsonb;
 v_override user_permission_overrides%ROWTYPE; v_had_override boolean;
BEGIN
 v_permission:=CASE WHEN p_operation='adjust' THEN 'inventory.adjust'
   WHEN p_operation='waste' THEN 'inventory.waste' ELSE 'display.manage' END;
 -- La fixture ne donne aucun droit à l'appelant qu'elle est chargée de tester.
 IF v_actor IS NULL OR NOT has_permission(v_actor,v_permission) THEN
   RETURN submit_stock_declaration_v2(p_operation,p_product_id,p_quantity,p_reason,COALESCE(p_key,gen_random_uuid()));
 END IF;
 SELECT auth_user_id INTO STRICT v_owner FROM user_profiles WHERE role_code='SUPER_ADMIN'
   AND is_active AND deleted_at IS NULL AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
 v_declarant:=v_actor;
 IF is_business_owner_v1() THEN
   SELECT auth_user_id INTO STRICT v_declarant FROM user_profiles
     WHERE role_code<>'SUPER_ADMIN' AND is_active AND deleted_at IS NULL
     AND auth_user_id IS NOT NULL ORDER BY id LIMIT 1;
   SELECT o.* INTO v_override FROM user_permission_overrides o JOIN user_profiles u
     ON u.id=o.user_profile_id WHERE u.auth_user_id=v_declarant AND o.permission_code=v_permission;
   v_had_override:=FOUND;
   INSERT INTO user_permission_overrides(user_profile_id,permission_code,is_granted,reason)
   SELECT id,v_permission,true,'Transactional declaration fixture' FROM user_profiles WHERE auth_user_id=v_declarant
   ON CONFLICT(user_profile_id,permission_code) DO UPDATE SET is_granted=true,expires_at=NULL;
 END IF;
 PERFORM pg_temp.authenticate_pin(v_declarant);
 v_declaration:=submit_stock_declaration_v2(p_operation,p_product_id,p_quantity,p_reason,COALESCE(p_key,gen_random_uuid()));
 IF v_declarant<>v_actor THEN
   IF v_had_override THEN
     UPDATE user_permission_overrides SET is_granted=v_override.is_granted,
       expires_at=v_override.expires_at,reason=v_override.reason
       WHERE user_profile_id=v_override.user_profile_id AND permission_code=v_override.permission_code;
   ELSE
     DELETE FROM user_permission_overrides WHERE permission_code=v_permission
       AND user_profile_id=(SELECT id FROM user_profiles WHERE auth_user_id=v_declarant);
   END IF;
 END IF;
 PERFORM pg_temp.authenticate_pin(v_owner);
 v_result:=approve_stock_declaration_v3((v_declaration->>'declaration_id')::uuid);
 PERFORM set_config('request.jwt.claim.sub',COALESCE(v_original_sub,''),true);
 PERFORM set_config('request.jwt.claims',COALESCE(v_original_claims,''),true);
 RETURN v_result;
EXCEPTION WHEN OTHERS THEN
 PERFORM set_config('request.jwt.claim.sub',COALESCE(v_original_sub,''),true);
 PERFORM set_config('request.jwt.claims',COALESCE(v_original_claims,''),true);
 RAISE;
END $$;
REVOKE ALL ON FUNCTION pg_temp.approved_stock_declaration(text,uuid,numeric,text,uuid) FROM PUBLIC,anon,authenticated;
CREATE OR REPLACE FUNCTION pg_temp.approved_adjustment(uuid,numeric,text,uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.approved_stock_declaration('adjust',$1,$2,$3,$4) $$;
CREATE OR REPLACE FUNCTION pg_temp.approved_waste(uuid,numeric,text,uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.approved_stock_declaration('waste',$1,$2,$3,$4) $$;
CREATE OR REPLACE FUNCTION pg_temp.immediate_display_adjustment(uuid,numeric,text,uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT public.adjust_display_stock_v5($1,$2,$3,COALESCE($4,gen_random_uuid())) $$;
CREATE OR REPLACE FUNCTION pg_temp.approved_display_waste(uuid,numeric,text,uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql AS $$ SELECT pg_temp.approved_stock_declaration('display_waste',$1,$2,$3,$4) $$;
REVOKE ALL ON FUNCTION pg_temp.approved_adjustment(uuid,numeric,text,uuid),pg_temp.approved_waste(uuid,numeric,text,uuid),
 pg_temp.immediate_display_adjustment(uuid,numeric,text,uuid),pg_temp.approved_display_waste(uuid,numeric,text,uuid)
 FROM PUBLIC,anon,authenticated;
