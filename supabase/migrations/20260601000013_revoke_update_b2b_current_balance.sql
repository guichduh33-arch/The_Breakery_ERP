-- 20260601000013_revoke_update_b2b_current_balance.sql
-- Session 24 / Phase 1.A.1 / migration 7
--
-- Empêche les mutations directes de customers.b2b_current_balance via le path
-- authenticated. La colonne doit être écrite UNIQUEMENT via les RPCs
-- SECURITY DEFINER :
--   * create_b2b_order_v1   → balance += order_total
--   * record_b2b_payment_v1 → balance -= payment_amount
--   * adjust_b2b_balance_v1 → balance ±= delta (admin audit)
--
-- Implementation : pattern S22 update_cost_price_v1 (migration 20260526000013).
-- Postgres column-level REVOKE est NO-OP si une GRANT table-level existe. Le
-- harden migration 20260515000001 a déjà REVOKE ALL + GRANT par-colonne ; on
-- complète ici en ajoutant les colonnes B2B writable (sauf b2b_current_balance)
-- et les colonnes marketing (birth_date + marketing_consent) au grant.
--
-- Pattern S20 defense-in-depth : REVOKE explicite anon + PUBLIC.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Re-grant per-column UPDATE pour les colonnes écrites par le BO admin.
--    On AJOUTE les colonnes B2B + marketing au grant existant en réémettant
--    la liste complète (Postgres ne supporte pas l'incrément).
--    NB : on ne grant PAS b2b_current_balance — c'est l'intention de cette
--    migration.
-- ─────────────────────────────────────────────────────────────────────────────
GRANT UPDATE (
  name,
  phone,
  email,
  customer_type,
  category_id,
  b2b_company_name,
  b2b_tax_id,
  b2b_payment_terms_days,
  b2b_credit_limit,
  birth_date,
  marketing_consent
) ON customers TO authenticated;

-- Explicit defense-in-depth — anon n'a déjà aucun GRANT (S12 harden), mais on
-- réaffirme l'intention au niveau colonne pour future readers.
REVOKE UPDATE (b2b_current_balance) ON customers FROM anon;
REVOKE UPDATE (b2b_current_balance) ON customers FROM PUBLIC;

COMMENT ON COLUMN customers.b2b_current_balance IS
  'Cached AR outstanding. Mutable uniquement via b2b_* RPCs SECURITY DEFINER '
  '(create_b2b_order_v1 / record_b2b_payment_v1 / adjust_b2b_balance_v1). '
  'Pattern S22 column-level access control (S24). REVOKE UPDATE pour authenticated '
  'via omission du re-grant ; explicite pour anon/PUBLIC.';
