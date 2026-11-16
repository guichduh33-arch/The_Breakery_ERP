-- Correctif de précision des consommations de production, 8 novembre 2026.
-- Source live production V3 capturée avant édition ; ce fichier appartient au
-- paquet atomique 20261108000020.. : ne pas appliquer ses parties séparément.


SET LOCAL transaction_timeout = '20s';
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
DO $source_guard$
DECLARE v_source record; v_oid oid;
BEGIN
  FOR v_source IN SELECT * FROM (VALUES
    ('public.record_stock_movement_v1(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean)', ARRAY['9f53e4c10e4ceaa7d03adfbaaed2d253']::text[], false),
    ('public.record_production_v11(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)', ARRAY['4727ad6df3e365fc0495c91ef57bc867']::text[], false),
    ('public.record_batch_production_v13(jsonb, jsonb)', ARRAY['359b9e85ba7935fa7d8c0afc5855e1e8']::text[], false),
    ('public.record_kitchen_production_v6(jsonb)', ARRAY['117bc785ecec71cca55eb621da4e99d7']::text[], false),
    ('public.record_incoming_stock_v5(uuid, numeric, uuid, numeric, text, uuid)', ARRAY['59e5d5f6a1fbf63385ba5937f26d1f56','c3e37c0311292eabf3bbf4cd260db4b5']::text[], false),
    ('public.finalize_opname_v5(uuid, uuid)', ARRAY['083ac41741cfc0b77c248fabd9409e7d','b2f7672ed95f203785c8c839881642d8']::text[], false),
    ('public.add_opname_item_v3(uuid, uuid, text)', ARRAY['05d76e8796ea7bfeb54dec7a9cbfad5b','f975b1d371ed80af0981f24783043f85']::text[], false),
    ('public.receive_purchase_order_v5(uuid, jsonb, uuid)', ARRAY['18c4c44b32741fcd1a45df510f4f1832']::text[], false),
    ('public.revert_production_v3(uuid, text)', ARRAY['02b851594241d16a81f100c9c7e7fbae']::text[], false),
    ('public.approve_stock_declaration_v3(uuid)', ARRAY['649448c7065518ffcd1a4a694622a4fa','11d6b522a91aaae64a98e10079ec65c4']::text[], false),
    ('public.apply_historical_import_v4(jsonb, text, uuid)', ARRAY['9cf67467ae4f335306073ebce99b464e','22121689baaa005568368e1e057a54ba']::text[], false),
    ('public.mark_expired_lots_hourly()', ARRAY['c663283613ca8f7de0c3d3b4044236dc']::text[], false),
    ('stock_private.record_production_v9(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)', ARRAY['33e5282ef03b5c92c9c816185bb85f80']::text[], false),
    ('stock_private.record_production_v7(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)', ARRAY['083e062028ed5fc944160699a5f8fc42']::text[], true),
    ('stock_private.record_batch_production_v12(jsonb, jsonb)', ARRAY['f2376e51eb50ec011c057747de985ffb']::text[], false),
    ('stock_private.record_kitchen_production_v5(jsonb)', ARRAY['eeb4a1cd43d40d1e58904168e45835e0']::text[], false),
    ('stock_private.record_incoming_stock_v1(uuid, numeric, uuid, numeric, text, uuid)', ARRAY['7a4f10e0e5a2e2733462d97ce541297f']::text[], false),
    ('stock_private.record_incoming_stock_v2(uuid, numeric, uuid, numeric, text, uuid)', ARRAY['e56b195c2db15bdd3f4bb392a9af0373','335bf4f29865cb4f70428b39ab1cd7a5']::text[], false),
    ('stock_private.adjust_stock_v1(uuid, numeric, text, uuid)', ARRAY['8d8c4e687c06ee96c565e53691449a8f']::text[], false),
    ('stock_private.waste_stock_v1(uuid, numeric, text, uuid)', ARRAY['2f8368a619cc76c48ccba4c694a3b556']::text[], false),
    ('stock_private.mutate(text, uuid, numeric, text, uuid, numeric, uuid)', ARRAY['c419071312601833249f790c5552512f']::text[], false)
  ) AS s(signature, hashes, optional) LOOP
    v_oid := to_regprocedure(v_source.signature);
    IF v_oid IS NULL AND v_source.optional THEN CONTINUE; END IF;
    IF v_oid IS NULL OR NOT md5(pg_get_functiondef(v_oid)) = ANY(v_source.hashes) THEN
      RAISE EXCEPTION 'production_precision_source_drift: %', v_source.signature;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE prosrc ~ '\mrecord_production_v7[[:space:]]*\(')
     OR EXISTS (SELECT 1 FROM pg_depend WHERE refclassid='pg_proc'::regclass
       AND refobjid=to_regprocedure('stock_private.record_production_v7(uuid,numeric,uuid,text,numeric,text,uuid,boolean,numeric,numeric,text,boolean,waste_reason)')) THEN
    RAISE EXCEPTION 'production_precision_legacy_dependency';
  END IF;
  FOR v_source IN SELECT * FROM (VALUES
    ('public.record_stock_movement_v2(uuid, movement_type, numeric, text, numeric, uuid, uuid, text, uuid, uuid, jsonb, uuid, boolean)'),
    ('stock_private.record_production_v10(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)'),
    ('public.record_production_v12(uuid, numeric, uuid, text, numeric, text, uuid, boolean, numeric, numeric, text, boolean, waste_reason)'),
    ('stock_private.record_batch_production_v13(jsonb, jsonb)'),
    ('public.record_batch_production_v14(jsonb, jsonb)'),
    ('stock_private.record_kitchen_production_v6(jsonb)'),
    ('public.record_kitchen_production_v7(jsonb)'),
    ('stock_private.adjust_stock_v2(uuid, numeric, text, uuid)'),
    ('stock_private.waste_stock_v2(uuid, numeric, text, uuid)'),
    ('stock_private.record_incoming_stock_v3(uuid, numeric, uuid, numeric, text, uuid)'),
    ('stock_private.record_incoming_stock_v4(uuid, numeric, uuid, numeric, text, uuid)'),
    ('public.record_incoming_stock_v6(uuid, numeric, uuid, numeric, text, uuid)'),
    ('public.finalize_opname_v6(uuid, uuid)'),
    ('public.add_opname_item_v4(uuid, uuid, text)'),
    ('public.receive_purchase_order_v6(uuid, jsonb, uuid)'),
    ('public.revert_production_v4(uuid, text)'),
    ('public.approve_stock_declaration_v4(uuid)'),
    ('public.apply_historical_import_v5(jsonb, text, uuid)')
  ) AS signatures(signature) LOOP
    IF to_regprocedure(v_source.signature) IS NOT NULL THEN
      RAISE EXCEPTION 'production_precision_target_exists: %', v_source.signature;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM information_schema.columns
    WHERE table_schema='public' AND numeric_precision=10 AND numeric_scale=3
      AND ((table_name='products' AND column_name='current_stock')
        OR (table_name IN ('stock_movements','stock_lots') AND column_name='quantity')
        OR (table_name='stock_declarations' AND column_name='baseline_quantity')
        OR (table_name='inventory_count_items' AND column_name IN ('expected_qty','variance')))) <> 6
  THEN RAISE EXCEPTION 'production_precision_column_drift'; END IF;
