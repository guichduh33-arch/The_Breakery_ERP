-- 20260601000005_extend_order_type_enum_b2b.sql
-- Session 24 / Phase 1.A.1 / migration 1
--
-- Étend l'enum order_type avec 'b2b' pour différencier les commandes wholesale
-- (créées via create_b2b_order_v1, status='b2b_pending', session_id NULL).
--
-- ALTER TYPE ADD VALUE doit vivre dans sa propre transaction — la nouvelle
-- valeur ne peut pas être utilisée dans la même TX qu'elle est créée. Le
-- wrapper apply_migration isole chaque fichier dans sa TX, donc OK.

ALTER TYPE order_type ADD VALUE IF NOT EXISTS 'b2b';

COMMENT ON TYPE order_type IS
  'Types de commandes : dine_in, take_out, delivery (POS) ; b2b (wholesale, S24).';
