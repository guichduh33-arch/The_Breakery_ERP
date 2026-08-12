-- supabase/tests/adr023_vitrine_colonnes.test.sql
-- ADR-023 — le socle de la vitrine de l'écran client.
-- Ce que ce test tient : le DÉFAUT porte la décision (file éteinte, sélection
-- vide), la sélection est une liste ordonnée de chaînes, et sa forme est
-- contrainte en base — c'est la seule garantie qui survivra à l'écran de
-- curation, aux replays et aux écritures SQL directes.
-- Run via MCP execute_sql (BEGIN..ROLLBACK envelope carried by this file).
BEGIN;

CREATE TEMP TABLE _r(name TEXT PRIMARY KEY, pass BOOLEAN) ON COMMIT DROP;

-- T1: les deux colonnes existent, avec le type et le défaut décidés.
INSERT INTO _r
SELECT 't1_colonnes_et_defauts', (
  SELECT count(*) = 2 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'business_config'
     AND ((column_name = 'display_showcase_product_ids'
           AND data_type = 'jsonb' AND is_nullable = 'NO'
           AND column_default LIKE '''[]''%')
       OR (column_name = 'display_show_ready_orders'
           AND data_type = 'boolean' AND is_nullable = 'NO'
           AND column_default = 'false'))
);

-- T2: le DÉFAUT est éteint — sélection vide, annonce coupée (ADR-023 déc. 1 et
-- 3 : un interrupteur neuf allumé laisserait croire la décision appliquée). On
-- l'éprouve en SALISSANT la ligne puis en la ramenant à DEFAULT, jamais en
-- lisant son état courant : la base dev est partagée et mutable, une curation de
-- vitrine y rendait rouge un socle intact. T1 lit la forme TEXTUELLE du défaut
-- au catalogue ; celui-ci en évalue la VALEUR.
DO $$
DECLARE v_ids JSONB; v_annonce BOOLEAN;
BEGIN
  UPDATE business_config
     SET display_showcase_product_ids = '["sale-1","sale-2"]'::jsonb,
         display_show_ready_orders     = true
   WHERE id = 1;

  UPDATE business_config
     SET display_showcase_product_ids = DEFAULT,
         display_show_ready_orders     = DEFAULT
   WHERE id = 1;

  SELECT display_showcase_product_ids, display_show_ready_orders
    INTO v_ids, v_annonce
    FROM business_config WHERE id = 1;

  INSERT INTO _r VALUES ('t2_defaut_eteint',
    v_ids = '[]'::jsonb AND v_annonce = false);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t2_defaut_eteint', false);
END $$;

-- T3: une liste de chaînes est acceptée, et l'ORDRE est conservé tel quel —
-- l'ordre est un choix commercial (déc. 2), pas un détail de stockage.
DO $$
DECLARE v JSONB;
BEGIN
  UPDATE business_config
     SET display_showcase_product_ids = '["b-2","a-1","c-3"]'::jsonb
   WHERE id = 1;
  SELECT display_showcase_product_ids INTO v FROM business_config WHERE id = 1;
  INSERT INTO _r VALUES ('t3_liste_acceptee_ordre_conserve',
    v = '["b-2","a-1","c-3"]'::jsonb);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t3_liste_acceptee_ordre_conserve', false);
END $$;

-- T4: un objet n'est pas une sélection.
DO $$ BEGIN
  UPDATE business_config SET display_showcase_product_ids = '{"id":"a-1"}'::jsonb WHERE id = 1;
  INSERT INTO _r VALUES ('t4_objet_refuse', false);
EXCEPTION WHEN check_violation THEN
  INSERT INTO _r VALUES ('t4_objet_refuse', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t4_objet_refuse', false);
END $$;

-- T5: au-delà de douze, la vitrine déborderait ses quatre pages de trois.
DO $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_agg(i::text) INTO v FROM generate_series(1, 13) AS i;
  UPDATE business_config SET display_showcase_product_ids = v WHERE id = 1;
  INSERT INTO _r VALUES ('t5_plafond_douze', false);
EXCEPTION WHEN check_violation THEN
  INSERT INTO _r VALUES ('t5_plafond_douze', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t5_plafond_douze', false);
END $$;

-- T6: un élément qui n'est pas une chaîne est refusé (un nombre ne se cast pas
-- en uuid côté lecture — il viderait la vitrine entière).
DO $$ BEGIN
  UPDATE business_config SET display_showcase_product_ids = '["a-1", 42]'::jsonb WHERE id = 1;
  INSERT INTO _r VALUES ('t6_element_non_chaine_refuse', false);
EXCEPTION WHEN check_violation THEN
  INSERT INTO _r VALUES ('t6_element_non_chaine_refuse', true);
WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t6_element_non_chaine_refuse', false);
END $$;

-- T7: exactement douze passe — la borne est inclusive.
DO $$
DECLARE v JSONB;
BEGIN
  SELECT jsonb_agg(i::text) INTO v FROM generate_series(1, 12) AS i;
  UPDATE business_config SET display_showcase_product_ids = v WHERE id = 1;
  INSERT INTO _r VALUES ('t7_douze_accepte', true);
EXCEPTION WHEN OTHERS THEN
  INSERT INTO _r VALUES ('t7_douze_accepte', false);
END $$;

SELECT name, pass FROM _r ORDER BY name;

ROLLBACK;