END $source_guard$;

-- Les verrous sont pris sans attente ; toute contention annule le lot entier.
LOCK TABLE public.inventory_count_items, public.products, public.stock_declarations,
  public.stock_lots, public.stock_movements IN ACCESS EXCLUSIVE MODE NOWAIT;
SELECT set_config('breakery.production_precision_batch', 'started', true);
CREATE TEMP TABLE _production_precision_completion (id boolean PRIMARY KEY) ON COMMIT DROP;
CREATE FUNCTION pg_temp.require_production_precision_completion() RETURNS trigger
LANGUAGE plpgsql SET search_path TO pg_catalog, pg_temp AS $completion$
BEGIN
  IF current_setting('breakery.production_precision_batch', true) IS DISTINCT FROM 'complete' THEN
    RAISE EXCEPTION 'production_precision_atomic_batch_incomplete';
  END IF;
  RETURN NEW;
END $completion$;
CREATE CONSTRAINT TRIGGER require_production_precision_completion
AFTER INSERT ON _production_precision_completion DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION pg_temp.require_production_precision_completion();
INSERT INTO _production_precision_completion VALUES (true);

CREATE TEMP TABLE _production_precision_before ON COMMIT DROP AS
  SELECT 'products'::text AS relation, id, current_stock AS quantity, NULL::numeric AS variance FROM products
  UNION ALL SELECT 'stock_movements', id, quantity, NULL::numeric FROM stock_movements
  UNION ALL SELECT 'stock_lots', id, quantity, NULL::numeric FROM stock_lots
  UNION ALL SELECT 'stock_declarations', id, baseline_quantity, NULL::numeric FROM stock_declarations
  UNION ALL SELECT 'inventory_count_items', id, expected_qty, variance FROM inventory_count_items;

