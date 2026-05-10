-- 20260510000001_init_promotions.sql
-- Session 8 / migration 1 : enum promotion_action_type + table promotions + RLS.
-- Spec: docs/superpowers/specs/2026-05-07-session-8-promotions-engine-spec.md §3.1, §3.2, §3.12

CREATE TYPE promotion_action_type AS ENUM (
  'percentage_off',
  'fixed_off',
  'bogo',
  'free_product'
);

CREATE TABLE promotions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  slug            TEXT NOT NULL UNIQUE,
  description     TEXT,
  action_type     promotion_action_type NOT NULL,
  action_params   JSONB NOT NULL DEFAULT '{}'::JSONB,
  conditions      JSONB NOT NULL DEFAULT '{"all": []}'::JSONB,
  priority        INTEGER NOT NULL DEFAULT 0,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at      TIMESTAMPTZ,

  CHECK (jsonb_typeof(action_params) = 'object'),
  CHECK (jsonb_typeof(conditions) = 'object'),
  CHECK (conditions ? 'all')
);

CREATE INDEX idx_promotions_active
  ON promotions(action_type)
  WHERE deleted_at IS NULL AND is_active;

ALTER TABLE promotions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_active" ON promotions FOR SELECT
  USING (is_authenticated() AND deleted_at IS NULL AND is_active);
