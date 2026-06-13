-- 20260629000010_create_delete_product_v1_rpc.sql
-- Session 45 / Wave A — Soft-delete a product by setting is_active = false.
--
-- Permission gate : products.delete (seeded S13 migration 20260513000004,
--   granted to ADMIN + SUPER_ADMIN only — NOT MANAGER, NOT CASHIER).
--
-- Guards:
--   D1 — product not found → P0002 (product_not_found)
--   D2 — parent with ≥1 active child variant → P0001 (parent_has_active_variants)
--
-- Idempotency: calling on an already-inactive product returns idempotent_replay=true
--   and does NOT insert a second audit_logs row.
--
-- Audit: on first successful delete → audit_logs (actor_id, action, entity_type,
--   entity_id, metadata) with action='product.deleted'.

CREATE OR REPLACE FUNCTION public.delete_product_v1(
  p_product_id      UUID,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id      UUID := auth.uid();
  v_product        products%ROWTYPE;
  v_active_variants INT;
BEGIN
  -- Auth-first: check permission before any data access
  IF NOT public.has_permission(v_caller_id, 'products.delete') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  -- Load the product row (including soft-deleted — soft-delete is our write here)
  SELECT * INTO v_product FROM products WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: already soft-deleted → replay without a second audit row
  IF v_product.is_active = false THEN
    RETURN jsonb_build_object(
      'product_id',       p_product_id,
      'deleted',          true,
      'idempotent_replay', true
    );
  END IF;

  -- D2 guard: refuse to soft-delete a parent that still has active child variants.
  -- Caller must either delete/deactivate all children first, or dissolve the parent
  -- via convert_parent_to_standalone_v1.
  SELECT COUNT(*) INTO v_active_variants
    FROM products
   WHERE parent_product_id = p_product_id
     AND is_active = true
     AND deleted_at IS NULL;

  IF v_active_variants > 0 THEN
    RAISE EXCEPTION 'parent_has_active_variants'
      USING ERRCODE = 'P0001',
            DETAIL  = jsonb_build_object('active_variant_count', v_active_variants)::TEXT;
  END IF;

  -- Soft-delete
  UPDATE products
     SET is_active  = false,
         updated_at = now()
   WHERE id = p_product_id;

  -- Audit (canonical cols: actor_id / action / entity_type / entity_id / metadata)
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_caller_id,
    'product.deleted',
    'product',
    p_product_id,
    jsonb_build_object(
      'sku',             v_product.sku,
      'name',            v_product.name,
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN jsonb_build_object(
    'product_id',       p_product_id,
    'deleted',          true,
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION public.delete_product_v1(UUID, UUID) IS
  'Session 45 Wave A: Soft-delete a product (is_active=false). Guards: product_not_found (P0002), parent_has_active_variants (P0001). Idempotent on already-inactive products. Perm gate: products.delete (ADMIN+/SUPER_ADMIN only). Audit: product.deleted.';
