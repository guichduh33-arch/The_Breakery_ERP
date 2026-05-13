-- 20260516000014_extend_movement_type_enum.sql
-- Session 12 / Phase 1 (complete) / migration 3 :
--   Étendre l'enum movement_type avec les valeurs nécessaires pour les 7 onglets
--   du module Inventory (cf. INVENTORY.md §§5-9, et spec session 12 complete §C3).
--
-- Note Postgres : ALTER TYPE ... ADD VALUE est autorisé dans une transaction
--   depuis Postgres 12 si les nouvelles valeurs ne sont pas utilisées dans la
--   même transaction. Cette migration ne fait QUE l'ALTER — l'usage viendra
--   dans les migrations suivantes (Phase 2, 3, 4, 5...).
--
-- Valeurs existantes (session 1) : 'sale', 'sale_void', 'production', 'purchase',
--   'waste', 'adjustment'.
--
-- Décision : on conserve 'adjustment' (sans direction) pour la rétro-compatibilité
--   avec adjust_stock_v1 MVP (qui émet quantity signée). On ajoute néanmoins
--   adjustment_in / adjustment_out pour les cas où le sens est explicitement
--   séparé (utilisé par opname finalize qui émet 1 mouvement par variance signée).
--   Les triggers JE distinguent les types ; les nouvelles RPCs émettront les
--   types directionnels quand pertinent.
--
-- Idem 'production' (legacy session 1, sans direction) → on ajoute
-- production_in / production_out pour le module Production qui distingue
-- entrée produit fini et sortie matière première.

ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'transfer_in';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'transfer_out';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'production_in';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'production_out';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'adjustment_in';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'adjustment_out';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'opname_in';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'opname_out';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'incoming';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'purchase_return';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'reservation_hold';
ALTER TYPE movement_type ADD VALUE IF NOT EXISTS 'reservation_release';

COMMENT ON TYPE movement_type IS
  'Type de mouvement de stock (étendu Phase 1 complete). '
  'Legacy : sale, sale_void, production, purchase, waste, adjustment. '
  'Phase 1 ajout : transfer_in/out (transferts inter-sections), production_in/out '
  '(production avec déduction recipe), adjustment_in/out (opname variance signée), '
  'opname_in/out (idem), incoming (réception sans PO formel), purchase_return '
  '(retour fournisseur — utilisé par module Purchasing complete), '
  'reservation_hold/release (pour B2B futur — non utilisé MVP).';
