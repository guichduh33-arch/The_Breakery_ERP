-- 20260822000001_realtime_publish_order_items.sql
--
-- Audit POS Waiter du 2026-08-22, lot A — le retour cuisine → salle ne pouvait
-- pas fonctionner.
--
-- `order_items` n'appartenait à AUCUNE publication. Trois hooks s'y abonnaient
-- pourtant en `postgres_changes` :
--
--   · useTabletOrderStatusListener — toast « Item ready » côté serveuse.
--     Aucun filet de rafraîchissement : la fonctionnalité était entièrement
--     morte, pas seulement lente.
--   · useKdsRealtime — sauvé par le refetchInterval de 30 s de useKdsOrders.
--   · usePickedUpOrderSync — sauvé par son propre setInterval de 20 s.
--
-- Les deux derniers masquaient la panne : la cuisine avançait quand même, avec
-- une latence qu'on prenait pour la normale. Seule la salle payait plein tarif.
--
-- Les tests ne pouvaient pas l'attraper : ils remplacent le client Supabase par
-- un faux et rejouent le callback à la main. Ils vérifient la logique de tri et
-- de déduplication, jamais le transport. Le filet correspondant est un test qui
-- interroge `pg_publication_tables` — il vit dans le lot E de l'audit.
--
-- REPLICA IDENTITY — inchangée, volontairement. `order_items` est en `default`
-- (clé primaire), exactement comme `orders`, dont le realtime fonctionne depuis
-- 20260618000022. Un UPDATE écrit toutes les NOUVELLES valeurs dans le WAL : le
-- filtre `kitchen_status=eq.ready` et la lecture de `payload.new.name_snapshot`
-- sont donc servis. Seul `old_record` reste réduit à la PK, et aucun abonné ne
-- le lit. Passer en FULL doublerait le volume WAL sans rien apporter.
--
-- RLS — la publication ne contourne rien. Realtime applique les politiques de
-- lecture ; `order_items` porte `auth_read` (is_authenticated OR has_kiosk_jwt).
-- Le tri par serveuse reste fait côté client, comme avant.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
     WHERE pubname = 'supabase_realtime'
       AND schemaname = 'public'
       AND tablename = 'order_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.order_items;
  END IF;
END $$;
