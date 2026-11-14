-- S1-09 et S1-12 — la vente directe plafonne la remise de ligne et fait
-- évaluer les promotions aux prix du serveur.
--
-- Deux défauts, tous deux dans le corps privé de la famille
-- `complete_order_with_payment` (relevé du 2026-11-14 sur le corps live) :
--
--   S1-09 — la remise de ligne (`discount_amount` de chaque article) était un
--   montant libre : ni borne basse, ni plafond. Elle est désormais refusée si
--   elle est négative ou si elle dépasse le sous-total serveur de SA ligne.
--
--   S1-12 — les articles passés au moteur de promotions portaient le prix
--   unitaire ENVOYÉ PAR LA CAISSE. Une promotion ciblée produit, catégorie ou
--   lot calculait donc sa remise sur ce prix, et le contrôle de cohérence
--   comparait deux valeurs issues du même prix client. Les articles sont
--   maintenant construits dans la boucle de résolution des prix, au prix
--   unitaire résolu par le serveur — la même base que le sous-total déjà
--   passé au moteur.
--
-- Non modifiés, vérifiés le même jour :
--   - la famille `pay_existing_order` évalue les promotions depuis
--     `order_items`, dont les prix sont déjà ceux du serveur ;
--   - la famille `fire_counter_order` borne déjà la remise de ligne ;
--   - la famille `evaluate_promotions` garde son contrat : son appel direct par
--     la caisse ne sert qu'à l'aperçu, la porte d'argent est ici.
--
-- Méthode : le corps fait ~43 Ko. Il n'est pas recopié. Le bloc ci-dessous lit
-- la définition live, la normalise (retours chariot et espaces de fin de
-- ligne, seule différence entre dev et production), vérifie son empreinte,
-- applique des substitutions COMPTÉES — chacune échoue si son nombre
-- d'occurrences n'est pas celui attendu — puis vérifie l'empreinte du
-- résultat. La migration est donc une fonction pure d'une entrée épinglée.

DO $mig$
DECLARE
  c_src_md5  CONSTANT text := 'dcf1ae89cbaddd6ecf476f28bdcf1189';
  c_new_md5  CONSTANT text := 'd96b57d73339e0fd5e5a926e2f558f99';
  v_src      text;
  v_new      text;
  v_old      text;
  v_n        int;
