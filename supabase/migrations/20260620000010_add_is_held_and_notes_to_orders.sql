-- Session 35 — F-003 Held orders DB-backed (Wave C1)
-- A held order is a draft order flagged is_held=true (Option A, ratified — no ENUM ADD VALUE).
-- orders had no notes column; held-order notes need a home + show in the held list.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS is_held BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Held lookups are a tiny slice of orders; partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS orders_is_held_idx
  ON public.orders (session_id, created_at DESC)
  WHERE is_held = true;
