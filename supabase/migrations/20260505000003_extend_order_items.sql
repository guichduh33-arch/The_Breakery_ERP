-- 20260505000003_extend_order_items.sql
-- Session 2 / migration 3 : modifiers JSONB + état KDS + verrou send-to-kitchen
--
-- K2: status flow item = pending → preparing → ready (3 statuts)
-- K3: send-to-kitchen incrémental (peut envoyer un batch puis ajouter d'autres items)
-- D9: ready_at pour archivage queue locale 5 min après ready
-- D10: is_locked = true → cancel/edit interdit en v1

ALTER TABLE order_items
  ADD COLUMN modifiers          JSONB         NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN modifiers_total    DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN kitchen_status     TEXT          NOT NULL DEFAULT 'pending'
    CHECK (kitchen_status IN ('pending', 'preparing', 'ready')),
  ADD COLUMN dispatch_station   TEXT,                            -- copié de la catégorie au INSERT du RPC
  ADD COLUMN sent_to_kitchen_at TIMESTAMPTZ,                     -- timestamp du send
  ADD COLUMN ready_at           TIMESTAMPTZ,                     -- timestamp du bump ready
  ADD COLUMN is_locked          BOOLEAN       NOT NULL DEFAULT false;

-- Index pour la query KDS (tickets en cours sur une station).
CREATE INDEX idx_oi_kds_station ON order_items(dispatch_station, kitchen_status)
  WHERE kitchen_status IN ('pending', 'preparing');

-- RLS : autoriser tout user authentifié à UPDATE kitchen_status sur les items lockés.
-- v1 n'a pas de role kitchen séparé : toute session authentifiée peut bumper un ticket.
-- Le verrou is_locked = true garantit qu'on ne touche que les items envoyés à la cuisine.
CREATE POLICY "kds_update_kitchen_status" ON order_items
  FOR UPDATE
  USING       (is_authenticated() AND is_locked = true)
  WITH CHECK  (is_authenticated() AND is_locked = true);

COMMENT ON COLUMN order_items.modifiers          IS 'Snapshot JSONB des options choisies : [{group_name, option_label, price_adjustment}]';
COMMENT ON COLUMN order_items.modifiers_total    IS 'Σ price_adjustment * quantity (déjà inclus dans line_total)';
COMMENT ON COLUMN order_items.kitchen_status     IS 'pending → preparing → ready (KDS flow)';
COMMENT ON COLUMN order_items.dispatch_station   IS 'Copié de categories.dispatch_station au INSERT du RPC';
COMMENT ON COLUMN order_items.sent_to_kitchen_at IS 'Timestamp send_items_to_kitchen';
COMMENT ON COLUMN order_items.ready_at           IS 'Timestamp bump ready (utilisé pour auto-archive 5 min côté queue locale)';
COMMENT ON COLUMN order_items.is_locked          IS 'true après send-to-kitchen ; bloque cancel/edit en v1 (D10)';
