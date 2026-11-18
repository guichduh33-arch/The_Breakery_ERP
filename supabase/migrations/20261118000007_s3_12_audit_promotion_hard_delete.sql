-- S3-12 — Auditer la suppression physique d'une promotion.
-- Le déclencheur audit_promotion_changes couvre INSERT et UPDATE ; la
-- suppression logique a son audit dans la famille delete_promotion. Une
-- suppression PHYSIQUE (service_role, migration, SQL direct) ne laissait
-- aucune trace. Un déclencheur AFTER DELETE séparé : la clause WHEN du
-- déclencheur existant lit NEW, interdite sur DELETE.
-- La fonction audit_business_row_change_v1 gère déjà DELETE : action
-- `promotion.delete`, payload {before: OLD, after: null}, actor_id résolu
-- par get_current_profile_id() (un user_profiles.id, NULL hors session).
-- deleted_at figure dans la liste : le before dit si la ligne était déjà
-- supprimée logiquement.
CREATE TRIGGER audit_promotion_hard_delete AFTER DELETE ON public.promotions
FOR EACH ROW
EXECUTE FUNCTION public.audit_business_row_change_v1('promotion',
  'id,name,slug,description,type,scope,discount_value,max_discount_amount,scope_product_ids,scope_category_ids,bogo_trigger_product_ids,bogo_reward_product_ids,bogo_trigger_qty,bogo_reward_qty,bogo_reward_discount_pct,gift_product_id,gift_qty,min_items_total,customer_category_ids,customer_tier_ids,start_at,end_at,day_of_week_mask,start_hour,end_hour,priority,stackable_with_promo,stackable_with_manual,is_active,bogo_buy_quantity,bogo_get_quantity,bogo_get_product_id,threshold_amount,threshold_type,bundle_product_ids,bundle_price,max_uses,max_uses_per_customer,deleted_at');
