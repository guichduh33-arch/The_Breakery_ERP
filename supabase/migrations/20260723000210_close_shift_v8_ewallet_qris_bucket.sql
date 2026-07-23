-- 20260723000210_close_shift_v8_ewallet_qris_bucket.sql
-- ADR-006 déc. 9 (lot B) — réconciliation three-way : les e-wallets
-- gopay/ovo/dana rejoignent le bucket QRIS (décision Mamat 2026-07-23),
-- cohérent avec leur mapping comptable SALE_PAYMENT_QRIS (_208/_209).
--
-- Pattern « bump depuis le corps live » exécuté littéralement : le corps de
-- close_shift_v7 (13 KB) et de _build_zreport_snapshot sont lus via
-- pg_get_functiondef à l'apply, modifiés par replace() chirurgical
-- (occurrence unique, gardée par un RAISE si le motif est absent), puis
-- EXECUTE. Zéro risque de transcription ; le delta est intégralement décrit
-- ici. Versioning monotone : v7 droppée dans la même migration.

DO $do$
DECLARE
  src TEXT;
BEGIN
  -- 1. close_shift_v8 = corps live de v7, bucket QRIS étendu.
  src := pg_get_functiondef('close_shift_v7(uuid,numeric,text,uuid,uuid,text,numeric,numeric,jsonb)'::regprocedure);

  IF position('public.close_shift_v7(p_session_id uuid' IN src) = 0 THEN
    RAISE EXCEPTION 'close_shift_v7 header not found — live body drifted, abort';
  END IF;
  src := replace(src, 'public.close_shift_v7(p_session_id uuid',
                      'public.close_shift_v8(p_session_id uuid');

  -- Le calcul de v_qris_expected est l'unique usage de `op.method = 'qris'`.
  IF (length(src) - length(replace(src, $q$AND op.method = 'qris';$q$, ''))) <> length($q$AND op.method = 'qris';$q$) THEN
    RAISE EXCEPTION 'expected exactly one qris-bucket site in close_shift_v7 — live body drifted, abort';
  END IF;
  src := replace(src, $q$AND op.method = 'qris';$q$,
                      $q$AND op.method IN ('qris', 'gopay', 'ovo', 'dana');$q$);

  EXECUTE src;

  -- 2. _build_zreport_snapshot : même bucket dans le volet qris du snapshot.
  src := pg_get_functiondef('_build_zreport_snapshot(uuid)'::regprocedure);

  IF (length(src) - length(replace(src, $q$AND op.method = 'qris';$q$, ''))) <> length($q$AND op.method = 'qris';$q$) THEN
    RAISE EXCEPTION 'expected exactly one qris-bucket site in _build_zreport_snapshot — live body drifted, abort';
  END IF;
  src := replace(src, $q$AND op.method = 'qris';$q$,
                      $q$AND op.method IN ('qris', 'gopay', 'ovo', 'dana');$q$);

  EXECUTE src;
END
$do$;

-- Versioning monotone : v7 droppée dans la même migration.
DROP FUNCTION public.close_shift_v7(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb);

-- Grants — miroir de v7 (_186).
REVOKE EXECUTE ON FUNCTION public.close_shift_v8(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_shift_v8(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) FROM anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_shift_v8(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) TO authenticated, service_role;

COMMENT ON FUNCTION public.close_shift_v8(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) IS
  'Bump of close_shift_v7 (lot B ADR-006 déc. 9): the QRIS reconciliation '
  'bucket aggregates qris + gopay + ovo + dana (identical settlement). '
  'Three-way count, PIN gate, denomination grid and Z-report unchanged.';

COMMENT ON FUNCTION public._build_zreport_snapshot(uuid) IS
  'Z-report snapshot builder. Since lot B (ADR-006 déc. 9) the qris '
  'reconciliation volet aggregates qris + gopay + ovo + dana.';
