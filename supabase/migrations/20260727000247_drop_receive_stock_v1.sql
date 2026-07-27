-- 20260727000247_drop_receive_stock_v1.sql
--
-- Audit stock 2026-07-27 (Q3, décision Mamat) : receive_stock_v1 est droppée.
--
-- Motif : trois voies de réception coexistaient avec des traitements
-- comptables incohérents —
--   1. receive_purchase_order_v2 (PO/GRN)  : stock + WAC + JE   ← seule voie complète
--   2. receive_stock_v1 (type 'purchase')  : stock + WAC, AUCUN JE (pas de GRN)
--      → actif inventaire au GL jamais contrebalancé (DR sans CR fournisseur)
--   3. record_incoming_stock_v1 ('incoming') : ni WAC ni JE — CONSERVÉE pour
--      les entrées non-achat (stock initial d'un site migré, convention m10)
--
-- La réception valorisée passe désormais exclusivement par le flux PO /
-- achat direct compté (page /backoffice/inventory/incoming = DirectPurchaseForm,
-- qui enchaîne create_purchase_order_v2 → receive_purchase_order_v2 →
-- record_po_payment_v1). Côté BO, ReceiveModal + useReceiveStock sont retirés
-- dans le même commit ; le bouton « Receive » navigue vers l'achat compté.
--
-- Signature exacte relevée sur le live (pg_get_function_identity_arguments).
-- Pas de _vN+1 : c'est un retrait, pas un bump.

DROP FUNCTION IF EXISTS public.receive_stock_v1(
  p_product_id uuid,
  p_quantity numeric,
  p_supplier_id uuid,
  p_unit_cost numeric,
  p_reason text,
  p_idempotency_key uuid
);
