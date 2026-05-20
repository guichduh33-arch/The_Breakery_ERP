-- Session 27 / Wave 1.A.3 — set_product_sections_v1 M2M reconcile + primary guard.
-- Superseded by 20260520025140 corrective; this file kept for migration ordering.
CREATE OR REPLACE FUNCTION set_product_sections_v1(
  p_product_id          UUID,
  p_section_ids         UUID[],
  p_primary_section_id  UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
BEGIN
  IF NOT has_permission(v_caller_id, 'products.sections.update') THEN
    RAISE EXCEPTION 'permission_denied' USING ERRCODE = '42501';
  END IF;

  IF p_primary_section_id IS NOT NULL
     AND NOT (p_primary_section_id = ANY(p_section_ids)) THEN
    RAISE EXCEPTION 'primary_section_must_be_in_set'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM products WHERE id = p_product_id AND deleted_at IS NULL) THEN
    RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002';
  END IF;

  DELETE FROM product_sections
   WHERE product_id = p_product_id
     AND section_id <> ALL(p_section_ids);

  INSERT INTO product_sections (product_id, section_id, is_primary)
  SELECT p_product_id, sid, (sid = p_primary_section_id)
    FROM unnest(p_section_ids) AS sid
  ON CONFLICT (product_id, section_id) DO UPDATE SET
    is_primary = EXCLUDED.is_primary;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, payload)
  VALUES (v_caller_id, 'product.sections', 'product', p_product_id,
          jsonb_build_object('section_ids', p_section_ids, 'primary', p_primary_section_id));

  RETURN jsonb_build_object(
    'sections', COALESCE((SELECT jsonb_agg(jsonb_build_object(
                          'section_id', ps.section_id,
                          'is_primary', ps.is_primary,
                          'section', to_jsonb(s.*)))
                   FROM product_sections ps
                   JOIN sections s ON s.id = ps.section_id
                   WHERE ps.product_id = p_product_id),
                   '[]'::JSONB)
  );
END;
$$;

COMMENT ON FUNCTION set_product_sections_v1(UUID, UUID[], UUID) IS
  'Session 27 Wave 1.A.3: REPLACE product↔section M2M (DELETE missing + UPSERT given). Enforces primary ∈ set. SECURITY DEFINER, perm gate products.sections.update.';
