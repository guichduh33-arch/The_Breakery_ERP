-- 20260506000001_init_restaurant_tables.sql
-- Session 4 / migration 1 : table restaurant_tables + RLS + index + seed
-- F1: liste plate de tables (pas de coords x/y — floor plan visuel = session 7)

CREATE TABLE restaurant_tables (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL,
  seats      INTEGER NOT NULL DEFAULT 4
             CHECK (seats > 0 AND seats <= 20),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active  BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at TIMESTAMPTZ,
  UNIQUE NULLS NOT DISTINCT (name)
);

CREATE INDEX idx_restaurant_tables_sort
  ON restaurant_tables(sort_order, name)
  WHERE deleted_at IS NULL AND is_active;

CREATE TRIGGER restaurant_tables_set_updated_at
  BEFORE UPDATE ON restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE restaurant_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read" ON restaurant_tables FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);

INSERT INTO restaurant_tables (name, seats, sort_order) VALUES
  ('T-01',   2,  1),
  ('T-02',   2,  2),
  ('T-03',   4,  3),
  ('T-04',   4,  4),
  ('T-05',   6,  5),
  ('Patio-1',4,  6),
  ('Patio-2',4,  7),
  ('Bar-1',  2,  8),
  ('Bar-2',  2,  9),
  ('VIP',    8, 10);
