-- 20260519000120_init_production_schedules.sql
-- Session 15 / Phase 4.B — Production scheduling table.
--
-- Plans a recipe (= finished product whose recipe will be produced) for one
-- of the four daily fournée slots ('5am','7am','11am','4pm') on a given date.
-- The schedule row is the *plan* ; once production happens it links to the
-- actual production_records row via completed_record_id.
--
-- Decisions (Spec 2026-05-15 §D11, §D15, §D16) :
--   - Four fixed slots ('5am','7am','11am','4pm') — bakery fournée cadence.
--   - Status lifecycle : 'scheduled' → 'started' → 'completed'. From any
--     non-terminal state we may pivot to 'cancelled' or 'skipped'. Terminal
--     states ('completed','cancelled','skipped') cannot be transitioned out
--     of. Enforced by BEFORE UPDATE trigger.
--   - Unique (scheduled_date, slot, recipe_id) — no double-planning of the
--     same recipe in the same slot. Two distinct recipes in the same slot are
--     allowed (the four slots are time-windows, not capacity-of-one).
--   - recipe_id semantically references products(id) — Session 15 spec keeps
--     the name "recipe_id" because the planner thinks in terms of the
--     finished recipe even though the FK target is products.
--   - RLS : read via inventory.read ; mutate via inventory.production.schedule
--     (the new permission seeded by 20260519000122).

CREATE TABLE production_schedules (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_date       DATE         NOT NULL,
  slot                 TEXT         NOT NULL
                                       CHECK (slot IN ('5am','7am','11am','4pm')),
  recipe_id            UUID                  REFERENCES products(id) ON DELETE SET NULL,
  planned_qty          NUMERIC(10,3) NOT NULL CHECK (planned_qty > 0),
  status               TEXT         NOT NULL DEFAULT 'scheduled'
                                       CHECK (status IN ('scheduled','started','completed','cancelled','skipped')),
  created_by           UUID                  REFERENCES user_profiles(id) ON DELETE SET NULL,
  completed_record_id  UUID                  REFERENCES production_records(id) ON DELETE SET NULL,
  notes                TEXT,
  created_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT production_schedules_unique_slot
    UNIQUE (scheduled_date, slot, recipe_id)
);

CREATE INDEX idx_production_schedules_date_slot
  ON production_schedules(scheduled_date, slot);

CREATE INDEX idx_production_schedules_status_date
  ON production_schedules(status, scheduled_date DESC);

CREATE INDEX idx_production_schedules_recipe_date
  ON production_schedules(recipe_id, scheduled_date DESC)
  WHERE recipe_id IS NOT NULL;

CREATE TRIGGER production_schedules_set_updated_at
  BEFORE UPDATE ON production_schedules
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────
-- Lifecycle guard : enforces scheduled → started → completed and pivots
-- to cancelled/skipped from any non-terminal state. Reject illegal moves
-- with errcode P0001 + message 'invalid_schedule_status_transition'.
-- ──────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION enforce_production_schedule_lifecycle()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Terminal states are immutable.
  IF OLD.status IN ('completed','cancelled','skipped') THEN
    RAISE EXCEPTION 'invalid_schedule_status_transition'
      USING ERRCODE = 'P0001',
            DETAIL  = format('cannot leave terminal state %s', OLD.status);
  END IF;

  -- Allowed transitions :
  --   scheduled -> started | cancelled | skipped
  --   started   -> completed | cancelled | skipped
  IF OLD.status = 'scheduled' AND NEW.status IN ('started','cancelled','skipped') THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'started' AND NEW.status IN ('completed','cancelled','skipped') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid_schedule_status_transition'
    USING ERRCODE = 'P0001',
          DETAIL  = format('illegal transition %s -> %s', OLD.status, NEW.status);
END $$;

CREATE TRIGGER production_schedules_lifecycle_guard
  BEFORE UPDATE OF status ON production_schedules
  FOR EACH ROW EXECUTE FUNCTION enforce_production_schedule_lifecycle();

-- ──────────────────────────────────────────────────────────────────────────
-- RLS
-- ──────────────────────────────────────────────────────────────────────────
ALTER TABLE production_schedules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "perm_read" ON production_schedules
  FOR SELECT TO authenticated
  USING (has_permission(auth.uid(), 'inventory.read'));

CREATE POLICY "perm_insert" ON production_schedules
  FOR INSERT TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'inventory.production.schedule'));

CREATE POLICY "perm_update" ON production_schedules
  FOR UPDATE TO authenticated
  USING      (has_permission(auth.uid(), 'inventory.production.schedule'))
  WITH CHECK (has_permission(auth.uid(), 'inventory.production.schedule'));

CREATE POLICY "perm_delete" ON production_schedules
  FOR DELETE TO authenticated
  USING (has_permission(auth.uid(), 'inventory.production.schedule'));

REVOKE ALL ON production_schedules FROM anon;
GRANT  SELECT, INSERT, UPDATE, DELETE ON production_schedules TO authenticated;

COMMENT ON TABLE production_schedules IS
  'Session 15 / Phase 4.B. Production planning grid (7 days x 4 slots). '
  'recipe_id references products(id) — the finished product whose recipe '
  'is being planned. Status lifecycle scheduled -> started -> completed '
  'enforced by enforce_production_schedule_lifecycle trigger.';

COMMENT ON COLUMN production_schedules.recipe_id IS
  'FK to products(id). Semantically the finished recipe being scheduled.';
COMMENT ON COLUMN production_schedules.completed_record_id IS
  'Set when the schedule transitions to completed — links to the actual '
  'production_records row generated by record_production_v1 / record_batch_production_v1.';
COMMENT ON COLUMN production_schedules.status IS
  'Lifecycle scheduled -> started -> completed. Either non-terminal state '
  'can pivot to cancelled or skipped. Terminal states are immutable.';
