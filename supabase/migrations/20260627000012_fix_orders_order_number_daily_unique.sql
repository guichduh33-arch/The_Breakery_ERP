-- 20260627000012_fix_orders_order_number_daily_unique.sql
-- S43 Wave C corrective (DEV-S43-C1-01) — découvert par le pgTAP de fire_counter_order_v1.
--
-- Bug latent PARTAGÉ : complete_order_with_payment_v11, create_tablet_order_v2 et
-- fire_counter_order_v1 génèrent tous `'#' || LPAD(seq, 4, '0')` depuis order_sequences,
-- qui RESET à 1 chaque jour (INSERT VALUES (CURRENT_DATE, 1) ON CONFLICT(date) ...).
-- Or orders.order_number portait un UNIQUE GLOBAL → la PREMIÈRE commande de chaque
-- nouvelle journée lève 23505 dès qu'un '#0001' existe d'un jour précédent.
-- (Invisible jusqu'ici : les données de test des jours antérieurs avaient été purgées
-- par le cleanup m4 du Stock Audit ; le passage au 2026-06-13 l'a réveillé.)
--
-- Fix conforme à l'intention du design (numéro de reçu quotidien) : unicité par
-- (order_number, jour UTC). timezone('UTC', created_at) est IMMUTABLE et le bucket
-- UTC matche le CURRENT_DATE du serveur (reset de order_sequences).
-- Vérifié avant apply : zéro doublon (order_number, jour) existant.
ALTER TABLE public.orders DROP CONSTRAINT orders_order_number_key;
CREATE UNIQUE INDEX orders_order_number_per_day_key
  ON public.orders (order_number, ((timezone('UTC', created_at))::date));
