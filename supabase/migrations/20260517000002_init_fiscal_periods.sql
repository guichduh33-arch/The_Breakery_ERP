-- 20260517000002_init_fiscal_periods.sql
-- Session 13 / Phase 1.A / migration 10-A0bis :
--   fiscal_periods table + seed 24 months (Jan 2026 .. Dec 2027)
--   + helper check_fiscal_period_open(p_date DATE) RETURNS VOID (RAISE P0004 when locked)
--   + helper next_journal_entry_number(p_date DATE) RETURNS TEXT
--
-- Why : a JE backdated to a closed/locked month would silently rewrite finalized
-- accounting history. We guard at JE creation time.
--
-- Decision : D12 (Decision Pack 2026-05-13). Verified V3-absent via
-- `grep -R fiscal_periods supabase/` → 0 hit (2026-05-14).

CREATE TABLE fiscal_periods (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_start   DATE NOT NULL,
  period_end     DATE NOT NULL,
  status         TEXT NOT NULL DEFAULT 'open'
                   CHECK (status IN ('draft','open','closed','locked')),
  closed_by      UUID REFERENCES user_profiles(id),
  closed_at      TIMESTAMPTZ,
  locked_by      UUID REFERENCES user_profiles(id),
  locked_at      TIMESTAMPTZ,
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fiscal_periods_period_end_unique UNIQUE (period_end),
  CONSTRAINT fiscal_periods_range_check
    CHECK (period_end > period_start)
);

CREATE INDEX idx_fiscal_periods_range ON fiscal_periods(period_start, period_end);
CREATE INDEX idx_fiscal_periods_status ON fiscal_periods(status);

CREATE TRIGGER fiscal_periods_set_updated_at
  BEFORE UPDATE ON fiscal_periods
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE fiscal_periods IS
  'Monthly fiscal periods. Status workflow: draft → open → closed → locked. '
  'JE creation routes through check_fiscal_period_open() guard which RAISEs '
  'period_locked (P0004) when target date falls in closed/locked period. D12.';

-- Seed 24 months (Jan 2026 .. Dec 2027). All open by default.
INSERT INTO fiscal_periods (period_start, period_end, status, notes)
SELECT
  date_trunc('month', d)::DATE                                          AS period_start,
  (date_trunc('month', d) + INTERVAL '1 month' - INTERVAL '1 day')::DATE AS period_end,
  'open',
  'Seeded Phase 1.A (Session 13)'
FROM generate_series('2026-01-01'::DATE, '2027-12-01'::DATE, '1 month') AS d
ON CONFLICT (period_end) DO NOTHING;

-- Helper : check_fiscal_period_open(p_date DATE) RETURNS VOID
-- Looks up the period containing p_date and RAISEs period_locked (P0004) when closed/locked.
-- Returns silently when no period covers the date (legacy / future seed gap) — design choice:
-- guard fails-open if the period is undefined, to avoid blocking ops before seed catch-up.
CREATE OR REPLACE FUNCTION check_fiscal_period_open(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'date_required_for_period_check' USING ERRCODE = 'P0002';
  END IF;

  SELECT status INTO v_status
    FROM fiscal_periods
    WHERE p_date BETWEEN period_start AND period_end
    LIMIT 1;

  IF v_status IS NULL THEN
    -- No covering period: silently allow (admin must seed periods extending into the date).
    RETURN;
  END IF;

  IF v_status IN ('closed','locked') THEN
    RAISE EXCEPTION 'period_locked: date % falls in % period', p_date, v_status
      USING ERRCODE = 'P0004';
  END IF;
END;
$$;

COMMENT ON FUNCTION check_fiscal_period_open(DATE) IS
  'D12 helper. RAISEs period_locked (P0004) when p_date falls in a closed/locked '
  'fiscal_period. Called from every JE trigger / RPC. Fails-open when no period '
  'covers the date (seed-gap-tolerant).';

-- Helper : next_journal_entry_number(p_date DATE) RETURNS TEXT
-- Generates JE-YYYYMMDD-XXXX where XXXX is a daily sequence (1-based).
-- Implementation: a journal_entry_sequences table mirroring pos.order_sequences pattern.
CREATE TABLE IF NOT EXISTS journal_entry_sequences (
  date         DATE PRIMARY KEY,
  last_number  INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER journal_entry_sequences_set_updated_at
  BEFORE UPDATE ON journal_entry_sequences
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE OR REPLACE FUNCTION next_journal_entry_number(p_date DATE)
RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_seq INTEGER;
BEGIN
  IF p_date IS NULL THEN
    RAISE EXCEPTION 'date_required_for_je_number' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO journal_entry_sequences (date, last_number)
    VALUES (p_date, 1)
    ON CONFLICT (date) DO UPDATE
      SET last_number = journal_entry_sequences.last_number + 1
    RETURNING last_number INTO v_seq;

  RETURN 'JE-' || to_char(p_date, 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$;

COMMENT ON FUNCTION next_journal_entry_number(DATE) IS
  'D12 helper. Generates monotonic JE entry_number per day: JE-YYYYMMDD-XXXX. '
  'Backed by journal_entry_sequences row-per-date — atomic via ON CONFLICT DO UPDATE.';

-- RLS : read-only authenticated for fiscal_periods; writes via SECURITY DEFINER.
ALTER TABLE fiscal_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON fiscal_periods FOR SELECT
  USING (is_authenticated());

ALTER TABLE journal_entry_sequences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read" ON journal_entry_sequences FOR SELECT
  USING (is_authenticated());

REVOKE EXECUTE ON FUNCTION check_fiscal_period_open(DATE)      FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION next_journal_entry_number(DATE)     FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION check_fiscal_period_open(DATE)      TO authenticated;
GRANT  EXECUTE ON FUNCTION next_journal_entry_number(DATE)     TO authenticated;
