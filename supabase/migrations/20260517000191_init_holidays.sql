-- 20260517000191_init_holidays.sql
-- Session 13 / Phase 5.C
--
-- Holiday calendar. National + religious holidays surface as is_recurring
-- where the date moves yearly (Eid, Lunar New Year) and as fixed-date for
-- those tied to the Gregorian calendar (Independence Day, Christmas).
-- Company-level closures (e.g. annual cleaning week) live alongside as
-- type='company'.
--
-- Permission `settings.holidays.manage` is already seeded by Wave 1 ;
-- we do NOT re-create has_permission() per CLAUDE.md rule #3. Granted to
-- ADMIN + SUPER_ADMIN.

CREATE TABLE IF NOT EXISTS holidays (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  date          DATE NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('national','religious','company')),
  is_recurring  BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at    TIMESTAMPTZ
);

-- Avoid duplicates of the same name on the same calendar date while
-- still letting an admin add a like-named "company" override on a
-- different date.
CREATE UNIQUE INDEX IF NOT EXISTS idx_holidays_date_name_unique
  ON holidays(date, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_holidays_date
  ON holidays(date)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_holidays_type
  ON holidays(type)
  WHERE deleted_at IS NULL;

CREATE TRIGGER holidays_set_updated_at
  BEFORE UPDATE ON holidays
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE holidays ENABLE ROW LEVEL SECURITY;

CREATE POLICY holidays_select_authenticated
  ON holidays
  FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY holidays_insert_manage
  ON holidays
  FOR INSERT
  TO authenticated
  WITH CHECK (has_permission(auth.uid(), 'settings.holidays.manage'));

CREATE POLICY holidays_update_manage
  ON holidays
  FOR UPDATE
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.holidays.manage'))
  WITH CHECK (has_permission(auth.uid(), 'settings.holidays.manage'));

CREATE POLICY holidays_delete_manage
  ON holidays
  FOR DELETE
  TO authenticated
  USING (has_permission(auth.uid(), 'settings.holidays.manage'));

COMMENT ON TABLE holidays IS
  'Session 13 / Phase 5.C. Holiday calendar : national + religious + company-level closures. is_recurring flags moveable feasts so the UI can surface them when scheduling the next fiscal year.';
COMMENT ON COLUMN holidays.is_recurring IS
  'TRUE for movable holidays whose date shifts year-to-year (Eid, Lunar New Year). The stored date is the current-year value ; future iterations can re-seed the next year.';

-- Seed 2026 Indonesian public holidays (national + religious).
-- Dates per the Indonesian government joint ministerial decree for 2026.
INSERT INTO holidays (name, date, type, is_recurring, notes) VALUES
  ('Tahun Baru Masehi',                     DATE '2026-01-01', 'national',  false, 'New Year''s Day'),
  ('Tahun Baru Imlek',                      DATE '2026-02-17', 'religious', true,  'Lunar New Year — moveable'),
  ('Isra Mi''raj Nabi Muhammad SAW',        DATE '2026-01-15', 'religious', true,  'Islamic Ascension — moveable'),
  ('Hari Suci Nyepi',                       DATE '2026-03-19', 'religious', true,  'Balinese Day of Silence'),
  ('Wafat Isa Al-Masih',                    DATE '2026-04-03', 'religious', true,  'Good Friday'),
  ('Hari Raya Idul Fitri 1447H',            DATE '2026-03-20', 'religious', true,  'Eid al-Fitr day 1 — moveable'),
  ('Hari Raya Idul Fitri 1447H',            DATE '2026-03-21', 'religious', true,  'Eid al-Fitr day 2 — moveable'),
  ('Hari Buruh Internasional',              DATE '2026-05-01', 'national',  false, 'Labour Day'),
  ('Kenaikan Isa Al-Masih',                 DATE '2026-05-14', 'religious', true,  'Ascension of Jesus Christ'),
  ('Hari Raya Waisak',                      DATE '2026-05-31', 'religious', true,  'Buddha''s Birthday — moveable'),
  ('Hari Lahir Pancasila',                  DATE '2026-06-01', 'national',  false, 'Pancasila Day'),
  ('Hari Raya Idul Adha 1447H',             DATE '2026-05-27', 'religious', true,  'Eid al-Adha — moveable'),
  ('Tahun Baru Islam 1448H',                DATE '2026-06-17', 'religious', true,  'Islamic New Year — moveable'),
  ('Hari Kemerdekaan RI',                   DATE '2026-08-17', 'national',  false, 'Indonesian Independence Day'),
  ('Maulid Nabi Muhammad SAW',              DATE '2026-08-26', 'religious', true,  'Prophet''s Birthday — moveable'),
  ('Hari Raya Natal',                       DATE '2026-12-25', 'national',  false, 'Christmas Day')
ON CONFLICT DO NOTHING;
