-- 20260727000248_adr008_d4_permission_force_negative.sql
--
-- ADR-008 D4 — Production à stock insuffisant : blocage par défaut.
--
-- Étape 1/3 : la permission dédiée qui autorise le forçage.
--
-- Le réglage global `business_config.allow_negative_stock` continue de gouverner
-- la VENTE (POS / B2B) ; il ne gouverne plus la PRODUCTION. Côté production, le
-- passage en stock négatif redevient un acte volontaire, tracé, réservé aux
-- rôles ADMIN et SUPER_ADMIN — même périmètre que `inventory.production.delete`
-- (revert), l'autre opération production capable de fausser stock et compta.

INSERT INTO permissions (code, module, action, description)
VALUES (
  'inventory.production.force_negative',
  'inventory',
  'create',
  'Force a production despite insufficient raw material stock (ADR-008 D4) — ADMIN+'
)
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_code, permission_code, is_granted)
VALUES
  ('SUPER_ADMIN', 'inventory.production.force_negative', TRUE),
  ('ADMIN',       'inventory.production.force_negative', TRUE)
ON CONFLICT (role_code, permission_code) DO NOTHING;
