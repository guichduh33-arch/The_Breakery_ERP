-- 20260524000010_enable_rls_refund_sequences.sql
-- Session 20 / Wave 1 — Enable RLS on refund_sequences (P0 hotfix).
--
-- Audit 2026-05-17 found relrowsecurity=false on this table -> anon could
-- TRUNCATE with public anon key. Only SECURITY DEFINER RPC
-- next_refund_number_v1 writes here (verified via grep). Safe to enable.

ALTER TABLE public.refund_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY refund_sequences_select_auth
  ON public.refund_sequences
  FOR SELECT
  TO authenticated
  USING (true);

COMMENT ON POLICY refund_sequences_select_auth ON public.refund_sequences IS
  'S20 W1: enable RLS on sequence table - was previously bypassed. Reads OK '
  'for authenticated; writes only via next_refund_number_v1 RPC.';
