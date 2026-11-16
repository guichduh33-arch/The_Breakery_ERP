-- Recette BO ciblée : seul le PIN du compte E2E propriétaire est préparé.
-- Aucun compte caisse, shift, fond d'ouverture ou transfert n'est modifié.
UPDATE public.user_profiles
   SET pin_hash = public.hash_pin(:'adminpin'),
       failed_login_attempts = 0,
       locked_until = NULL
 WHERE id = '0e2e0000-0000-4000-a000-000000000001';
