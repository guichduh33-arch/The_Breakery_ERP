-- 20260626000013_enforce_section_stock_balance.sql
-- Audit 2026-06-12 M2 : transferts acceptés depuis une section vide →
-- section_stock négatif (7 lignes constatées). 2 volets :
--   1. Data fix : remise à zéro des soldes négatifs (cache, pas ledger) + trace audit.
--   2. Garde RPC : create_internal_transfer_v1 (branche send_directly) et
--      receive_internal_transfer_v1 vérifient le solde source AVANT d'émettre
--      les mouvements (FOR UPDATE pour sérialiser les transferts concurrents).
-- Volet 3 (CHECK quantity >= 0) du plan VOLONTAIREMENT OMIS — déviation actée :
-- les flux production_out/waste/adjustment légitimes décrémentent des sections
-- jamais seedées en stock initial (les 6 négatifs Pastry Kitchen en sont la
-- preuve) ; la contrainte casserait la production. Cf. plan Task B4 ⚠️ et
-- finding m10 (seed du stock initial par section = convention à documenter D2).

-- 1. Data fix + trace (actor = profil SYSTEM seedé par _010).
INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
SELECT '00000000-0000-0000-0000-000000000999', 'section_stock.negative_reset',
       'section_stock', ss.section_id,
       jsonb_build_object('product_id', ss.product_id, 'was', ss.quantity,
                          'source', 'audit-2026-06-12 M2 data fix')
FROM section_stock ss WHERE ss.quantity < 0;

UPDATE section_stock SET quantity = 0, updated_at = now() WHERE quantity < 0;

-- 2a. Garde dans create_internal_transfer_v1 (chemin direct-receive).
--     Pattern corrective S38 : DO-block pg_get_functiondef + replace,
--     signature inchangée, ACL conservées.
DO $do$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.create_internal_transfer_v1'::regproc) INTO v_def;
  IF position('insufficient_section_stock' in v_def) > 0 THEN
    RETURN;  -- déjà appliqué (idempotent)
  END IF;
  v_def := replace(v_def,
$anchor$  IF p_send_directly THEN
    FOR v_item_id, v_pid, v_qty, v_item_unit IN$anchor$,
$new$  IF p_send_directly THEN
    DECLARE
      v_avail DECIMAL(14,3);
      v_chk   RECORD;
    BEGIN
      FOR v_chk IN SELECT product_id, quantity_requested AS qty
                     FROM transfer_items WHERE transfer_id = v_transfer_id LOOP
        SELECT quantity INTO v_avail FROM section_stock
         WHERE section_id = p_from_section_id AND product_id = v_chk.product_id
         FOR UPDATE;
        IF COALESCE(v_avail, 0) < v_chk.qty THEN
          RAISE EXCEPTION 'insufficient_section_stock' USING ERRCODE='P0001',
            DETAIL = json_build_object('product_id', v_chk.product_id,
              'available', COALESCE(v_avail,0), 'requested', v_chk.qty)::text;
        END IF;
      END LOOP;
    END;
    FOR v_item_id, v_pid, v_qty, v_item_unit IN$new$);
  EXECUTE v_def;
END $do$;

-- 2b. Garde dans receive_internal_transfer_v1 (chemin pending → received).
DO $do$
DECLARE
  v_def TEXT;
BEGIN
  SELECT pg_get_functiondef('public.receive_internal_transfer_v1'::regproc) INTO v_def;
  IF position('insufficient_section_stock' in v_def) > 0 THEN
    RETURN;  -- déjà appliqué (idempotent)
  END IF;
  v_def := replace(v_def,
$anchor$  FOR v_item_id, v_pid, v_qty_received, v_item_unit IN$anchor$,
$new$  DECLARE
    v_avail DECIMAL(14,3);
    v_chk   RECORD;
  BEGIN
    FOR v_chk IN SELECT product_id, quantity_received AS qty FROM transfer_items
       WHERE transfer_id = p_transfer_id AND quantity_received IS NOT NULL AND quantity_received > 0 LOOP
      SELECT quantity INTO v_avail FROM section_stock
       WHERE section_id = v_from AND product_id = v_chk.product_id FOR UPDATE;
      IF COALESCE(v_avail, 0) < v_chk.qty THEN
        RAISE EXCEPTION 'insufficient_section_stock' USING ERRCODE='P0001',
          DETAIL = json_build_object('product_id', v_chk.product_id,
            'available', COALESCE(v_avail,0), 'requested', v_chk.qty)::text;
      END IF;
    END LOOP;
  END;
  FOR v_item_id, v_pid, v_qty_received, v_item_unit IN$new$);
  EXECUTE v_def;
END $do$;