DROP MATERIALIZED VIEW public.mv_stock_variance;
DROP VIEW public.v_product_available_stock;
DROP VIEW public.view_product_recipes;
DROP VIEW public.view_recipe_products;
DROP TRIGGER trg_notify_low_stock ON public.products;
ALTER TABLE public.products ALTER COLUMN current_stock TYPE NUMERIC(16,9);
ALTER TABLE public.stock_movements ALTER COLUMN quantity TYPE NUMERIC(16,9);
ALTER TABLE public.stock_lots ALTER COLUMN quantity TYPE NUMERIC(16,9);
ALTER TABLE public.stock_declarations ALTER COLUMN baseline_quantity TYPE NUMERIC(16,9);
ALTER TABLE public.inventory_count_items DROP COLUMN variance;
ALTER TABLE public.inventory_count_items ALTER COLUMN expected_qty TYPE NUMERIC(16,9);
ALTER TABLE public.inventory_count_items ADD COLUMN variance NUMERIC(16,9)
  GENERATED ALWAYS AS (counted_qty - expected_qty) STORED;
COMMENT ON COLUMN public.inventory_count_items.expected_qty IS
  'Snapshot du stock global products.current_stock lors de l ajout au comptage ; référence conservée pendant le relevé.';
COMMENT ON COLUMN public.inventory_count_items.counted_qty IS
  'Quantité comptée, nulle avant saisie ; granularité de saisie inchangée à trois décimales. La famille set_opname_count renseigne la valeur avant finalisation.';
CREATE TRIGGER trg_notify_low_stock AFTER UPDATE OF current_stock ON public.products FOR EACH ROW WHEN (((new.current_stock < new.min_stock_threshold) AND (old.current_stock >= old.min_stock_threshold))) EXECUTE FUNCTION _trg_notify_low_stock();
CREATE MATERIALIZED VIEW public.mv_stock_variance AS
SELECT p.id AS product_id,
    p.name AS product_name,
    p.sku,
    COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['purchase'::movement_type, 'incoming'::movement_type, 'production_in'::movement_type]) THEN sm.quantity
            ELSE 0::numeric
        END), 0::numeric)::numeric(12,3) AS opened,
    COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['sale'::movement_type, 'sale_void'::movement_type]) THEN sm.quantity
            ELSE 0::numeric
        END), 0::numeric)::numeric(12,3) AS sold,
    COALESCE(sum(
        CASE
            WHEN sm.movement_type = ANY (ARRAY['adjustment'::movement_type, 'adjustment_in'::movement_type, 'adjustment_out'::movement_type, 'waste'::movement_type, 'opname_in'::movement_type, 'opname_out'::movement_type, 'production_out'::movement_type, 'purchase_return'::movement_type]) THEN sm.quantity
            ELSE 0::numeric
        END), 0::numeric)::numeric(12,3) AS adjusted,
    p.current_stock AS current_qty,
    COALESCE(sum(sm.quantity), 0::numeric)::numeric(12,3) AS expected,
    (p.current_stock - COALESCE(sum(sm.quantity), 0::numeric))::numeric(12,3) AS variance
   FROM products p
     LEFT JOIN stock_movements sm ON sm.product_id = p.id
  WHERE p.deleted_at IS NULL
  GROUP BY p.id, p.name, p.sku, p.current_stock
