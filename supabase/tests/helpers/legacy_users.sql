-- Identités déterministes requises par les anciennes suites, dans leur transaction.
-- Ne pas modifier un profil existant ; ROLLBACK retire les fixtures créées ici.
DO $fixture$
DECLARE item record; existing_profile uuid;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid,'SUPER_ADMIN','EMP000'),
    ('00000000-0000-0000-0000-000000000002'::uuid,'CASHIER','EMP001'),
    ('00000000-0000-0000-0000-000000000003'::uuid,'ADMIN','EMP002'),
    ('00000000-0000-0000-0000-000000000004'::uuid,'MANAGER','EMP003')
  ) AS fixtures(auth_id,role_code,employee_code) LOOP
    SELECT id INTO existing_profile FROM public.user_profiles WHERE auth_user_id=item.auth_id;
    IF existing_profile IS NULL THEN
      IF EXISTS(SELECT 1 FROM public.user_profiles WHERE id=item.auth_id OR employee_code=item.employee_code) THEN
        RAISE EXCEPTION 'legacy_fixture_profile_collision';
      END IF;
      INSERT INTO auth.users(id) VALUES(item.auth_id) ON CONFLICT(id) DO NOTHING;
      INSERT INTO public.user_profiles(id,auth_user_id,employee_code,full_name,role_code,is_active,pin_hash)
        VALUES(item.auth_id,item.auth_id,item.employee_code,
          'Legacy pgTAP fixture',item.role_code,true,public.hash_pin('285741'));
    END IF;
  END LOOP;
END;
$fixture$;

\ir legacy_permissions.sql
