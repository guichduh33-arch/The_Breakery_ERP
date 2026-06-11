-- 20260623000010_create_b2b_settings_table.sql
-- Session 39 \ Wave A \ Task A1 (BO-15) — table singleton b2b_settings + seed.
-- Ferme la déviation D-W6-B2BSET-01 (S14). Accès uniquement via RPCs SECURITY
-- DEFINER (_011) — RLS enabled sans policy + REVOKE table (pattern S25/S35
-- idempotency tables). Les aging_buckets persistés ne pilotent PAS view_ar_aging
-- (décision utilisateur S39 — refactor déféré).

CREATE TABLE public.b2b_settings (
  id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  default_payment_terms TEXT NOT NULL DEFAULT 'net_30',
  available_payment_terms JSONB NOT NULL DEFAULT '["cod","net_7","net_14","net_30","net_60"]',
  critical_overdue_days INT NOT NULL DEFAULT 30 CHECK (critical_overdue_days BETWEEN 1 AND 365),
  aging_buckets JSONB NOT NULL DEFAULT '[{"label":"Current","min":0,"max":30},{"label":"Overdue","min":31,"max":60},{"label":"Critical","min":61,"max":null}]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID NULL REFERENCES public.user_profiles(id)
);

COMMENT ON TABLE public.b2b_settings IS
  'S39 BO-15 — singleton (id=1). Réglages B2B globaux. Accès via get/update_b2b_settings_v1 uniquement. aging_buckets ne pilote pas (encore) view_ar_aging.';

INSERT INTO public.b2b_settings (id) VALUES (1);

ALTER TABLE public.b2b_settings ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.b2b_settings FROM PUBLIC;
REVOKE ALL ON TABLE public.b2b_settings FROM anon;
REVOKE ALL ON TABLE public.b2b_settings FROM authenticated;
