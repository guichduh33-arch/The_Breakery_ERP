-- 20260901000016_orders_costs_cash_actor_profile_id.sql
--
-- Lot « actor_id transverse », volet commandes / coûts de recette / coffre — 7 RPC.
-- Contexte et contrat du helper : 20260901000013_current_profile_id_helper.sql.
--
-- Défaut corrigé : audit_logs.actor_id recevait auth.uid() (v_caller_id / v_uid) alors
-- que sa FK cible user_profiles(id). Pour tout compte créé par le back-office
-- (id <> auth_user_id) :
--   · l'édition d'une commande ouverte depuis le back-office (ajout, retrait, quantité)
--     et l'abandon d'une commande en attente depuis la caisse échouaient en 23503 ;
--   · record_cash_wallet_movement — CHEMIN D'ARGENT — écrivait aussi auth.uid() dans
--     journal_entries.created_by (FK user_profiles) : aucun mouvement de coffre ne
--     passait pour ces comptes ;
--   · update_order_item_qty_v5 résolvait déjà v_profile_id pour la perte déclarée mais
--     posait quand même v_caller_id dans l'audit.
-- Cas particulier des deux recalculs de coût : appelés par le cron
-- recompute-recipe-costs-daily sans contexte auth, ils écrivent aujourd'hui actor_id
-- NULL (233 + 78 lignes sur dev, jamais un acteur). Le helper rend NULL sans auth,
-- ce chemin ne change pas ; sous un vrai appelant il rend enfin le profil. Le motif
-- « IF v_uid IS NOT NULL AND NOT has_permission » (porte fail-open, finding 5 du même
-- audit) est HORS de ce lot et reste tel quel — il se tranche séparément.
--
-- Transformation :
--   · DECLARE : v_actor_profile UUID := _current_profile_id();
--   · audit_logs.actor_id et journal_entries.created_by (coffre) reçoivent v_actor_profile ;
--   · la variable auth.uid() est conservée pour has_permission(…) ;
--   · le libellé metadata rpc_version des deux RPC qui en portent un suit le bump
--     (add_order_item 'v5-adr022' → 'v6-actor-profile' ; update_order_item_qty
--     'v4-adr013-lot3', déjà périmé sous v5, → 'v6-actor-profile') ;
--   · recompute_all_recipe_costs_v2 appelle recompute_recipe_cost_v2 ; le cron
--     recompute-recipe-costs-daily (jobid live 12, '15 2 * * *') est replanifié sur v2
--     dans ce fichier, même méthode que 20260630000023.
-- Rien d'autre ne bouge dans les corps.
--
-- Versioning monotone : _vN+1 créées, _vN droppées dans ce fichier, signatures
-- inchangées. PROVENANCE DES CORPS : pg_get_functiondef sur la base live, relevé le
-- 2026-09-06 ; le garde ci-dessous refuse la migration si un corps a dérivé.
--
-- Grants : miroir des grants live (authenticated + service_role) + REVOKE PUBLIC/anon.
-- Types à régénérer (packages/supabase/src/types.generated.ts).

