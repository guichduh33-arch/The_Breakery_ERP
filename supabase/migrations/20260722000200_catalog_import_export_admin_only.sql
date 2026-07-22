-- 20260722000200 — Import/export catalogue réservé ADMIN+ (ADR-011 déc. 1).
--
-- L'audit products du 2026-07-22 a montré que import_catalog_v1 (gate
-- catalog.import, seedé MANAGER par _000013 S41) permet de créer/modifier des
-- VARIANTES via le payload, alors que products.variants.write est réservé
-- ADMIN/SUPER_ADMIN. Décision : retrait de catalog.import ET catalog.export au
-- rôle MANAGER — l'import/export devient ADMIN+ dans son intégralité.
--
-- Pas de bump RPC (le gate has_permission reste inchangé), pas de changement
-- de schéma (types-noop). L'UI BO est déjà pilotée par ces permissions
-- (bouton Import + route import-export).

DELETE FROM role_permissions
 WHERE role_code = 'MANAGER'
   AND permission_code IN ('catalog.import', 'catalog.export');
