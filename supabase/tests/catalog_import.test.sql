-- supabase/tests/catalog_import.test.sql
-- S41 -- pgTAP suite for import_catalog_v2 / export_catalog_v1 (T1-T24).
-- Run via MCP execute_sql wrapped in BEGIN/ROLLBACK -- self-cleaning.
--
-- Lot 1.B (2026-08-03) — l'acteur des imports/exports passe de MANAGER à
-- SUPER_ADMIN : ADR-011 décision 1 a retiré `catalog.import` au MANAGER (le
-- payload d'import crée des variantes, que `products.variants.write` réserve
-- déjà à ADMIN+). La suite épinglait l'ancien périmètre et tombait en
-- « permission denied: catalog.import required » dès la 2ᵉ assertion.
-- T1b ajouté : le refus opposé au MANAGER est désormais testé pour lui-même,
-- sans quoi rien ne garderait la décision contre un re-seed distrait.
--
-- Covers:
--   T1  : CASHIER import -> 42501
--   T2  : ADMIN+ dry-run -> valid=true
--   T3  : dry-run writes nothing (product count unchanged)
--   T4  : commit -> ingredient hidden from POS
--   T5  : commit -> variant linked to parent
--   T6  : commit -> unit alternative created
--   T7  : commit -> BOM created (2 lines for S41-DOUGH)
--   T8  : replay same key -> idempotent_replay=true
--   T9  : upsert -> price updated
--   T10 : upsert -> BOM fully replaced (1 line)
--   T11 : unknown material -> valid=false + error code
--   T12 : cycle -> recipe_cycle detected
--   T13 : commit without key -> P0001
--   T14 : export CASHIER -> 42501
--   T15 : export ADMIN+ -> shape + S41 SKUs presents
--   T16 : BOM re-import -> recipe_versions +1 (trigger tr_recipes_snapshot_version)
--   T17 : sku_is_variant_in_db (S41-CROIS-ALM en feuille products -> erreur)
--   T18 : sku_is_standalone_in_db (S41-CROIS en feuille variants -> erreur)
--   T19 : REPLACE units -- g soft-deleted apres remplacement par sachet
--   T20 : REPLACE units -- sachet actif (deleted_at IS NULL)
--   T21 : invalid_context_unit -- recipe_unit='ghost' invalide
--   T22 : audit_logs row catalog.imported apres commit
--   T23 : T15 renforce -- dry-run S41-only valid=true
--   T24 : T15 renforce -- dry-run S41-only products.create=0
--
-- Seeded users:
--   MANAGER : auth_user_id = 00000000-0000-0000-0000-000000000004 (refuse a l'import, ADR-011)
--   SUPER_ADMIN : auth_user_id = 00000000-0000-0000-0000-000000000001
--   CASHIER : auth_user_id = 00000000-0000-0000-0000-000000000002

BEGIN;
\ir helpers/catalog_import_cases_01.sql
\ir helpers/catalog_import_cases_02.sql
ROLLBACK;