WITH DATA;
ALTER MATERIALIZED VIEW public.mv_stock_variance OWNER TO postgres;
REVOKE ALL ON TABLE public.mv_stock_variance FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON TABLE public.mv_stock_variance TO postgres;
GRANT SELECT ON TABLE public.mv_stock_variance TO postgres;
GRANT UPDATE ON TABLE public.mv_stock_variance TO postgres;
GRANT DELETE ON TABLE public.mv_stock_variance TO postgres;
GRANT TRUNCATE ON TABLE public.mv_stock_variance TO postgres;
GRANT REFERENCES ON TABLE public.mv_stock_variance TO postgres;
GRANT TRIGGER ON TABLE public.mv_stock_variance TO postgres;
GRANT MAINTAIN ON TABLE public.mv_stock_variance TO postgres;
GRANT INSERT ON TABLE public.mv_stock_variance TO authenticated;
GRANT UPDATE ON TABLE public.mv_stock_variance TO authenticated;
GRANT DELETE ON TABLE public.mv_stock_variance TO authenticated;
GRANT TRUNCATE ON TABLE public.mv_stock_variance TO authenticated;
GRANT REFERENCES ON TABLE public.mv_stock_variance TO authenticated;
GRANT TRIGGER ON TABLE public.mv_stock_variance TO authenticated;
GRANT MAINTAIN ON TABLE public.mv_stock_variance TO authenticated;
GRANT INSERT ON TABLE public.mv_stock_variance TO service_role;
GRANT SELECT ON TABLE public.mv_stock_variance TO service_role;
GRANT UPDATE ON TABLE public.mv_stock_variance TO service_role;
GRANT DELETE ON TABLE public.mv_stock_variance TO service_role;
GRANT TRUNCATE ON TABLE public.mv_stock_variance TO service_role;
GRANT REFERENCES ON TABLE public.mv_stock_variance TO service_role;
GRANT TRIGGER ON TABLE public.mv_stock_variance TO service_role;
GRANT MAINTAIN ON TABLE public.mv_stock_variance TO service_role;
COMMENT ON MATERIALIZED VIEW public.mv_stock_variance IS 'Stock variance MV. S50 W1.5 : REVOKE SELECT FROM authenticated. Idem mv_sales_daily.';
CREATE UNIQUE INDEX idx_mv_stock_variance_pk ON public.mv_stock_variance USING btree (product_id);

CREATE VIEW public.v_product_available_stock WITH (security_invoker=true) AS
SELECT p.id AS product_id,
    p.sku,
    p.name,
    p.current_stock,
    COALESCE(sum(r.quantity) FILTER (WHERE r.status = 'held'::text AND r.expires_at > now()), 0::numeric) AS held_quantity,
    GREATEST(0::numeric, p.current_stock - COALESCE(sum(r.quantity) FILTER (WHERE r.status = 'held'::text AND r.expires_at > now()), 0::numeric)) AS available_quantity
   FROM products p
     LEFT JOIN stock_reservations r ON r.product_id = p.id
  WHERE p.deleted_at IS NULL
  GROUP BY p.id, p.sku, p.name, p.current_stock;
