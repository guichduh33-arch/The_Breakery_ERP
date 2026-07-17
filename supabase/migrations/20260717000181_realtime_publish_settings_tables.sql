-- Settings §6.C — propagation Realtime des settings (ADR-006 décision 4).
--
-- Ajoute à la publication `supabase_realtime` les deux tables de configuration
-- consommées en live par les appareils POS (caisse, KDS, customer display,
-- tablette) pour permettre les subscriptions postgres_changes du hook
-- useSettingsRealtime (apps/pos) :
--   - business_config      (socle scalaire : taxe, paiements, printing,
--                           display, seuils KDS, presets POS)
--   - receipt_templates    (template de reçu par défaut, imprimé par le POS)
--
-- Aucun changement de schéma ni d'ACL : la RLS SELECT existante
-- (business_config.auth_read ; receipt_templates lu par le POS) gouverne qui
-- reçoit les événements — anon ne lit rien, donc ne reçoit rien. [types-noop]
ALTER PUBLICATION supabase_realtime ADD TABLE public.business_config;
ALTER PUBLICATION supabase_realtime ADD TABLE public.receipt_templates;
