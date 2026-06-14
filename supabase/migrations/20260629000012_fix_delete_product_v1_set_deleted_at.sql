-- 20260629000012_fix_delete_product_v1_set_deleted_at.sql
-- Session 45 corrective — delete_product_v1 must set deleted_at so the product
-- is excluded by the catalog list filter (.is('deleted_at', null)).
--
-- Changes vs _010:
--   1. Lookup ignores deleted_at (so replay on already-deleted product works).
--   2. Replay guard keys on deleted_at IS NOT NULL (not is_active = false,
--      which would short-circuit a deactivated-but-not-deleted product).
--   3. UPDATE sets both is_active = false AND deleted_at = now().
--   4. D2 guard unchanged (active child = is_active = true AND deleted_at IS NULL).
--   5. Signature unchanged — same name + args. No version bump (corrective pattern).

CREATE OR REPLACE FUNCTION public.delete_product_v1(
  p_product_id      UUID,
  p_idempotency_key UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public, pg_temp
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

  -- Load the product row regardless of deleted_at/is_active so that:
  --   • a replay on an already-deleted product finds the row and returns idempotent_replay
  --   • a true 404 (id never existed) still raises P0002
  SELECT * INTO v_product FROM products WHERE id = p_product_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency: keyed on deleted_at, NOT is_active.
  -- A deactivated (is_active=false) but not yet deleted (deleted_at NULL) product
  -- must still proceed to set deleted_at, so we only replay if deleted_at is already set.
  IF v_product.deleted_at IS NOT NULL THEN
    RETURN jsonb_build_object(
      'product_id',        p_product_id,
      'deleted',           true,
      'idempotent_replay', true
    );
  END IF;

  -- D2 guard: refuse to delete a parent that still has active child variants.
  -- Caller must delete/deactivate all children first, or dissolve the parent
  -- via convert_parent_to_standalone_v1.
  SELECT COUNT(*) INTO v_active_variants
    FROM products
   WHERE parent_product_id = p_product_id
     AND is_active         = true
     AND deleted_at        IS NULL;

  IF v_active_variants > 0 THEN
    RAISE EXCEPTION 'parent_has_active_variants'
      USING ERRCODE = 'P0001',
            DETAIL  = jsonb_build_object('active_variant_count', v_active_variants)::TEXT;
  END IF;

  -- Remove from catalog: set both flags so every filter path sees the product gone.
  --   is_active = false   → excluded from POS product grid + BO Inactive badge (was correct)
  --   deleted_at = now()  → excluded by useProducts .is('deleted_at', null) catalog filter
  UPDATE products
     SET is_active  = false,
         deleted_at = now(),
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
    'product_id',        p_product_id,
    'deleted',           true,
    'idempotent_replay', false
  );
END;
$$;

COMMENT ON FUNCTION public.delete_product_v1(UUID, UUID) IS
  'Session 45 Wave A (corrective _012): Soft-delete a product — sets is_active=false AND deleted_at=now() so it is excluded from catalog list filter. Replay guard keys on deleted_at IS NOT NULL. Guards: product_not_found (P0002), parent_has_active_variants (P0001). Perm gate: products.delete (ADMIN+/SUPER_ADMIN only). Audit: product.deleted.';
