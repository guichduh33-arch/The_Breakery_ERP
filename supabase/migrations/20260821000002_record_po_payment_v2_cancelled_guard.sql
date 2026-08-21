-- 20260821000002_record_po_payment_v2_cancelled_guard.sql
-- Fix — a `cancelled` purchase order still accepted `Record payment`, both in
-- the UI (`Record payment` stayed enabled) and server-side (record_po_payment_v1
-- had no status guard). Proven on dev: a real payment (Rp 6.660) was written
-- and posted JE-20260821-0057 against a cancelled PO.
--
-- Body copied verbatim from record_po_payment_v1, and CONFIRMED against the
-- live cloud definition (`pg_get_functiondef`, projet ikcyvlovptebroadgtvd,
-- 2026-08-21) : le corps live et celui de la migration d'origine
-- (20260701000013) sont identiques, aucune migration postérieure ne le
-- redéfinit. La seule différence de v2 est la garde ci-dessous.
--
-- The internal helper `_record_po_payment_internal` is UNTOUCHED — it is also
-- called directly by the `create_purchase_journal_entry` trigger (AFTER INSERT
-- ON goods_receipt_notes) to auto-pay cash-terms POs on receipt, a system path
-- that must not gain a user-facing status guard.
--
-- Guard placement: after the existing `p_idempotency_key IS NULL` check, before
-- delegating to `_record_po_payment_internal`. Blocks ONLY status='cancelled' —
-- draft/pending/partial/received all remain payable (unchanged from v1; no new
-- arbitration on 'draft').
--
-- DROP record_po_payment_v1(UUID, NUMERIC, TEXT, TEXT, UUID) in this same
-- migration (RPC versioning monotone). Les deux seuls appelants applicatifs —
-- `useRecordPoPayment.ts` et `useRecordDirectPurchase.ts` — sont repointés sur
-- v2 dans le même changement : hard cutover, pas de double appel.

CREATE OR REPLACE FUNCTION record_po_payment_v2(
  p_po_id           UUID,
  p_amount          NUMERIC,
  p_method          TEXT,
  p_reference       TEXT    DEFAULT NULL,
  p_idempotency_key UUID    DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $$
DECLARE
  v_uid       UUID := auth.uid();
  v_profile   UUID;
  v_po_status TEXT;
BEGIN
  -- ── Auth-first ────────────────────────────────────────────────────────────
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  IF NOT has_permission(v_uid, 'purchasing.po.pay') THEN
    RAISE EXCEPTION 'permission_denied: purchasing.po.pay' USING ERRCODE = 'P0003';
  END IF;

  -- ── Input validation ──────────────────────────────────────────────────────
  IF p_po_id IS NULL THEN
    RAISE EXCEPTION 'po_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'amount_must_be_positive' USING ERRCODE = 'P0001';
  END IF;
  IF p_method IS NULL OR length(trim(p_method)) = 0 THEN
    RAISE EXCEPTION 'method_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_idempotency_key IS NULL THEN
    RAISE EXCEPTION 'idempotency_key_required' USING ERRCODE = 'P0001';
  END IF;

  -- ── v2: cancelled-PO guard ────────────────────────────────────────────────
  -- Only 'cancelled' is blocked. draft/pending/partial/received stay payable —
  -- unchanged from v1, no new arbitration here. NULL status (po_not_found) is
  -- deliberately let through: _record_po_payment_internal already raises
  -- po_not_found (P0002) for that case.
  --
  -- `FOR UPDATE` N'EST PAS DÉCORATIF, et sans lui la garde ne fermait rien.
  -- Une lecture nue est un TOCTOU : on lit `pending`, une annulation
  -- concurrente (`cancel_purchase_order_v1`, qui verrouille, elle) s'intercale
  -- et commite, et on franchit une garde déjà périmée. Le helper interne prend
  -- bien son propre `FOR UPDATE` juste après — mais il ne relit JAMAIS
  -- `status` sous ce verrou (il ne contrôle que `deleted_at`, le surpaiement
  -- et la période fiscale), donc rien en aval ne rattrape la course. C'est
  -- exactement la classe de bug de l'incident que cette migration corrige.
  -- Le verrou est réentrant dans la même transaction : le `FOR UPDATE` de
  -- l'helper le retrouve déjà tenu, il ne bloque pas et ne coûte rien.
  SELECT status INTO v_po_status FROM purchase_orders WHERE id = p_po_id FOR UPDATE;
  IF v_po_status = 'cancelled' THEN
    RAISE EXCEPTION 'po_cancelled: payment refused on a cancelled purchase order' USING ERRCODE = 'P0001';
  END IF;

  -- ── Delegate all work to internal helper ──────────────────────────────────
  RETURN _record_po_payment_internal(
    p_po_id           := p_po_id,
    p_amount          := p_amount,
    p_method          := p_method,
    p_reference       := p_reference,
    p_idempotency_key := p_idempotency_key,
    p_actor           := v_profile
  );
END $$;

COMMENT ON FUNCTION record_po_payment_v2(UUID, NUMERIC, TEXT, TEXT, UUID) IS
  'Bump of record_po_payment_v1 (20260701000013). Adds a status guard: refuses '
  'payment on a cancelled PO (po_cancelled, P0001) — dev incident, real payment '
  'posted against a cancelled PO (JE-20260821-0057). Gate: purchasing.po.pay. '
  'Auth-first. Input validation. Delegates to _record_po_payment_internal '
  '(unchanged — still called directly by the create_purchase_journal_entry '
  'trigger for cash-PO auto-payment, which must NOT gain this guard). '
  'Errors: P0001 not_authenticated/amount_positive/overpayment/method_required/'
  'po_cancelled, P0002 po_not_found, P0003 permission_denied.';

-- ─── GRANT + canonical 3-line REVOKE pair ───────────────────────────────────
-- Les bénéficiaires sont relevés sur le LIVE, pas recopiés de la migration
-- d'origine : `information_schema.role_routine_grants` rend trois lignes pour
-- v1 — `authenticated`, `postgres` (propriétaire) et `service_role`. Omettre
-- `service_role` aurait été un retrait de droit silencieux glissé dans un bump,
-- pas un correctif. Aucune ligne `PUBLIC` : le REVOKE ci-dessous ferme donc bien
-- l'héritage et n'annule aucun droit existant.
GRANT EXECUTE ON FUNCTION record_po_payment_v2(UUID, NUMERIC, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION record_po_payment_v2(UUID, NUMERIC, TEXT, TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION record_po_payment_v2(UUID, NUMERIC, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION record_po_payment_v2(UUID, NUMERIC, TEXT, TEXT, UUID) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ─── Drop the superseded v1 signature (RPC versioning monotone) ─────────────
DROP FUNCTION record_po_payment_v1(UUID, NUMERIC, TEXT, TEXT, UUID);
