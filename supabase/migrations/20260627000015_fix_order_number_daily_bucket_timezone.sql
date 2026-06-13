-- 20260627000015_fix_order_number_daily_bucket_timezone.sql
-- S43 Wave F corrective (DEV-S43-F1-02) — découvert par l'E2E T3 (fire 409 après
-- minuit locale).
--
-- La corrective _012 bucketait l'unicité par jour UTC en affirmant « le bucket
-- UTC matche le CURRENT_DATE du serveur » — FAUX : la base tourne en
-- Asia/Makassar (+08). order_sequences reset à minuit LOCALE (CURRENT_DATE),
-- donc entre 00:00 et 08:00 locale les nouveaux numéros (#0001, #0002, …)
-- retombent dans le bucket UTC de la veille au soir → 23505 sur la première
-- commande de la nuit (observé en réel : fire_counter_order_v1 → 409 PostgREST).
--
-- Fix : bucket = même jour LOCAL que le reset de séquence.
-- timezone(text, timestamptz) est IMMUTABLE (même forme que _012, acceptée en
-- expression d'index). Vérifié avant apply : zéro doublon (order_number, jour
-- Asia/Makassar) existant.
DROP INDEX public.orders_order_number_per_day_key;
CREATE UNIQUE INDEX orders_order_number_per_day_key
  ON public.orders (order_number, ((timezone('Asia/Makassar', created_at))::date));
