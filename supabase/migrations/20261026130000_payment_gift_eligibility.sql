-- Cadeaux sans choix implicite : contrôle partagé entre catalogue et paiement.
CREATE FUNCTION public._assert_payment_gift_eligible_v1(p_product_id uuid)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_product public.products%ROWTYPE;
BEGIN
  SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
  IF NOT FOUND OR NOT v_product.is_active OR v_product.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'promo_gift_unavailable: gift product is unavailable'
      USING ERRCODE = 'check_violation';
  END IF;
  IF v_product.product_type = 'combo' OR EXISTS (
    SELECT 1 FROM public.products WHERE parent_product_id = p_product_id AND deleted_at IS NULL
  ) OR EXISTS (
    SELECT 1 FROM public.product_modifiers m
    WHERE m.is_active AND m.deleted_at IS NULL AND m.group_required
      AND (m.product_id = p_product_id OR (
        m.product_id IS NULL AND m.category_id = v_product.category_id
        AND NOT EXISTS (SELECT 1 FROM public.product_modifiers override_group
          WHERE override_group.product_id = p_product_id
            AND override_group.group_name = m.group_name
            AND override_group.is_active AND override_group.deleted_at IS NULL)
      ))
  ) THEN
    RAISE EXCEPTION 'promo_gift_requires_configuration: choose a gift without composition or required options'
      USING ERRCODE = 'check_violation';
  END IF;
  PERFORM public._assert_product_sellable_v1(p_product_id, false);
END;
$$;

CREATE FUNCTION public._payment_gift_items_v1(p_evaluation jsonb, p_promotions jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp AS $$
DECLARE v_gift record; v_result jsonb := '[]'::jsonb;
BEGIN
  IF (SELECT count(*) <> count(DISTINCT item->>'promotion_id')
      FROM jsonb_array_elements(COALESCE(p_promotions, '[]'::jsonb)) item) THEN
    RAISE EXCEPTION 'promo_declaration_duplicate: declare each promotion only once'
      USING ERRCODE = 'check_violation';
  END IF;
  FOR v_gift IN
    SELECT (promo->>'promotion_id')::uuid AS promotion_id,
      (gift->>'product_id')::uuid AS product_id, sum((gift->>'quantity')::numeric) AS quantity
    FROM jsonb_array_elements(COALESCE(p_evaluation->'applied_promotions', '[]'::jsonb)) promo
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(promo->'free_items', '[]'::jsonb)) gift
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(p_promotions, '[]'::jsonb)) chosen
      WHERE chosen->>'promotion_id' = promo->>'promotion_id')
    GROUP BY promo->>'promotion_id', gift->>'product_id'
    ORDER BY promo->>'promotion_id', gift->>'product_id'
  LOOP
    IF v_gift.quantity IS NULL OR v_gift.quantity <= 0 THEN
      RAISE EXCEPTION 'promo_gift_invalid_quantity' USING ERRCODE = 'check_violation';
    END IF;
    v_result := v_result || jsonb_build_array(jsonb_build_object(
      'product_id', v_gift.product_id, 'quantity', v_gift.quantity,
      'unit_price', 0, 'modifiers', '[]'::jsonb,
      'is_promo_gift', true, 'promotion_id', v_gift.promotion_id));
  END LOOP;
  RETURN v_result;
END;
$$;

CREATE FUNCTION public._check_promotion_gift_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.is_active AND NEW.deleted_at IS NULL THEN
    IF NEW.type = 'free_product' THEN
      PERFORM public._assert_payment_gift_eligible_v1(NEW.gift_product_id);
    ELSIF NEW.type = 'bogo' AND NEW.bogo_get_product_id IS NOT NULL
      AND NEW.bogo_buy_quantity IS NOT NULL AND NEW.bogo_get_quantity IS NOT NULL THEN
      PERFORM public._assert_payment_gift_eligible_v1(NEW.bogo_get_product_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER promotion_gift_eligibility
BEFORE INSERT OR UPDATE ON public.promotions
FOR EACH ROW EXECUTE FUNCTION public._check_promotion_gift_v1();

REVOKE ALL ON FUNCTION public._assert_payment_gift_eligible_v1(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._payment_gift_items_v1(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._check_promotion_gift_v1() FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
