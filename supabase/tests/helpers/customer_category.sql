-- Catégorie explicite pour les clients des fixtures ; aucun défaut métier modifié.
SELECT set_config('fixture.customer_category',gen_random_uuid()::text,true);
INSERT INTO customer_categories(id,name,slug,price_modifier_type,loyalty_enabled,is_active)
VALUES(current_setting('fixture.customer_category')::uuid,'pgTAP customer category',
  'pgtap-'||current_setting('fixture.customer_category'),'retail',true,true);