DO $$
DECLARE
  v_expected CONSTANT jsonb := jsonb_build_object(
    'add_order_item_v5',              '89ca57900d5b82536815897f8aadfdb4',
    'remove_order_item_v3',           '614eb4a7eb4fcae60ff280ff686ab284',
    'update_order_item_qty_v5',       '6d52f2714937028b66a591683692c122',
    'discard_held_order_v1',          '72d1f96128ef708d6e70e2f6d0143520',
    'recompute_recipe_cost_v1',       'd5832cc38414c2da7d36f102512c641c',
    'recompute_all_recipe_costs_v1',  'f637330aa0b07e9c7818bb93dbf9efd6',
    'record_cash_wallet_movement_v1', 'a4fab13771073d7c1a71905759bfcef3'
  );
  v_name TEXT;
  v_md5  TEXT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = '_current_profile_id') THEN
    RAISE EXCEPTION '_current_profile_id absent — appliquer 20260901000013 d''abord';
  END IF;
  FOR v_name IN SELECT jsonb_object_keys(v_expected) LOOP
    SELECT md5(regexp_replace(pg_get_functiondef(p.oid), '\s', '', 'g')) INTO v_md5
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_name;
    IF v_md5 IS DISTINCT FROM (v_expected ->> v_name) THEN
      RAISE EXCEPTION 'corps live de % inattendu (md5 %) — il a dérivé depuis le relevé du 2026-09-06, retransformer depuis pg_get_functiondef', v_name, v_md5;
    END IF;
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- add_order_item_v5 -> v6
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_order_item_v6(p_order_id uuid, p_product_id uuid, p_qty integer, p_modifiers jsonb, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid(); v_status TEXT; v_customer_id UUID; v_product RECORD;
  v_order_item_id UUID; v_replay JSONB; v_result JSONB;
  v_lp RECORD;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;
  SELECT status, customer_id INTO v_status, v_customer_id FROM orders WHERE id = p_order_id FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'add';
  IF FOUND THEN RETURN v_replay; END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002'; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive' USING ERRCODE = '22023'; END IF;
  -- ADR-022 dec. 1 : meme regle de vendabilite que le money-path. v4 ne
  -- verifiait que is_active ; le soft-deleted et le produit-parent passaient.
  PERFORM _assert_product_sellable_v1(p_product_id, false);
  SELECT id, name, product_type INTO v_product FROM products WHERE id = p_product_id;
  IF v_product.product_type = 'combo' THEN
    RAISE EXCEPTION 'Combo products cannot be added from order edit (no composition)' USING ERRCODE = 'check_violation';
  END IF;
  -- ADR-013 D15/M2 : prix de base + modificateurs resolus SERVEUR (meme
  -- resolveur que complete_order_with_payment). price_adjustment client ignore.
  SELECT lp.unit_price, lp.modifiers_total, lp.line_subtotal, lp.modifiers_resolved
    INTO v_lp
    FROM _resolve_line_price_v2(p_product_id, p_qty::numeric, COALESCE(p_modifiers, '[]'::jsonb), v_customer_id, false, false) lp;
  INSERT INTO order_items (order_id, product_id, name_snapshot, quantity, unit_price, line_total, modifiers, modifiers_total)
  VALUES (p_order_id, v_product.id, v_product.name, p_qty, v_lp.unit_price, v_lp.line_subtotal, v_lp.modifiers_resolved, round_idr(v_lp.modifiers_total * p_qty))
  RETURNING id INTO v_order_item_id;
  PERFORM _recalc_order_totals(p_order_id);
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'order.item.add', 'order', p_order_id, jsonb_build_object('order_item_id', v_order_item_id, 'product_id', v_product.id, 'qty', p_qty, 'unit_price', v_lp.unit_price, 'modifiers_total', round_idr(v_lp.modifiers_total * p_qty), 'rpc_version', 'v6-actor-profile'));
  v_result := jsonb_build_object('order_item_id', v_order_item_id,
    'order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total) FROM orders WHERE id = p_order_id));
  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result) VALUES (p_idempotency_key, 'add', p_order_id, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.add_order_item_v6(uuid, uuid, integer, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.add_order_item_v6(uuid, uuid, integer, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.add_order_item_v6(uuid, uuid, integer, jsonb, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.add_order_item_v6(uuid, uuid, integer, jsonb, uuid) TO service_role;
COMMENT ON FUNCTION public.add_order_item_v6(uuid, uuid, integer, jsonb, uuid) IS
  'BO edit-items : ajout de ligne sur commande ouverte, garde de vendabilité complète (ADR-022 déc. 1, _assert_product_sellable_v1), prix et modificateurs résolus serveur (_resolve_line_price_v2). Aucun drapeau de tolérance. v6 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v5 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- remove_order_item_v3 -> v4
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_order_item_v4(p_order_item_id uuid, p_idempotency_key uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid(); v_order_id UUID; v_status TEXT; v_is_locked BOOLEAN; v_replay JSONB; v_result JSONB;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'remove';
  IF FOUND THEN RETURN v_replay; END IF;
  SELECT oi.order_id, o.status, oi.is_locked INTO v_order_id, v_status, v_is_locked
  FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE oi.id = p_order_item_id FOR UPDATE;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'remove';
  IF FOUND THEN RETURN v_replay; END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002'; END IF;
  IF v_is_locked THEN RAISE EXCEPTION 'Locked item: removal forbidden — use the cancel flow (mandatory waste declaration)' USING ERRCODE = 'check_violation'; END IF;
  DELETE FROM order_items WHERE id = p_order_item_id;
  PERFORM _recalc_order_totals(v_order_id);
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'order.item.remove', 'order', v_order_id, jsonb_build_object('order_item_id', p_order_item_id));
  v_result := jsonb_build_object('order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total) FROM orders WHERE id = v_order_id));
  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result) VALUES (p_idempotency_key, 'remove', v_order_id, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.remove_order_item_v4(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.remove_order_item_v4(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v4(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.remove_order_item_v4(uuid, uuid) TO service_role;
COMMENT ON FUNCTION public.remove_order_item_v4(uuid, uuid) IS
  'BO edit-items : retrait d''une ligne non verrouillée d''une commande ouverte (ligne firée → flux cancel). v4 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v3 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- update_order_item_qty_v5 -> v6
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_order_item_qty_v6(p_order_item_id uuid, p_qty integer, p_idempotency_key uuid, p_auth_id uuid DEFAULT NULL::uuid, p_waste_qty numeric DEFAULT NULL::numeric, p_waste_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_caller_id UUID := auth.uid(); v_order_id UUID; v_status TEXT; v_unit_price NUMERIC; v_is_locked BOOLEAN;
  v_old_qty NUMERIC; v_product_id UUID; v_combo JSONB; v_delta NUMERIC; v_waste NUMERIC;
  v_authorized_by UUID; v_profile_id UUID; v_replay JSONB; v_result JSONB;
  v_customer_id UUID; v_modifiers JSONB; v_is_gift BOOLEAN; v_product_type TEXT;
  v_old_line_total NUMERIC; v_old_mod_total NUMERIC;
  v_new_line_total NUMERIC; v_new_mod_total NUMERIC; v_new_modifiers JSONB;
  v_lp RECORD;
BEGIN
  IF v_caller_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF NOT has_permission(v_caller_id, 'orders.edit_open') THEN RAISE EXCEPTION 'Permission denied: orders.edit_open' USING ERRCODE = '42501'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;
  IF p_qty <= 0 THEN RAISE EXCEPTION 'Quantity must be positive (use remove_order_item_v4 for 0)' USING ERRCODE = '22023'; END IF;
  SELECT oi.order_id, o.status, oi.unit_price, oi.is_locked, oi.quantity, oi.product_id, oi.combo_components,
         o.customer_id, oi.modifiers, COALESCE(oi.is_promo_gift, false), p.product_type::text,
         oi.line_total, oi.modifiers_total
    INTO v_order_id, v_status, v_unit_price, v_is_locked, v_old_qty, v_product_id, v_combo,
         v_customer_id, v_modifiers, v_is_gift, v_product_type,
         v_old_line_total, v_old_mod_total
  FROM order_items oi
  JOIN orders o ON o.id = oi.order_id
  LEFT JOIN products p ON p.id = oi.product_id
  WHERE oi.id = p_order_item_id FOR UPDATE OF oi, o;
  IF v_order_id IS NULL THEN RAISE EXCEPTION 'Order item not found' USING ERRCODE = 'P0002'; END IF;
  SELECT result INTO v_replay FROM order_edit_idempotency_keys WHERE key = p_idempotency_key AND action = 'update_qty';
  IF FOUND THEN RETURN v_replay; END IF;
  IF v_status NOT IN ('draft', 'pending_payment') THEN RAISE EXCEPTION 'Order cannot be edited (status: %)', v_status USING ERRCODE = 'P0002'; END IF;
  IF v_is_locked THEN
    IF p_qty >= v_old_qty THEN RAISE EXCEPTION 'Locked line: quantity can only decrease (add a new line to increase)' USING ERRCODE = 'check_violation'; END IF;
    v_delta := v_old_qty - p_qty;
    IF p_auth_id IS NULL THEN RAISE EXCEPTION 'Manager authorization required (locked line)' USING ERRCODE = 'P0003'; END IF;
    UPDATE discount_authorizations SET consumed_at = now(), consumed_order_id = v_order_id
     WHERE id = p_auth_id AND consumed_at IS NULL AND expires_at > now() AND scope = 'order_item_edit'
     RETURNING manager_profile_id INTO v_authorized_by;
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid or expired manager authorization' USING ERRCODE = 'P0003'; END IF;
    v_waste := COALESCE(p_waste_qty, v_delta);
    IF v_waste < 0 OR v_waste > v_delta THEN RAISE EXCEPTION 'Waste quantity must be between 0 and % (removed delta)', v_delta USING ERRCODE = 'check_violation'; END IF;
    IF length(coalesce(p_waste_reason, '')) < 3 THEN RAISE EXCEPTION 'Waste reason required (>= 3 chars)' USING ERRCODE = 'check_violation'; END IF;
    SELECT id INTO v_profile_id FROM user_profiles WHERE auth_user_id = v_caller_id AND deleted_at IS NULL;
    IF v_profile_id IS NULL THEN RAISE EXCEPTION 'User profile not found' USING ERRCODE = 'P0001'; END IF;
  END IF;
  -- ADR-013 D15/M2 -- pricing hybride :
  IF v_is_locked THEN
    -- Ligne firee : per-unit entierement GELE, simple re-echelonnage du persiste.
    -- (l'ancienne v3 `unit_price * qty` perdait la part modificateurs des lignes
    -- firees ; et une re-resolution pourrait echouer sur un modificateur
    -- desactive depuis le fire -- interdit de bloquer une baisse autorisee.)
    v_new_line_total := round_idr(v_old_line_total / v_old_qty * p_qty);
    v_new_mod_total  := CASE WHEN v_old_mod_total IS NULL THEN NULL ELSE round_idr(v_old_mod_total / v_old_qty * p_qty) END;
    v_new_modifiers  := v_modifiers;
  ELSIF v_product_type = 'combo' OR v_combo IS NOT NULL THEN
    -- Combo : unit_price persiste (inclut les surcharges de composition), pas de modifiers.
    v_new_line_total := round_idr(v_unit_price * p_qty);
    v_new_mod_total  := v_old_mod_total;
    v_new_modifiers  := v_modifiers;
  ELSE
    -- Ligne libre : unit_price persiste CONSERVE, modificateurs re-tarifes
    -- serveur (le price_adjustment du blob persiste n'est jamais cru).
    SELECT lp.modifiers_total, lp.modifiers_resolved INTO v_lp
      FROM _resolve_line_price_v2(v_product_id, p_qty::numeric, COALESCE(v_modifiers, '[]'::jsonb), v_customer_id, v_is_gift, false) lp;
    v_new_line_total := round_idr((v_unit_price + v_lp.modifiers_total) * p_qty);
    v_new_mod_total  := round_idr(v_lp.modifiers_total * p_qty);
    v_new_modifiers  := v_lp.modifiers_resolved;
  END IF;
  UPDATE order_items
     SET quantity = p_qty, line_total = v_new_line_total, modifiers_total = v_new_mod_total, modifiers = v_new_modifiers
   WHERE id = p_order_item_id;
  PERFORM _recalc_order_totals(v_order_id);
  IF v_is_locked AND v_waste > 0 THEN
    PERFORM _record_order_item_waste_v1(p_order_item_id, v_order_id, v_product_id, v_combo, v_waste, p_waste_reason, v_profile_id);
  END IF;
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'order.item.update_qty', 'order', v_order_id,
          jsonb_build_object('order_item_id', p_order_item_id, 'new_qty', p_qty, 'rpc_version', 'v6-actor-profile')
          || CASE WHEN v_is_locked THEN jsonb_build_object('is_locked', true, 'authorized_by', v_authorized_by, 'old_qty', v_old_qty, 'delta', v_delta, 'waste_qty', v_waste, 'waste_reason', p_waste_reason) ELSE '{}'::jsonb END);
  v_result := jsonb_build_object('order_totals', (SELECT jsonb_build_object('subtotal', subtotal, 'tax_amount', tax_amount, 'total', total) FROM orders WHERE id = v_order_id));
  INSERT INTO order_edit_idempotency_keys (key, action, order_id, result) VALUES (p_idempotency_key, 'update_qty', v_order_id, v_result);
  RETURN v_result;
END;
$function$;

REVOKE ALL ON FUNCTION public.update_order_item_qty_v6(uuid, integer, uuid, uuid, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_order_item_qty_v6(uuid, integer, uuid, uuid, numeric, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v6(uuid, integer, uuid, uuid, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_order_item_qty_v6(uuid, integer, uuid, uuid, numeric, text) TO service_role;
COMMENT ON FUNCTION public.update_order_item_qty_v6(uuid, integer, uuid, uuid, numeric, text) IS
  'BO edit-items : changement de quantité, pricing hybride (unit_price persisté conservé ; locked = per-unit gelé ; libre = modificateurs re-tarifés serveur) via _resolve_line_price_v2, ADR-020 déc. 4. v6 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v5 écrivait auth.uid() alors qu''elle résolvait déjà le profil pour la perte).';

-- ---------------------------------------------------------------------------
-- discard_held_order_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.discard_held_order_v2(p_order_id uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_uid       UUID := auth.uid();
  v_order_no  TEXT;
  v_was_held  BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = 'P0001';
  END IF;
  IF NOT has_permission(v_uid, 'orders.void') THEN
    RAISE EXCEPTION 'Permission denied: orders.void' USING ERRCODE = 'P0003';
  END IF;
  IF length(trim(COALESCE(p_reason, ''))) < 10 THEN
    RAISE EXCEPTION 'reason_too_short' USING ERRCODE = 'P0001';
  END IF;

  -- Held draft/fired OU commande POS non payée orpheline (is_held=false).
  -- Jamais une commande payée/voided (→ void/refund), ni B2B.
  SELECT order_number, is_held INTO v_order_no, v_was_held
  FROM orders
  WHERE id = p_order_id
    AND status IN ('draft', 'pending_payment')
    AND (is_held = true OR created_via = 'pos')
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'held_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'order.held_discarded', 'orders', p_order_id,
          jsonb_build_object('reason', p_reason, 'order_number', v_order_no, 'was_held', v_was_held));

  DELETE FROM orders WHERE id = p_order_id;  -- cascades order_items + held_order_idempotency_keys
END $function$;

REVOKE ALL ON FUNCTION public.discard_held_order_v2(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.discard_held_order_v2(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.discard_held_order_v2(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.discard_held_order_v2(uuid, text) TO service_role;
COMMENT ON FUNCTION public.discard_held_order_v2(uuid, text) IS
  'Caisse : abandon d''une commande en attente ou d''une commande POS non payée orpheline (jamais payée/voided ni B2B), motif >= 10 caractères, porte orders.void. v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid()).';

-- ---------------------------------------------------------------------------
-- recompute_recipe_cost_v1 -> v2  (créée AVANT recompute_all, qui l'appelle)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_recipe_cost_v2(p_product_id uuid, p_max_plausible numeric DEFAULT 5000000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_uid       UUID := auth.uid();
  v_has_lines BOOLEAN;
  v_old       NUMERIC;
  v_walk      JSONB;
  v_new       NUMERIC;
BEGIN
  IF v_uid IS NOT NULL AND NOT has_permission(v_uid, 'inventory.cost_correction') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id_required' USING ERRCODE = 'P0001';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM recipes r
     WHERE r.product_id = p_product_id AND r.is_active AND r.deleted_at IS NULL
  ) INTO v_has_lines;

  IF NOT v_has_lines THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false, 'reason', 'no_recipe');
  END IF;

  SELECT cost_price INTO v_old FROM products WHERE id = p_product_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false, 'reason', 'not_found');
  END IF;

  BEGIN
    v_walk := _calculate_recipe_cost_walk(p_product_id, 5, 1, ARRAY[]::UUID[]);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'walk_error', 'detail', SQLERRM);
  END;
  v_new := ROUND(COALESCE((v_walk->>'cost_per_unit')::NUMERIC, 0), 2);

  IF v_new <= 0 THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'zero_cost', 'new_cost', v_new);
  END IF;
  IF v_new > p_max_plausible THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'implausible_cost', 'new_cost', v_new, 'old_cost', v_old);
  END IF;
  IF v_old IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object('product_id', p_product_id, 'applied', false,
                              'reason', 'unchanged', 'new_cost', v_new);
  END IF;

  UPDATE products SET cost_price = v_new, updated_at = now() WHERE id = p_product_id;

  BEGIN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'product.cost_recomputed', 'products', p_product_id,
            jsonb_build_object('old_cost', v_old, 'new_cost', v_new, 'source', 'recipe_cost_walk'));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_recipe_cost_v2: audit failed for %: %', p_product_id, SQLERRM;
  END;

  RETURN jsonb_build_object('product_id', p_product_id, 'applied', true,
                            'old_cost', v_old, 'new_cost', v_new);
END $function$;

REVOKE ALL ON FUNCTION public.recompute_recipe_cost_v2(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_recipe_cost_v2(uuid, numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.recompute_recipe_cost_v2(uuid, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_recipe_cost_v2(uuid, numeric) TO service_role;
COMMENT ON FUNCTION public.recompute_recipe_cost_v2(uuid, numeric) IS
  'Recalcule cost_price d''un produit depuis sa recette (_calculate_recipe_cost_walk, plafond de plausibilité). Appelée par recompute_all_recipe_costs_v2 (cron sans contexte auth : actor NULL). v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() sous un appelant réel (v1 écrivait auth.uid()). La porte fail-open sur v_uid NULL est inchangée (hors lot).';

-- ---------------------------------------------------------------------------
-- recompute_all_recipe_costs_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recompute_all_recipe_costs_v2(p_max_plausible numeric DEFAULT 5000000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_uid          UUID := auth.uid();
  v_now          TIMESTAMPTZ := now();
  v_prod         RECORD;
  v_res          JSONB;
  v_checked      INT := 0;
  v_updated      INT := 0;
  v_zero         INT := 0;
  v_unchanged    INT := 0;
  v_errors       INT := 0;
  v_implausible  JSONB := '[]'::JSONB;
BEGIN
  IF v_uid IS NOT NULL AND NOT has_permission(v_uid, 'inventory.cost_correction') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  FOR v_prod IN
    SELECT p.id, p.name, p.sku
      FROM products p
     WHERE p.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM recipes r
                    WHERE r.product_id = p.id AND r.is_active AND r.deleted_at IS NULL)
     ORDER BY p.name
  LOOP
    v_checked := v_checked + 1;
    v_res := public.recompute_recipe_cost_v2(v_prod.id, p_max_plausible);

    IF (v_res->>'applied')::BOOLEAN THEN
      v_updated := v_updated + 1;
    ELSIF (v_res->>'reason') = 'zero_cost' THEN
      v_zero := v_zero + 1;
    ELSIF (v_res->>'reason') = 'unchanged' THEN
      v_unchanged := v_unchanged + 1;
    ELSIF (v_res->>'reason') = 'implausible_cost' THEN
      v_implausible := v_implausible || jsonb_build_object(
        'product_id', v_prod.id, 'name', v_prod.name, 'sku', v_prod.sku,
        'computed_cost', (v_res->>'new_cost')::NUMERIC);
    ELSIF (v_res->>'reason') = 'walk_error' THEN
      v_errors := v_errors + 1;
    END IF;
  END LOOP;

  v_res := jsonb_build_object(
    'checked',            v_checked,
    'updated',            v_updated,
    'unchanged',          v_unchanged,
    'skipped_zero_cost',  v_zero,
    'walk_errors',        v_errors,
    'implausible_count',  jsonb_array_length(v_implausible),
    'implausible',        v_implausible,
    'ran_at',             v_now
  );

  BEGIN
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (v_actor_profile, 'product.costs_recomputed_bulk', 'products', NULL,
            v_res - 'implausible');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'recompute_all_recipe_costs_v2: audit failed: %', SQLERRM;
  END;

  RETURN v_res;
END $function$;

REVOKE ALL ON FUNCTION public.recompute_all_recipe_costs_v2(numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recompute_all_recipe_costs_v2(numeric) FROM anon;
GRANT EXECUTE ON FUNCTION public.recompute_all_recipe_costs_v2(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_all_recipe_costs_v2(numeric) TO service_role;
COMMENT ON FUNCTION public.recompute_all_recipe_costs_v2(numeric) IS
  'Recalcule cost_price de tous les produits à recette active (cron recompute-recipe-costs-daily, 02:15 UTC, sans contexte auth : actor NULL). v2 (2026-09-06) : audit_logs.actor_id = user_profiles.id via _current_profile_id() sous un appelant réel (v1 écrivait auth.uid()). La porte fail-open sur v_uid NULL est inchangée (hors lot).';

-- ---------------------------------------------------------------------------
-- record_cash_wallet_movement_v1 -> v2
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_cash_wallet_movement_v2(p_movement_type text, p_amount numeric, p_movement_date date, p_remark text, p_idempotency_key uuid, p_wallet_code text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_profile UUID := _current_profile_id();  -- audit_logs.actor_id = user_profiles.id, jamais auth.uid()
  v_uid        UUID := auth.uid();
  v_existing   UUID;
  v_dr_key     TEXT;
  v_cr_key     TEXT;
  v_dr_acc     UUID;
  v_cr_acc     UUID;
  v_wallet_key TEXT;
  v_entry_no   TEXT;
  v_je_id      UUID;
  v_label      TEXT;
BEGIN
  -- Base permission gate (defense in depth on top of UI gate)
  IF NOT public.has_permission(v_uid, 'accounting.cash.write') THEN
    RAISE EXCEPTION 'permission_denied: accounting.cash.write required' USING ERRCODE = 'P0001';
  END IF;

  -- Stricter gate for adjustments + Boss withdrawal (spec §3/§6).
  IF p_movement_type IN ('adjustment_gain', 'adjustment_loss', 'boss_withdrawal') THEN
    IF NOT public.has_permission(v_uid, 'accounting.cash.adjust') THEN
      RAISE EXCEPTION 'permission_denied: accounting.cash.adjust required for %', p_movement_type
        USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;

  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  IF p_movement_type IN ('adjustment_gain', 'adjustment_loss') THEN
    v_wallet_key := CASE p_wallet_code
      WHEN '1110' THEN 'CASH_WALLET_UNDEPOSITED'
      WHEN '1111' THEN 'CASH_WALLET_PETTY'
      WHEN '1117' THEN 'CASH_WALLET_SMALL_MONEY'
      ELSE NULL END;
    IF v_wallet_key IS NULL THEN
      RAISE EXCEPTION 'adjustment requires p_wallet_code in (1110,1111,1117)' USING ERRCODE = 'P0001';
    END IF;
    IF p_remark IS NULL OR length(trim(p_remark)) = 0 THEN
      RAISE EXCEPTION 'adjustment requires a remark (reason)' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  SELECT dr, cr, lbl INTO v_dr_key, v_cr_key, v_label FROM (VALUES
    ('undepo_to_petty',  'CASH_WALLET_PETTY',          'CASH_WALLET_UNDEPOSITED',     'Transfer Undeposited → Petty Cash'),
    ('petty_to_undepo',  'CASH_WALLET_UNDEPOSITED',    'CASH_WALLET_PETTY',           'Transfer Petty Cash → Undeposited'),
    ('bank_deposit',     'CASH_BANK_OPERATING',        'CASH_WALLET_UNDEPOSITED',     'Bank deposit'),
    ('boss_withdrawal',  'OWNER_DRAWING',              'CASH_WALLET_UNDEPOSITED',     'Boss withdrawal'),
    ('small_money_lend', 'CASH_WALLET_UNDEPOSITED',    'CASH_WALLET_SMALL_MONEY',     'Small Money lends to Undeposited'),
    ('small_money_repay','CASH_WALLET_SMALL_MONEY',    'CASH_WALLET_UNDEPOSITED',     'Repay Small Money'),
    ('adjustment_gain',  v_wallet_key,                 'SHIFT_CASH_VARIANCE_INCOME',  'Cash count overage'),
    ('adjustment_loss',  'SHIFT_CASH_VARIANCE_EXPENSE', v_wallet_key,                 'Cash count shortage')
  ) AS m(mt, dr, cr, lbl) WHERE m.mt = p_movement_type;

  IF v_dr_key IS NULL OR v_cr_key IS NULL THEN
    RAISE EXCEPTION 'unknown movement_type: %', p_movement_type USING ERRCODE = 'P0001';
  END IF;

  PERFORM check_fiscal_period_open(p_movement_date);

  v_dr_acc := resolve_mapping_account(v_dr_key);
  v_cr_acc := resolve_mapping_account(v_cr_key);
  v_entry_no := next_journal_entry_number(p_movement_date);

  INSERT INTO journal_entries (
    entry_number, entry_date, description, reference_type, reference_id,
    status, total_debit, total_credit, created_by
  ) VALUES (
    v_entry_no, p_movement_date,
    v_label || COALESCE(' — ' || left(p_remark, 80), ''),
    'cash_movement', p_idempotency_key,
    'posted', p_amount, p_amount, v_actor_profile
  ) RETURNING id INTO v_je_id;

  INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
    (v_je_id, v_dr_acc, p_amount, 0, COALESCE(p_remark, v_label)),
    (v_je_id, v_cr_acc, 0, p_amount, COALESCE(p_remark, v_label));

  INSERT INTO cash_movement_idempotency_keys (idempotency_key, je_id)
    VALUES (p_idempotency_key, v_je_id);

  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (v_actor_profile, 'cash.wallet_movement', 'journal_entries', v_je_id,
          jsonb_build_object('movement_type', p_movement_type, 'amount', p_amount,
                             'date', p_movement_date, 'remark', p_remark));

  RETURN v_je_id;
EXCEPTION WHEN unique_violation THEN
  SELECT je_id INTO v_existing FROM cash_movement_idempotency_keys
    WHERE idempotency_key = p_idempotency_key;
  RETURN v_existing;
END $function$;

REVOKE ALL ON FUNCTION public.record_cash_wallet_movement_v2(text, numeric, date, text, uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_cash_wallet_movement_v2(text, numeric, date, text, uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_cash_wallet_movement_v2(text, numeric, date, text, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_wallet_movement_v2(text, numeric, date, text, uuid, text) TO service_role;
COMMENT ON FUNCTION public.record_cash_wallet_movement_v2(text, numeric, date, text, uuid, text) IS
  'Coffres : poste une JE équilibrée pour un mouvement de coffre (Undeposited / Petty / Small Money), idempotente sur p_idempotency_key, portes accounting.cash.write (+ accounting.cash.adjust), période fiscale gardée. Distincte de record_cash_movement (mouvement de session). v2 (2026-09-06) : journal_entries.created_by et audit_logs.actor_id = user_profiles.id via _current_profile_id() (v1 écrivait auth.uid(), 23503 sur le chemin d''argent pour tout compte créé par le back-office).';

-- ---------------------------------------------------------------------------
-- Anciennes versions droppées (versioning monotone)
-- ---------------------------------------------------------------------------
DROP FUNCTION public.add_order_item_v5(uuid, uuid, integer, jsonb, uuid);
DROP FUNCTION public.remove_order_item_v3(uuid, uuid);
DROP FUNCTION public.update_order_item_qty_v5(uuid, integer, uuid, uuid, numeric, text);
DROP FUNCTION public.discard_held_order_v1(uuid, text);
DROP FUNCTION public.recompute_all_recipe_costs_v1(numeric);
DROP FUNCTION public.recompute_recipe_cost_v1(uuid, numeric);
DROP FUNCTION public.record_cash_wallet_movement_v1(text, numeric, date, text, uuid, text);

-- ---------------------------------------------------------------------------
-- Cron nocturne repointé sur v2 (miroir 20260630000023)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  PERFORM cron.unschedule('recompute-recipe-costs-daily');
EXCEPTION WHEN OTHERS THEN
  NULL;
END$$;

SELECT cron.schedule(
  'recompute-recipe-costs-daily',
  '15 2 * * *',  -- 02:15 UTC daily, just after the margins job
  $cron$SELECT public.recompute_all_recipe_costs_v2();$cron$
);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