ALTER VIEW public.v_product_available_stock OWNER TO postgres;
REVOKE ALL ON TABLE public.v_product_available_stock FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON TABLE public.v_product_available_stock TO postgres;
GRANT SELECT ON TABLE public.v_product_available_stock TO postgres;
GRANT UPDATE ON TABLE public.v_product_available_stock TO postgres;
GRANT DELETE ON TABLE public.v_product_available_stock TO postgres;
GRANT TRUNCATE ON TABLE public.v_product_available_stock TO postgres;
GRANT REFERENCES ON TABLE public.v_product_available_stock TO postgres;
GRANT TRIGGER ON TABLE public.v_product_available_stock TO postgres;
GRANT MAINTAIN ON TABLE public.v_product_available_stock TO postgres;
GRANT INSERT ON TABLE public.v_product_available_stock TO authenticated;
GRANT SELECT ON TABLE public.v_product_available_stock TO authenticated;
GRANT UPDATE ON TABLE public.v_product_available_stock TO authenticated;
GRANT DELETE ON TABLE public.v_product_available_stock TO authenticated;
GRANT TRUNCATE ON TABLE public.v_product_available_stock TO authenticated;
GRANT REFERENCES ON TABLE public.v_product_available_stock TO authenticated;
GRANT TRIGGER ON TABLE public.v_product_available_stock TO authenticated;
GRANT MAINTAIN ON TABLE public.v_product_available_stock TO authenticated;
GRANT INSERT ON TABLE public.v_product_available_stock TO service_role;
GRANT SELECT ON TABLE public.v_product_available_stock TO service_role;
GRANT UPDATE ON TABLE public.v_product_available_stock TO service_role;
GRANT DELETE ON TABLE public.v_product_available_stock TO service_role;
GRANT TRUNCATE ON TABLE public.v_product_available_stock TO service_role;
GRANT REFERENCES ON TABLE public.v_product_available_stock TO service_role;
GRANT TRIGGER ON TABLE public.v_product_available_stock TO service_role;
GRANT MAINTAIN ON TABLE public.v_product_available_stock TO service_role;
COMMENT ON VIEW public.v_product_available_stock IS 'Per-product current_stock − held_quantity. Use for UI availability checks.';

CREATE VIEW public.view_product_recipes WITH (security_invoker=true) AS
SELECT r.id AS recipe_id,
    r.product_id,
    p.name AS product_name,
    p.sku AS product_sku,
    p.unit AS product_unit,
    r.material_id,
    m.name AS material_name,
    m.sku AS material_sku,
    m.unit AS material_unit,
    m.cost_price AS material_cost_price,
    m.current_stock AS material_current_stock,
    r.quantity,
    r.unit,
    r.is_active,
    r.notes,
    r.created_at,
    r.updated_at
   FROM recipes r
     JOIN products p ON p.id = r.product_id AND p.deleted_at IS NULL
     JOIN products m ON m.id = r.material_id AND m.deleted_at IS NULL
  WHERE r.deleted_at IS NULL;
ALTER VIEW public.view_product_recipes OWNER TO postgres;
REVOKE ALL ON TABLE public.view_product_recipes FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON TABLE public.view_product_recipes TO postgres;
GRANT SELECT ON TABLE public.view_product_recipes TO postgres;
GRANT UPDATE ON TABLE public.view_product_recipes TO postgres;
GRANT DELETE ON TABLE public.view_product_recipes TO postgres;
GRANT TRUNCATE ON TABLE public.view_product_recipes TO postgres;
GRANT REFERENCES ON TABLE public.view_product_recipes TO postgres;
GRANT TRIGGER ON TABLE public.view_product_recipes TO postgres;
GRANT MAINTAIN ON TABLE public.view_product_recipes TO postgres;
GRANT INSERT ON TABLE public.view_product_recipes TO authenticated;
GRANT SELECT ON TABLE public.view_product_recipes TO authenticated;
GRANT UPDATE ON TABLE public.view_product_recipes TO authenticated;
GRANT DELETE ON TABLE public.view_product_recipes TO authenticated;
GRANT TRUNCATE ON TABLE public.view_product_recipes TO authenticated;
GRANT REFERENCES ON TABLE public.view_product_recipes TO authenticated;
GRANT TRIGGER ON TABLE public.view_product_recipes TO authenticated;
GRANT MAINTAIN ON TABLE public.view_product_recipes TO authenticated;
GRANT INSERT ON TABLE public.view_product_recipes TO service_role;
GRANT SELECT ON TABLE public.view_product_recipes TO service_role;
GRANT UPDATE ON TABLE public.view_product_recipes TO service_role;
GRANT DELETE ON TABLE public.view_product_recipes TO service_role;
GRANT TRUNCATE ON TABLE public.view_product_recipes TO service_role;
GRANT REFERENCES ON TABLE public.view_product_recipes TO service_role;
GRANT TRIGGER ON TABLE public.view_product_recipes TO service_role;
GRANT MAINTAIN ON TABLE public.view_product_recipes TO service_role;
COMMENT ON VIEW public.view_product_recipes IS 'Session 13 — Phase 2.A. Read-only join of recipes + product + material. security_invoker=true means caller RLS applies (recipes requires inventory.read).';

