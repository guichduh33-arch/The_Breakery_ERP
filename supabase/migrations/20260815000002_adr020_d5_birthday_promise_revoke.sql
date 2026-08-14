-- 20260815000002_adr020_d5_birthday_promise_revoke.sql
-- ADR-020 décision 5 (résiduel du lot b) — un bonus ne se promet jamais sans
-- être crédité.
--
-- 1. Le modèle customer_birthday affirmait « We have credited {{bonus_points}}
--    bonus points » alors qu'aucun mouvement de points n'existe : la promesse
--    sort du modèle, l'envoi reste (mot d'anniversaire sans contrepartie).
--    Le dispatcher substitue les placeholders présents dans le corps : les
--    émetteurs qui continuent de fournir bonus_points (EF
--    customer-birthday-notify) restent inoffensifs, la variable est ignorée.
-- 2. notify_birthday_customers_v2 — SECURITY DEFINER, lit la PII, déclenche
--    des envois — était exécutable par tout authenticated : née après le
--    REVOKE propre de la v1, elle a hérité du GRANT par défaut. Plus personne
--    ne l'appelle (le cron birthday-daily-ef passe par l'EF, qui boucle
--    elle-même) : EXECUTE révoqué, service_role conservé.

UPDATE public.notification_templates
SET body_template =
      'Hi {{customer_name}},' || E'\n\n' ||
      'Happy birthday from The Breakery! We hope your day is filled with sweet moments — stop by and celebrate with us.' || E'\n\n' ||
      'See you soon!' || E'\n' ||
      '— The Breakery Team',
    variables  = '["customer_name"]'::jsonb,
    updated_at = now()
WHERE code = 'customer_birthday';

REVOKE EXECUTE ON FUNCTION public.notify_birthday_customers_v2() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.notify_birthday_customers_v2() FROM anon;
REVOKE EXECUTE ON FUNCTION public.notify_birthday_customers_v2() FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

COMMENT ON FUNCTION public.notify_birthday_customers_v2() IS
  'Session 25 — enqueue des notifications customer_birthday. ADR-020 déc. 5 : EXECUTE réservé à service_role (PII + envois), le chemin vivant est l''EF customer-birthday-notify.';