BEGIN
  SELECT regexp_replace(replace(pg_get_functiondef(p.oid), E'\r', ''), '[ \t]+\n', E'\n', 'g')
    INTO v_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'stock_private' AND p.proname = 'complete_order_with_payment_v30';
  IF v_src IS NULL THEN
    RAISE EXCEPTION 'payment_bump: stock_private.complete_order_with_payment_v30 not found';
  END IF;
  IF md5(v_src) <> c_src_md5 THEN
    RAISE EXCEPTION 'payment_bump: live body drifted (md5 %, expected %)', md5(v_src), c_src_md5;
  END IF;
  v_new := v_src;

  -- 1. Nom de la fonction.
  v_old := 'FUNCTION stock_private.complete_order_with_payment_v30(';
  v_n := (length(v_new) - length(replace(v_new, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN RAISE EXCEPTION 'payment_bump: substitution 1 expects 1 occurrence, found %', v_n; END IF;
  v_new := replace(v_new, v_old, 'FUNCTION stock_private.complete_order_with_payment_v33(');

  -- 2. Marque de version écrite dans le journal d'audit.
  v_old := 'v29-recipe-units';
  v_n := (length(v_new) - length(replace(v_new, v_old, ''))) / length(v_old);
  IF v_n <> 3 THEN RAISE EXCEPTION 'payment_bump: substitution 2 expects 3 occurrences, found %', v_n; END IF;
  v_new := replace(v_new, v_old, 'v33-line-discount-cap');

  -- 3. S1-09 : borne de la remise de ligne. S1-12 : article d'évaluation au
  --    prix serveur. Les deux se posent à la fin de la boucle de résolution
  --    des prix, point commun aux lignes simples et aux combos.
  v_old := 'IF v_line_discount > 0 THEN       v_has_discount := true;     END IF;';
  v_n := (length(v_new) - length(replace(v_new, v_old, ''))) / length(v_old);
  IF v_n <> 1 THEN RAISE EXCEPTION 'payment_bump: substitution 3 expects 1 occurrence, found %', v_n; END IF;
  v_new := replace(v_new, v_old, $sub$-- S1-09 : la remise de ligne ne sort pas de [0, sous-total serveur de la ligne].
    IF v_line_discount < 0 OR v_line_discount > v_srv_line_subtotal THEN
      RAISE EXCEPTION 'line_discount_out_of_range: product % (discount %, line subtotal %)',
        v_product.id, v_line_discount, v_srv_line_subtotal
        USING ERRCODE = 'check_violation';
    END IF;
    -- S1-12 : le moteur de promotions recoit le prix unitaire resolu par le
    -- serveur, jamais celui envoye par la caisse.
    IF NOT v_item_is_gift THEN
      v_eval_items := COALESCE(v_eval_items, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'product_id', v_product.id,
        'quantity',   v_quantity,
        'unit_price', v_srv_unit_price));
    END IF;
    IF v_line_discount > 0 THEN       v_has_discount := true;     END IF;$sub$);

  -- 4. S1-12 : retrait de la construction des articles depuis le prix client.
  v_old := $re$SELECT COALESCE\(jsonb_agg\(jsonb_build_object\(\s+'product_id', item->>'product_id',\s+'quantity',\s+\(item->>'quantity'\)::numeric,\s+'unit_price', \(item->>'unit_price'\)::numeric\)\), '\[\]'::jsonb\)\s+INTO v_eval_items\s+FROM jsonb_array_elements\(p_items\) AS item\s+WHERE COALESCE\(\(item->>'is_promo_gift'\)::boolean, false\) = false;$re$;
  v_n := regexp_count(v_new, v_old);
  IF v_n <> 1 THEN RAISE EXCEPTION 'payment_bump: substitution 4 expects 1 occurrence, found %', v_n; END IF;
  v_new := regexp_replace(v_new, v_old,
    '-- S1-12 : v_eval_items est construit dans la boucle de resolution des prix.');

  IF md5(v_new) <> c_new_md5 THEN
    RAISE EXCEPTION 'payment_bump: result md5 %, expected %', md5(v_new), c_new_md5;
  END IF;
  EXECUTE v_new;
END
$mig$;

REVOKE ALL ON FUNCTION stock_private.complete_order_with_payment_v33(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Façade publique : même contrat que la version précédente, corps identique
-- au nom du corps privé près.
CREATE FUNCTION public.complete_order_with_payment_v33(p_session_id uuid, p_order_type order_type, p_items jsonb, p_payment jsonb DEFAULT NULL::jsonb, p_idempotency_key uuid DEFAULT NULL::uuid, p_customer_id uuid DEFAULT NULL::uuid, p_loyalty_points_redeemed integer DEFAULT 0, p_table_number text DEFAULT NULL::text, p_discount_amount numeric DEFAULT 0, p_discount_type text DEFAULT NULL::text, p_discount_value numeric DEFAULT NULL::numeric, p_discount_reason text DEFAULT NULL::text, p_discount_authorized_by uuid DEFAULT NULL::uuid, p_promotions jsonb DEFAULT '[]'::jsonb, p_payments jsonb DEFAULT NULL::jsonb, p_discount_auth_id uuid DEFAULT NULL::uuid, p_source_code text DEFAULT 'P'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 RETURN stock_private.mask_stock_payload(stock_private.complete_order_with_payment_v33(p_session_id,p_order_type,p_items,p_payment,p_idempotency_key,p_customer_id,p_loyalty_points_redeemed,p_table_number,p_discount_amount,p_discount_type,p_discount_value,p_discount_reason,p_discount_authorized_by,p_promotions,p_payments,p_discount_auth_id,p_source_code));
EXCEPTION WHEN OTHERS THEN
 IF NOT public.can_view_business_day_v2(current_date) AND SQLSTATE='P0002'
    AND SQLERRM ~* '(insufficient.*stock|have )'
 THEN RAISE EXCEPTION 'insufficient_stock' USING ERRCODE='P0002'; END IF;
 RAISE;
END $function$;

COMMENT ON FUNCTION public.complete_order_with_payment_v33(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text) IS
  'Vente directe du POS, appelée par l''EF process-payment. S1-09 : remise de ligne bornée au sous-total serveur de la ligne. S1-12 : promotions évaluées aux prix du serveur.';

REVOKE ALL ON FUNCTION public.complete_order_with_payment_v33(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_order_with_payment_v33(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text)
  TO authenticated, service_role;

DROP FUNCTION public.complete_order_with_payment_v32(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text);
DROP FUNCTION stock_private.complete_order_with_payment_v30(uuid, order_type, jsonb, jsonb, uuid, uuid, integer, text, numeric, text, numeric, text, uuid, jsonb, jsonb, uuid, text);

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