CREATE VIEW public.view_recipe_products WITH (security_invoker=true) AS
WITH RECURSIVE leaf_walk AS (
         SELECT r.product_id AS root_product_id,
            r.material_id,
            1 AS depth,
            ARRAY[r.product_id] AS path
           FROM recipes r
          WHERE r.is_active = true AND r.deleted_at IS NULL
        UNION ALL
         SELECT lw.root_product_id,
            r.material_id,
            lw.depth + 1,
            lw.path || r.product_id
           FROM leaf_walk lw
             JOIN recipes r ON r.product_id = lw.material_id AND r.is_active = true AND r.deleted_at IS NULL
          WHERE lw.depth < 5 AND NOT (r.product_id = ANY (lw.path))
        ), leaf_only AS (
         SELECT DISTINCT lw.root_product_id,
            lw.material_id
           FROM leaf_walk lw
          WHERE NOT (EXISTS ( SELECT 1
                   FROM recipes r2
                  WHERE r2.product_id = lw.material_id AND r2.is_active = true AND r2.deleted_at IS NULL))
        ), leaf_counts AS (
         SELECT leaf_only.root_product_id AS product_id,
            count(*)::integer AS leaf_count
           FROM leaf_only
          GROUP BY leaf_only.root_product_id
        )
 SELECT p.id AS product_id,
    p.sku,
    p.name,
    p.unit,
    p.cost_price,
    p.current_stock,
    (EXISTS ( SELECT 1
           FROM recipes r
          WHERE r.product_id = p.id AND r.is_active = true AND r.deleted_at IS NULL)) AS has_recipe,
    COALESCE(lc.leaf_count, 0) AS leaf_ingredient_count
   FROM products p
     LEFT JOIN leaf_counts lc ON lc.product_id = p.id
  WHERE p.is_active = true AND p.deleted_at IS NULL;
ALTER VIEW public.view_recipe_products OWNER TO postgres;
REVOKE ALL ON TABLE public.view_recipe_products FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON TABLE public.view_recipe_products TO postgres;
GRANT SELECT ON TABLE public.view_recipe_products TO postgres;
GRANT UPDATE ON TABLE public.view_recipe_products TO postgres;
GRANT DELETE ON TABLE public.view_recipe_products TO postgres;
GRANT TRUNCATE ON TABLE public.view_recipe_products TO postgres;
GRANT REFERENCES ON TABLE public.view_recipe_products TO postgres;
GRANT TRIGGER ON TABLE public.view_recipe_products TO postgres;
GRANT MAINTAIN ON TABLE public.view_recipe_products TO postgres;
GRANT INSERT ON TABLE public.view_recipe_products TO authenticated;
GRANT SELECT ON TABLE public.view_recipe_products TO authenticated;
GRANT UPDATE ON TABLE public.view_recipe_products TO authenticated;
GRANT DELETE ON TABLE public.view_recipe_products TO authenticated;
GRANT TRUNCATE ON TABLE public.view_recipe_products TO authenticated;
GRANT REFERENCES ON TABLE public.view_recipe_products TO authenticated;
GRANT TRIGGER ON TABLE public.view_recipe_products TO authenticated;
GRANT MAINTAIN ON TABLE public.view_recipe_products TO authenticated;
GRANT INSERT ON TABLE public.view_recipe_products TO service_role;
GRANT SELECT ON TABLE public.view_recipe_products TO service_role;
GRANT UPDATE ON TABLE public.view_recipe_products TO service_role;
GRANT DELETE ON TABLE public.view_recipe_products TO service_role;
GRANT TRUNCATE ON TABLE public.view_recipe_products TO service_role;
GRANT REFERENCES ON TABLE public.view_recipe_products TO service_role;
GRANT TRIGGER ON TABLE public.view_recipe_products TO service_role;
GRANT MAINTAIN ON TABLE public.view_recipe_products TO service_role;
COMMENT ON VIEW public.view_recipe_products IS 'Session 15 - Phase 3.A. Products with has_recipe flag and recursive leaf_ingredient_count (depth-5 capped, cycle-guarded). INVOKER rights - underlying RLS on products/recipes governs visibility.';
