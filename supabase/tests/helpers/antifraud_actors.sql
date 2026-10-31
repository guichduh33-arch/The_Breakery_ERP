-- Identités synthétiques propres à la transaction ; le test appelant fait ROLLBACK.
CREATE TEMP TABLE antifraud_test_actors AS
 SELECT gen_random_uuid() id,gen_random_uuid() auth_user_id,role_code
 FROM (VALUES('SUPER_ADMIN'),('ADMIN'),('CASHIER')) r(role_code);
GRANT SELECT ON antifraud_test_actors TO authenticated;
INSERT INTO auth.users(id,email)
 SELECT auth_user_id,auth_user_id||'@antifraud-rehearsal.invalid'
 FROM antifraud_test_actors;
INSERT INTO public.user_profiles
 (id,auth_user_id,employee_code,full_name,pin_hash,role_code,is_active)
 SELECT id,auth_user_id,'ANTIFRAUD-'||id,'Antifraud test fixture',
 'invalid-fixture-hash',role_code,true FROM antifraud_test_actors;
