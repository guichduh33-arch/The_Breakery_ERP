# S67 — Clôture 3 volets + comptage par coupure — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer fiche 12 D2.2 (comptage 3 volets cash/QRIS/carte à la clôture, gardes note/PIN étendues, zéro JE non-cash) et D2.3 (grille de coupures IDR opt-in à l'open et au close) via `close_shift_v4 → v5`.

**Architecture:** Bump `close_shift_v5` (migrations `_121..124`) + extension in-place de `_build_zreport_snapshot` (section `reconciliation`) ; nouveau module domain IO-free `cash/denominations` ; POS `CloseShiftModal`/`OpenShiftModal` étendus (blind count préservé) ; BO toggle settings + rendu Z. Spec : `docs/superpowers/specs/2026-07-07-s67-close-shift-three-way-denominations-design.md`.

**Tech Stack:** Postgres/plpgsql (Supabase cloud V3 `ikcyvlovptebroadgtvd` via MCP), pgTAP, React 18 + TanStack Query (POS/BO), Vitest, pdf-lib (EF Deno).

## Global Constraints

- **DB = cloud V3 via MCP uniquement** (Docker retiré) : `apply_migration`, `execute_sql` (pgTAP en `BEGIN…ROLLBACK`), `generate_typescript_types`. **Jamais** `supabase start`/`db reset`/`run_pgtap.sh`.
- **Subagents n'ont PAS accès au MCP Supabase** : les tâches DB écrivent le fichier SQL ; l'application cloud (apply_migration / execute_sql / types regen / deploy EF) est faite par le **contrôleur** (steps marqués `[CONTROLLER]`).
- **Jamais de `BEGIN;`/`COMMIT;` dans un corps de migration** (leçon S58).
- **DEV-S57-02** : tout bump/édition in-place de RPC part du corps **live** (`SELECT pg_get_functiondef(...)`), jamais d'un fichier historique. Les corps donnés dans ce plan sont dérivés du live vérifié S66 (`_119`/`_120`) — re-vérifier au moment de l'exécution et reporter toute divergence.
- **Trio S20** sur toute nouvelle fonction : `REVOKE ALL FROM PUBLIC` + `REVOKE ALL FROM anon` + GRANT explicite + `COMMENT`.
- **RPC versioning monotone** : `close_shift_v5` + `DROP FUNCTION public.close_shift_v4(uuid, numeric, text, uuid, uuid, text)` dans la **même** migration.
- **Money-path v17/v11/fire_v4 interdite de modification** ; ancre `s44_money_gates` 12/12 au closeout.
- Après toute migration : **types regen** → `packages/supabase/src/types.generated.ts` + commit.
- Monorepo pnpm 9.15 + turbo — jamais `npm`. Fichiers < 500 lignes. Tests co-localisés `__tests__/`.
- Commits conventionnels, co-author Claude.
- Blind count (LOT 4) : **aucun attendu affiché à l'étape count** — toute régression est un échec de tâche.

---

### Task 1: Domain `cash/denominations` (IO-free)

**Files:**
- Create: `packages/domain/src/cash/denominations.ts`
- Create: `packages/domain/src/cash/index.ts`
- Modify: `packages/domain/src/index.ts` (ajouter `export * from './cash';` à côté des exports existants)
- Test: `packages/domain/src/cash/__tests__/denominations.test.ts`

**Interfaces:**
- Consumes: rien (pure TS).
- Produces: `IDR_DENOMINATIONS: readonly number[]` ; `sumDenominations(grid: Record<string, number>): number` ; `isValidDenominationGrid(grid: Record<string, number>): boolean`. Consommés par les Tasks 9/10/11 via `import { … } from '@breakery/domain'`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/domain/src/cash/__tests__/denominations.test.ts
import { describe, expect, it } from 'vitest';
import { IDR_DENOMINATIONS, isValidDenominationGrid, sumDenominations } from '../denominations';

describe('IDR_DENOMINATIONS', () => {
  it('is the canonical descending list (mirror of close_shift_v5)', () => {
    expect([...IDR_DENOMINATIONS]).toEqual([
      100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
    ]);
  });
});

describe('sumDenominations', () => {
  it('sums face value × quantity', () => {
    expect(sumDenominations({ '100000': 3, '50000': 1, '500': 4 })).toBe(352_000);
  });
  it('returns 0 for an empty grid', () => {
    expect(sumDenominations({})).toBe(0);
  });
  it('ignores zero quantities', () => {
    expect(sumDenominations({ '100000': 0, '2000': 2 })).toBe(4_000);
  });
});

describe('isValidDenominationGrid', () => {
  it('accepts known keys with non-negative integer quantities', () => {
    expect(isValidDenominationGrid({ '100000': 2, '100': 0 })).toBe(true);
  });
  it('rejects unknown denominations', () => {
    expect(isValidDenominationGrid({ '75000': 1 })).toBe(false);
  });
  it('rejects negative or fractional quantities', () => {
    expect(isValidDenominationGrid({ '1000': -1 })).toBe(false);
    expect(isValidDenominationGrid({ '1000': 1.5 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/domain test denominations`
Expected: FAIL (`Cannot find module '../denominations'`).

- [ ] **Step 3: Write minimal implementation**

```ts
// packages/domain/src/cash/denominations.ts
//
// S67 (fiche 12 D2.3) — grille de coupures IDR pour l'ouverture/clôture de
// caisse. LISTE CANONIQUE : miroir exact de l'allowlist de close_shift_v5
// (migration 20260710000122) — toute évolution se fait dans les deux.

export const IDR_DENOMINATIONS: readonly number[] = [
  100_000, 50_000, 20_000, 10_000, 5_000, 2_000, 1_000, 500, 200, 100,
];

const KNOWN = new Set(IDR_DENOMINATIONS.map(String));

/** Somme valeur faciale × quantité. Les clés inconnues sont ignorées (la
 *  validation est le rôle d'isValidDenominationGrid / du RPC). */
export function sumDenominations(grid: Record<string, number>): number {
  return Object.entries(grid).reduce(
    (sum, [face, qty]) => (KNOWN.has(face) ? sum + Number(face) * qty : sum),
    0,
  );
}

/** True si toutes les clés sont des coupures connues et toutes les quantités
 *  des entiers >= 0 (miroir de la validation serveur invalid_denomination). */
export function isValidDenominationGrid(grid: Record<string, number>): boolean {
  return Object.entries(grid).every(
    ([face, qty]) => KNOWN.has(face) && Number.isInteger(qty) && qty >= 0,
  );
}
```

```ts
// packages/domain/src/cash/index.ts
export * from './denominations';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @breakery/domain test denominations`
Expected: PASS (7 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm --filter @breakery/domain typecheck
git add packages/domain/src/cash packages/domain/src/index.ts
git commit -m "feat(domain): cash/denominations — liste canonique coupures IDR + sum/validate [S67 T1]"
```

---

### Task 2: Migration `_121` — colonnes flag + comptage + grilles

**Files:**
- Create: `supabase/migrations/20260710000121_shift_three_way_denominations_columns.sql`

**Interfaces:**
- Produces: `business_config.shift_denomination_count_enabled` ; `pos_sessions.counted_qris/counted_card/opening_denominations/closing_denominations`. Consommés par `_122`/`_123` (Tasks 3-4), le POS (Tasks 9-11) et le BO (Task 12).

- [ ] **Step 1: Write the migration file**

```sql
-- 20260710000121_shift_three_way_denominations_columns.sql
-- S67 (fiche 12 D2.2/D2.3) — colonnes support du comptage 3 volets et de la
-- grille de coupures :
--   business_config.shift_denomination_count_enabled : opt-in B2.5 (défaut OFF).
--   pos_sessions.counted_qris / counted_card : totaux relevés des terminaux à
--     la clôture (NULL = volet non compté — méthode désactivée S64).
--   pos_sessions.opening_denominations / closing_denominations : grille
--     {"100000": 3, ...} (clé = valeur faciale IDR, valeur = quantité).
-- Aucune JE nouvelle (décision propriétaire : écart non-cash = trace + gardes).

ALTER TABLE public.business_config
  ADD COLUMN IF NOT EXISTS shift_denomination_count_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.pos_sessions
  ADD COLUMN IF NOT EXISTS counted_qris NUMERIC,
  ADD COLUMN IF NOT EXISTS counted_card NUMERIC,
  ADD COLUMN IF NOT EXISTS opening_denominations JSONB,
  ADD COLUMN IF NOT EXISTS closing_denominations JSONB;

ALTER TABLE public.pos_sessions
  ADD CONSTRAINT pos_sessions_counted_qris_nonneg CHECK (counted_qris IS NULL OR counted_qris >= 0),
  ADD CONSTRAINT pos_sessions_counted_card_nonneg CHECK (counted_card IS NULL OR counted_card >= 0);

COMMENT ON COLUMN public.business_config.shift_denomination_count_enabled IS
  'S67 (12 D2.3/B2.5): when TRUE the POS requires the cash count (open & close) to go through the IDR denomination grid; close_shift_v5 enforces it (denominations_required).';
COMMENT ON COLUMN public.pos_sessions.counted_qris IS
  'S67 (12 D2.2): QRIS total read from the payment terminal at close. NULL = volet not counted.';
COMMENT ON COLUMN public.pos_sessions.counted_card IS
  'S67 (12 D2.2): card+EDC total read from the terminal at close (merged volet). NULL = volet not counted.';
COMMENT ON COLUMN public.pos_sessions.opening_denominations IS
  'S67 (12 D2.3): opening-cash denomination grid {"100000": 3, ...} (client-side only — no open RPC).';
COMMENT ON COLUMN public.pos_sessions.closing_denominations IS
  'S67 (12 D2.3): closing-cash denomination grid, validated by close_shift_v5 (sum must equal p_counted_cash).';
```

- [ ] **Step 2 [CONTROLLER]: Apply via MCP**

`mcp__plugin_supabase_supabase__apply_migration` avec `project_id='ikcyvlovptebroadgtvd'`, `name='shift_three_way_denominations_columns'`, body = fichier ci-dessus.

- [ ] **Step 3 [CONTROLLER]: Verify**

`execute_sql`: `SELECT column_name FROM information_schema.columns WHERE table_name='pos_sessions' AND column_name IN ('counted_qris','counted_card','opening_denominations','closing_denominations');`
Expected: 4 lignes.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000121_shift_three_way_denominations_columns.sql
git commit -m "feat(db): colonnes 3 volets + grilles coupures (business_config flag, pos_sessions) [S67 T2]"
```

---

### Task 3: Migration `_122` — `close_shift_v4 → v5`

**Files:**
- Create: `supabase/migrations/20260710000122_close_shift_v5_three_way_denominations.sql`

**Interfaces:**
- Consumes: colonnes Task 2 ; corps **live** de `close_shift_v4` (`SELECT pg_get_functiondef('public.close_shift_v4(uuid,numeric,text,uuid,uuid,text)'::regprocedure);` — vérifier qu'il est identique au fichier `_119` avant d'écrire ; sinon STOP et reporter).
- Produces: `close_shift_v5(p_session_id uuid, p_counted_cash numeric, p_notes text DEFAULT NULL, p_idempotency_key uuid DEFAULT NULL, p_approver_id uuid DEFAULT NULL, p_manager_pin text DEFAULT NULL, p_counted_qris numeric DEFAULT NULL, p_counted_card numeric DEFAULT NULL, p_denominations jsonb DEFAULT NULL) RETURNS jsonb`. Nouveaux codes : `counted_method_invalid`/`denominations_required`/`denomination_total_mismatch`/`invalid_denomination` (tous P0001). Consommé par Tasks 6-8.

- [ ] **Step 1: Write the migration file**

Le corps ci-dessous = corps v4 live avec les insertions S67 (marquées `-- S67`). Écrire le fichier complet :

```sql
-- 20260710000122_close_shift_v5_three_way_denominations.sql
-- S67 (fiche 12 D2.2/D2.3) — close_shift_v5 : comptage 3 volets + grille coupures.
--   * p_counted_qris / p_counted_card (DEFAULT NULL = volet non compté) :
--     expected par volet calculé serveur (miroir du calcul cash — orders paid),
--     variance persistée (pos_sessions.counted_qris/card) et figée au snapshot.
--     AUCUNE JE non-cash (décision propriétaire 2026-07-07) — la JE d'écart
--     cash 1110<->4910/5910 est inchangée.
--   * Gardes note (S60) et PIN (S66) étendues : OR sur les volets comptés,
--     mêmes seuils business_config, pct relatif à l'expected du volet
--     (skippé si expected = 0, miroir du code cash existant). Le DETAIL nomme
--     les volets fautifs.
--   * p_denominations (grille {"100000": 3, ...}) : obligatoire si
--     business_config.shift_denomination_count_enabled (denominations_required) ;
--     si fournie (flag ON ou OFF) : clés dans l'allowlist IDR canonique
--     (miroir packages/domain/src/cash/denominations.ts), quantités entières
--     >= 0 (invalid_denomination), somme == p_counted_cash
--     (denomination_total_mismatch). Persistée en closing_denominations.
--   * Le replay idempotent (session non-open) sort AVANT toutes les gardes
--     (ni note, ni PIN, ni grille) — inchangé S60/S66.
--
-- Codes d'erreur nouveaux (tous P0001, tous AVANT toute écriture) :
--   counted_method_invalid, denominations_required,
--   denomination_total_mismatch, invalid_denomination.
--
-- DEV-S57-02 : corps repris DU LIVE via
--   SELECT pg_get_functiondef('public.close_shift_v4(uuid,numeric,text,uuid,uuid,text)'::regprocedure);
-- (à re-vérifier identique au fichier _119 au moment de l'exécution).

CREATE OR REPLACE FUNCTION public.close_shift_v5(
  p_session_id uuid,
  p_counted_cash numeric,
  p_notes text DEFAULT NULL::text,
  p_idempotency_key uuid DEFAULT NULL::uuid,
  p_approver_id uuid DEFAULT NULL::uuid,
  p_manager_pin text DEFAULT NULL::text,
  p_counted_qris numeric DEFAULT NULL::numeric,
  p_counted_card numeric DEFAULT NULL::numeric,
  p_denominations jsonb DEFAULT NULL::jsonb
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid          UUID := auth.uid();
  v_profile      UUID;
  v_status       TEXT;
  v_opening      NUMERIC(14,2);
  v_in_tot       NUMERIC(14,2);
  v_out_tot      NUMERIC(14,2);
  v_cash_sales   NUMERIC(14,2);
  v_expected     NUMERIC(14,2);
  v_variance     NUMERIC(14,2);
  v_je_id        UUID;
  v_je_existing  UUID;
  v_entry_no     TEXT;
  v_cash_acc     UUID;
  v_over_acc     UUID;
  v_short_acc    UUID;
  v_today        DATE := CURRENT_DATE;
  -- S29 additions
  v_snapshot     JSONB;
  v_zreport_id   UUID;
  -- S60 (12 D1.4) additions
  v_thr_abs      NUMERIC;
  v_thr_pct      NUMERIC;
  -- S66 (12 D2.1) additions
  v_pin_thr_abs   NUMERIC;
  v_pin_thr_pct   NUMERIC;
  v_approver_auth UUID;
  v_pin_required  BOOLEAN := FALSE;
  -- S67 (12 D2.2/D2.3) additions
  v_denom_enabled BOOLEAN;
  v_qris_expected NUMERIC(14,2);
  v_card_expected NUMERIC(14,2);
  v_qris_variance NUMERIC(14,2);
  v_card_variance NUMERIC(14,2);
  v_denom_total   NUMERIC(14,2) := 0;
  v_denom_key     TEXT;
  v_denom_val     JSONB;
  v_note_volets   TEXT[] := ARRAY[]::TEXT[];
  v_pin_volets    TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_session_id IS NULL THEN
    RAISE EXCEPTION 'session_id_required' USING ERRCODE = 'P0001';
  END IF;
  IF p_counted_cash IS NULL OR p_counted_cash < 0 THEN
    RAISE EXCEPTION 'counted_cash_invalid' USING ERRCODE = 'P0001';
  END IF;
  -- S67: negative non-cash counts are input errors (NULL stays allowed).
  IF p_counted_qris IS NOT NULL AND p_counted_qris < 0 THEN
    RAISE EXCEPTION 'counted_method_invalid'
      USING ERRCODE = 'P0001', DETAIL = 'p_counted_qris must be >= 0';
  END IF;
  IF p_counted_card IS NOT NULL AND p_counted_card < 0 THEN
    RAISE EXCEPTION 'counted_method_invalid'
      USING ERRCODE = 'P0001', DETAIL = 'p_counted_card must be >= 0';
  END IF;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  SELECT id INTO v_profile FROM user_profiles
    WHERE auth_user_id = v_uid AND deleted_at IS NULL LIMIT 1;
  IF v_profile IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;
  IF NOT public.has_permission(v_uid, 'shift.close') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0003';
  END IF;

  -- Lock + read session.
  SELECT status::text, opening_cash, cash_in_total, cash_out_total
    INTO v_status, v_opening, v_in_tot, v_out_tot
    FROM pos_sessions WHERE id = p_session_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'session_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_status <> 'open' THEN
    -- Idempotent replay: return existing close state. MUST run before every
    -- guard below — a replay on an already-closed session never needs a note
    -- (S60), a manager PIN (S66) nor a denomination grid (S67).
    RETURN jsonb_build_object(
      'session_id', p_session_id,
      'status', v_status,
      'idempotent_replay', TRUE
    );
  END IF;

  -- Cash sales for this session (paid orders, method='cash').
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_cash_sales
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_session_id
     AND o.status = 'paid'
     AND op.method = 'cash';

  v_expected := v_opening + v_cash_sales + v_in_tot - v_out_tot;
  v_variance := p_counted_cash - v_expected;

  -- S67 (12 D2.2): expected per non-cash volet, mirror of the cash query.
  -- QRIS = method 'qris'; card volet = 'card' + 'edc' merged (owner decision).
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_qris_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_session_id
     AND o.status = 'paid'
     AND op.method = 'qris';
  SELECT COALESCE(SUM(op.amount), 0)
    INTO v_card_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_session_id
     AND o.status = 'paid'
     AND op.method IN ('card', 'edc');
  v_qris_variance := CASE WHEN p_counted_qris IS NULL THEN NULL
                          ELSE p_counted_qris - v_qris_expected END;
  v_card_variance := CASE WHEN p_counted_card IS NULL THEN NULL
                          ELSE p_counted_card - v_card_expected END;

  -- S60 (12 D1.4) + S66 (12 D2.1) + S67: one SELECT pulls all thresholds and
  -- the denomination-count flag.
  SELECT bc.shift_variance_threshold_abs, bc.shift_variance_threshold_pct,
         bc.shift_variance_pin_threshold_abs, bc.shift_variance_pin_threshold_pct,
         bc.shift_denomination_count_enabled
    INTO v_thr_abs, v_thr_pct, v_pin_thr_abs, v_pin_thr_pct, v_denom_enabled
  FROM business_config bc
  LIMIT 1;

  -- S67 (12 D2.3): denomination grid — required when the config flag is ON;
  -- always validated when provided (a voluntary grid is still checked).
  IF COALESCE(v_denom_enabled, FALSE) AND p_denominations IS NULL THEN
    RAISE EXCEPTION 'denominations_required'
      USING ERRCODE = 'P0001',
            DETAIL = 'shift_denomination_count_enabled is on; the closing cash count must provide the denomination grid';
  END IF;
  IF p_denominations IS NOT NULL THEN
    IF jsonb_typeof(p_denominations) <> 'object' THEN
      RAISE EXCEPTION 'invalid_denomination'
        USING ERRCODE = 'P0001', DETAIL = 'p_denominations must be a JSON object';
    END IF;
    FOR v_denom_key, v_denom_val IN SELECT key, value FROM jsonb_each(p_denominations) LOOP
      -- Canonical IDR allowlist — mirror of packages/domain/src/cash/denominations.ts.
      IF v_denom_key NOT IN ('100000','50000','20000','10000','5000','2000','1000','500','200','100') THEN
        RAISE EXCEPTION 'invalid_denomination'
          USING ERRCODE = 'P0001', DETAIL = format('unknown denomination %s', v_denom_key);
      END IF;
      IF jsonb_typeof(v_denom_val) <> 'number'
         OR (v_denom_val #>> '{}')::NUMERIC < 0
         OR (v_denom_val #>> '{}')::NUMERIC <> floor((v_denom_val #>> '{}')::NUMERIC) THEN
        RAISE EXCEPTION 'invalid_denomination'
          USING ERRCODE = 'P0001', DETAIL = format('denomination %s quantity must be a non-negative integer', v_denom_key);
      END IF;
      v_denom_total := v_denom_total + v_denom_key::NUMERIC * (v_denom_val #>> '{}')::NUMERIC;
    END LOOP;
    IF v_denom_total <> p_counted_cash THEN
      RAISE EXCEPTION 'denomination_total_mismatch'
        USING ERRCODE = 'P0001',
              DETAIL = format('denomination grid total %s does not match counted cash %s', v_denom_total, p_counted_cash);
    END IF;
  END IF;

  -- S60 (12 D1.4): variance note enforced server-side.
  -- S67 (12 D2.2): the predicate becomes an OR over the counted volets — same
  -- thresholds, pct relative to each volet's expected (skipped when 0).
  IF ABS(v_variance) >= COALESCE(v_thr_abs, 50000)
     OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_thr_pct, 0.005)) THEN
    v_note_volets := v_note_volets || 'cash';
  END IF;
  IF v_qris_variance IS NOT NULL AND (
       ABS(v_qris_variance) >= COALESCE(v_thr_abs, 50000)
       OR (v_qris_expected > 0 AND ABS(v_qris_variance) / v_qris_expected >= COALESCE(v_thr_pct, 0.005)) ) THEN
    v_note_volets := v_note_volets || 'qris';
  END IF;
  IF v_card_variance IS NOT NULL AND (
       ABS(v_card_variance) >= COALESCE(v_thr_abs, 50000)
       OR (v_card_expected > 0 AND ABS(v_card_variance) / v_card_expected >= COALESCE(v_thr_pct, 0.005)) ) THEN
    v_note_volets := v_note_volets || 'card';
  END IF;
  IF array_length(v_note_volets, 1) IS NOT NULL
     AND COALESCE(btrim(p_notes), '') = '' THEN
    RAISE EXCEPTION 'variance_note_required'
      USING ERRCODE = 'P0001',
            DETAIL = format('variance exceeds threshold on volet(s) %s; a note is mandatory', array_to_string(v_note_volets, ', '));
  END IF;

  -- S66 (12 D2.1): above the (higher) PIN threshold, a designated manager must
  -- approve with their PIN. S67: OR over the counted volets, same shape as the
  -- note guard above.
  IF ABS(v_variance) >= COALESCE(v_pin_thr_abs, 200000)
     OR (v_expected > 0 AND ABS(v_variance) / v_expected >= COALESCE(v_pin_thr_pct, 0.02)) THEN
    v_pin_volets := v_pin_volets || 'cash';
  END IF;
  IF v_qris_variance IS NOT NULL AND (
       ABS(v_qris_variance) >= COALESCE(v_pin_thr_abs, 200000)
       OR (v_qris_expected > 0 AND ABS(v_qris_variance) / v_qris_expected >= COALESCE(v_pin_thr_pct, 0.02)) ) THEN
    v_pin_volets := v_pin_volets || 'qris';
  END IF;
  IF v_card_variance IS NOT NULL AND (
       ABS(v_card_variance) >= COALESCE(v_pin_thr_abs, 200000)
       OR (v_card_expected > 0 AND ABS(v_card_variance) / v_card_expected >= COALESCE(v_pin_thr_pct, 0.02)) ) THEN
    v_pin_volets := v_pin_volets || 'card';
  END IF;
  IF array_length(v_pin_volets, 1) IS NOT NULL THEN
    v_pin_required := TRUE;

    IF p_approver_id IS NULL OR COALESCE(btrim(p_manager_pin), '') = '' THEN
      RAISE EXCEPTION 'pin_approval_required'
        USING ERRCODE = 'P0001',
              DETAIL = format('variance exceeds manager-approval threshold on volet(s) %s; a designated approver and PIN are mandatory', array_to_string(v_pin_volets, ', '));
    END IF;

    -- Resolve the approver and check the dedicated permission (via their auth
    -- uid so user_permission_overrides are honoured by has_permission).
    SELECT up.auth_user_id INTO v_approver_auth
      FROM user_profiles up
     WHERE up.id = p_approver_id
       AND up.is_active = TRUE
       AND up.deleted_at IS NULL;
    IF v_approver_auth IS NULL
       OR NOT public.has_permission(v_approver_auth, 'shift.variance.approve') THEN
      RAISE EXCEPTION 'approver_not_authorized' USING ERRCODE = 'P0003';
    END IF;

    -- 6-digit format check BEFORE the lockout helper: format typos are not
    -- brute-force signals and must not consume failed attempts (mirror of
    -- manager-pin.ts, which skips the fail bucket on invalid_pin_format).
    IF p_manager_pin !~ '^\d{6}$' THEN
      RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
    END IF;
    IF NOT public._verify_pin_with_lockout(p_approver_id, p_manager_pin) THEN
      RAISE EXCEPTION 'invalid_pin' USING ERRCODE = 'P0003';
    END IF;
  END IF;

  -- Fiscal period guard (use today's date for variance JE).
  PERFORM check_fiscal_period_open(v_today);

  -- Persist close.
  UPDATE pos_sessions
     SET status         = 'closed',
         closed_at      = now(),
         closed_by      = v_uid,
         closing_cash   = p_counted_cash,
         expected_cash  = v_expected,
         variance_total = v_variance,
         closing_notes  = p_notes,
         variance_approved_by = CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END,
         counted_qris   = p_counted_qris,
         counted_card   = p_counted_card,
         closing_denominations = p_denominations
   WHERE id = p_session_id;

  -- Emit variance JE only if non-zero. (Cash only — S67 owner decision: no
  -- automatic JE on QRIS/card variances, they are usually settlement timing.)
  IF v_variance <> 0 THEN
    -- Idempotency: one JE per session for shift_close.
    SELECT id INTO v_je_existing
      FROM journal_entries
     WHERE reference_type = 'shift_close' AND reference_id = p_session_id
     LIMIT 1;

    IF v_je_existing IS NULL THEN
      v_cash_acc  := resolve_mapping_account('SALE_PAYMENT_CASH');  -- 1110
      v_over_acc  := resolve_mapping_account('SHIFT_CASH_VARIANCE_INCOME');  -- 4910
      v_short_acc := resolve_mapping_account('SHIFT_CASH_VARIANCE_EXPENSE'); -- 5910

      v_entry_no := next_journal_entry_number(v_today);

      INSERT INTO journal_entries (
        entry_number, entry_date, description, reference_type, reference_id,
        status, total_debit, total_credit, created_by
      ) VALUES (
        v_entry_no, v_today,
        'Shift close variance (session ' || p_session_id::text || ')',
        'shift_close', p_session_id, 'posted',
        ABS(v_variance), ABS(v_variance), v_profile
      ) RETURNING id INTO v_je_id;

      IF v_variance > 0 THEN
        -- OVER: DR Cash / CR variance income
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_cash_acc, v_variance, 0, 'Cash overage'),
          (v_je_id, v_over_acc, 0, v_variance, 'Shift variance income (over)');
      ELSE
        -- SHORT: DR variance expense / CR Cash
        INSERT INTO journal_entry_lines (journal_entry_id, account_id, debit, credit, description) VALUES
          (v_je_id, v_short_acc, ABS(v_variance), 0, 'Shift variance expense (short)'),
          (v_je_id, v_cash_acc,  0, ABS(v_variance), 'Cash shortage');
      END IF;
    ELSE
      v_je_id := v_je_existing;
    END IF;
  END IF;

  -- Legacy audit row (kept from v1 — audit_log table).
  INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)
  VALUES (
    'shift.close', 'pos_sessions', p_session_id,
    jsonb_build_object(
      'opening_cash', v_opening,
      'cash_sales',   v_cash_sales,
      'cash_in_total', v_in_tot,
      'cash_out_total', v_out_tot,
      'counted_cash', p_counted_cash,
      'expected_cash', v_expected,
      'variance', v_variance,
      'journal_entry_id', v_je_id,
      'idempotency_key', p_idempotency_key,
      'variance_approved_by', CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END,
      'pin_approval_required', v_pin_required,
      'counted_qris', p_counted_qris,
      'expected_qris', v_qris_expected,
      'variance_qris', v_qris_variance,
      'counted_card', p_counted_card,
      'expected_card', v_card_expected,
      'variance_card', v_card_variance,
      'denominations_provided', p_denominations IS NOT NULL
    ),
    v_profile
  );

  -- S29: build snapshot and insert z_reports draft row.
  v_snapshot := _build_zreport_snapshot(p_session_id);

  INSERT INTO z_reports (shift_id, snapshot, status)
  VALUES (p_session_id, v_snapshot, 'draft')
  RETURNING id INTO v_zreport_id;

  -- Canonical audit row for z_report creation (audit_logs table, S25 pattern).
  INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
  VALUES (
    v_uid,
    'zreport.draft_created',
    'z_report',
    v_zreport_id,
    jsonb_build_object('shift_id', p_session_id)
  );

  RETURN jsonb_build_object(
    'session_id', p_session_id,
    'status', 'closed',
    'opening_cash', v_opening,
    'cash_sales', v_cash_sales,
    'cash_in_total', v_in_tot,
    'cash_out_total', v_out_tot,
    'counted_cash', p_counted_cash,
    'expected_cash', v_expected,
    'variance', v_variance,
    'journal_entry_id', v_je_id,
    'zreport_id', v_zreport_id,
    'variance_approved_by', CASE WHEN v_pin_required THEN p_approver_id ELSE NULL END,
    'counted_qris', p_counted_qris,
    'expected_qris', v_qris_expected,
    'variance_qris', v_qris_variance,
    'counted_card', p_counted_card,
    'expected_card', v_card_expected,
    'variance_card', v_card_variance,
    'idempotent_replay', FALSE
  );
END;
$function$;

DROP FUNCTION public.close_shift_v4(uuid, numeric, text, uuid, uuid, text);

-- S20 trio: anon defense-in-depth (Supabase auto-grants EXECUTE to PUBLIC,
-- which anon inherits — REVOKE both explicitly). The POS calls v5 with a
-- direct user JWT, so `authenticated` keeps EXECUTE.
REVOKE ALL ON FUNCTION public.close_shift_v5(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_shift_v5(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_shift_v5(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) TO authenticated;

COMMENT ON FUNCTION public.close_shift_v5(uuid, numeric, text, uuid, uuid, text, numeric, numeric, jsonb) IS
  'S67 (12 D2.2/D2.3): bump of close_shift_v4 (dropped in this migration). '
  'Adds three-way reconciliation (p_counted_qris, p_counted_card — NULL = volet '
  'not counted; card volet = card+edc merged) with the note (S60) and manager-PIN '
  '(S66) guards extended as an OR over the counted volets, and the opt-in IDR '
  'denomination grid (p_denominations, enforced when '
  'business_config.shift_denomination_count_enabled). New errors (P0001): '
  'counted_method_invalid, denominations_required, denomination_total_mismatch, '
  'invalid_denomination. Cash variance JE unchanged; NO automatic JE on non-cash '
  'variances (owner decision). Idempotent replay exits before every guard.';
```

- [ ] **Step 2 [CONTROLLER]: Verify live v4 body matches `_119`, then apply**

`execute_sql`: `SELECT pg_get_functiondef('public.close_shift_v4(uuid,numeric,text,uuid,uuid,text)'::regprocedure);` — comparer au fichier `_119` (hors en-tête CREATE). Si divergence : STOP, reporter, ré-intégrer depuis le live. Sinon `apply_migration` name=`close_shift_v5_three_way_denominations`.

- [ ] **Step 3 [CONTROLLER]: Smoke-verify**

`execute_sql`:
```sql
SELECT proname FROM pg_proc WHERE proname IN ('close_shift_v4','close_shift_v5');
```
Expected: une seule ligne `close_shift_v5`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000122_close_shift_v5_three_way_denominations.sql
git commit -m "feat(db): close_shift_v5 — 3 volets (gardes OR, zéro JE non-cash) + grille coupures enforced [S67 T3]"
```

---

### Task 4: Migration `_123` — `_build_zreport_snapshot` + `reconciliation`

**Files:**
- Create: `supabase/migrations/20260710000123_zreport_snapshot_reconciliation.sql`

**Interfaces:**
- Consumes: corps **live** de `_build_zreport_snapshot(uuid)` (`pg_get_functiondef`) ; colonnes Task 2.
- Produces: clés snapshot `reconciliation` `{cash|qris|card: {expected, counted, variance}}` (counted/variance `null` si volet non compté) et `denominations` (grille de clôture ou `null`). Consommées par Tasks 6 et 13.

- [ ] **Step 1 [CONTROLLER]: Récupérer le corps live**

`execute_sql`: `SELECT pg_get_functiondef('public._build_zreport_snapshot(uuid)'::regprocedure);` → coller le corps intégral dans le fichier de migration, puis appliquer les 3 insertions du Step 2. (In-place : signature inchangée, REVOKE existants conservés — pas de re-REVOKE nécessaire, mais le fichier les répète par sûreté.)

- [ ] **Step 2: Write the migration file (corps live + insertions)**

En-tête du fichier :

```sql
-- 20260710000123_zreport_snapshot_reconciliation.sql
-- S67 (12 D2.2/D2.3) — _build_zreport_snapshot in-place : fige le
-- rapprochement 3 volets et la grille de coupures dans le snapshot Z.
-- Le RPC close_shift_v5 UPDATE pos_sessions AVANT d'appeler ce helper — les
-- colonnes counted_qris/counted_card/closing_denominations sont déjà posées.
-- Expected par volet recalculé ici avec les MÊMES requêtes que le RPC
-- (orders paid — attention : totals_by_payment_method, lui, exclut seulement
-- voided ; les deux définitions coexistent volontairement, le reconciliation
-- doit être byte-consistent avec la variance persistée).
-- DEV-S57-02 : corps repris du live via pg_get_functiondef.
```

Insertion A — dans le bloc `DECLARE` du corps live, ajouter :

```sql
  -- S67 additions
  v_qris_expected NUMERIC;
  v_card_expected NUMERIC;
```

Insertion B — juste avant le `v_snapshot := jsonb_build_object(` final :

```sql
  -- S67 (12 D2.2): expected per non-cash volet, mirror of close_shift_v5.
  SELECT COALESCE(SUM(op.amount), 0) INTO v_qris_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_shift_id
     AND o.status = 'paid'
     AND op.method = 'qris';
  SELECT COALESCE(SUM(op.amount), 0) INTO v_card_expected
    FROM order_payments op
    JOIN orders o ON o.id = op.order_id
   WHERE o.session_id = p_shift_id
     AND o.status = 'paid'
     AND op.method IN ('card', 'edc');
```

Insertion C — dans le `jsonb_build_object(...)` final, ajouter après `'expenses_cash_total', v_expenses_cash,` :

```sql
    'reconciliation',        jsonb_build_object(
      'cash', jsonb_build_object(
        'expected', v_session.expected_cash,
        'counted',  v_session.closing_cash,
        'variance', COALESCE(v_session.closing_cash - v_session.expected_cash, 0)
      ),
      'qris', jsonb_build_object(
        'expected', v_qris_expected,
        'counted',  v_session.counted_qris,
        'variance', CASE WHEN v_session.counted_qris IS NULL THEN NULL
                         ELSE v_session.counted_qris - v_qris_expected END
      ),
      'card', jsonb_build_object(
        'expected', v_card_expected,
        'counted',  v_session.counted_card,
        'variance', CASE WHEN v_session.counted_card IS NULL THEN NULL
                         ELSE v_session.counted_card - v_card_expected END
      )
    ),
    'denominations',         v_session.closing_denominations,
```

Fin de fichier (répéter la posture ACL du live) :

```sql
REVOKE EXECUTE ON FUNCTION _build_zreport_snapshot(UUID) FROM PUBLIC, anon, authenticated;
```

- [ ] **Step 3 [CONTROLLER]: Apply + verify**

`apply_migration` name=`zreport_snapshot_reconciliation`. Puis `execute_sql` (BEGIN/ROLLBACK) : fermer une session fixture via `close_shift_v5` et vérifier `snapshot ? 'reconciliation'` sur la ligne `z_reports` créée — ou plus simple : la suite Task 6 (T2) le pin. Minimum ici : `SELECT pg_get_functiondef('public._build_zreport_snapshot(uuid)'::regprocedure) LIKE '%reconciliation%';` → `t`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260710000123_zreport_snapshot_reconciliation.sql
git commit -m "feat(db): snapshot Z — section reconciliation 3 volets + grille coupures [S67 T4]"
```

---

### Task 5: Migration `_124` — settings RPCs + types regen

**Files:**
- Create: `supabase/migrations/20260710000124_settings_rpcs_denomination_flag.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen intégral)

**Interfaces:**
- Consumes: corps **live** de `get_settings_by_category_v1(text)` et `set_setting_v1(text, jsonb)` (`pg_get_functiondef` — S66 `_120` les a modifiés en dernier).
- Produces: clé `shift_denomination_count_enabled` dans la catégorie `pos` (get + set, validation boolean). Types regénérés (colonnes Task 2 + signature v5). Consommés par Tasks 8 et 12.

- [ ] **Step 1 [CONTROLLER]: Récupérer les 2 corps live**

`execute_sql`: `SELECT pg_get_functiondef('public.get_settings_by_category_v1(text)'::regprocedure);` puis idem pour `set_setting_v1(text, jsonb)`.

- [ ] **Step 2: Write the migration file**

En-tête + les deux `CREATE OR REPLACE` in-place (corps live) avec ces insertions exactes :

Dans `get_settings_by_category_v1`, branche `WHEN 'pos' THEN jsonb_build_object(` — ajouter une clé :

```sql
      WHEN 'pos' THEN jsonb_build_object(
        'shift_variance_threshold_pct', v_row.shift_variance_threshold_pct,
        'shift_variance_threshold_abs', v_row.shift_variance_threshold_abs,
        'shift_variance_pin_threshold_pct', v_row.shift_variance_pin_threshold_pct,
        'shift_variance_pin_threshold_abs', v_row.shift_variance_pin_threshold_abs,
        'shift_denomination_count_enabled', v_row.shift_denomination_count_enabled
      )
```

Dans `set_setting_v1`, ajouter un `WHEN` (miroir du case boolean `tax_inclusive` existant — vérifier sa forme dans le corps live) après le case `shift_variance_pin_threshold_abs` :

```sql
    WHEN 'shift_denomination_count_enabled' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'shift_denomination_count_enabled expects boolean';
      END IF;
      SELECT to_jsonb(shift_denomination_count_enabled) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET shift_denomination_count_enabled = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;
```

En-tête de fichier :

```sql
-- 20260710000124_settings_rpcs_denomination_flag.sql
-- S67 (12 D2.3) — expose business_config.shift_denomination_count_enabled
-- (_121) dans le couple settings BO : get_settings_by_category_v1 branche
-- 'pos' +1 clé ; set_setting_v1 +1 WHEN (validation boolean, audit old/new
-- hérité). In-place (signatures inchangées) — corps repris DU LIVE via
-- pg_get_functiondef (DEV-S57-02 : S66 _120 les a modifiés en dernier).
```

- [ ] **Step 3 [CONTROLLER]: Apply + verify + types regen**

`apply_migration` name=`settings_rpcs_denomination_flag`. Verify : `execute_sql` `SELECT get_settings_by_category_v1('pos');` sous un JWT admin de test (ou vérifier `pg_get_functiondef` contient la clé). Puis `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`.

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm --filter @breakery/supabase typecheck
git add supabase/migrations/20260710000124_settings_rpcs_denomination_flag.sql packages/supabase/src/types.generated.ts
git commit -m "feat(db): settings RPCs +shift_denomination_count_enabled ; types regen v5 [S67 T5]"
```

---

### Task 6: pgTAP `close_shift_three_way.test.sql` (nouvelle suite)

**Files:**
- Create: `supabase/tests/close_shift_three_way.test.sql`

**Interfaces:**
- Consumes: `close_shift_v5` (Task 3), snapshot `reconciliation` (Task 4), fixtures pattern `close_shift_pin_gate.test.sql` (EMP003 caller, sessions UUID `67c5...`).
- Produces: suite ancrée 14 asserts — exécutée live par le contrôleur.

- [ ] **Step 1: Write the suite**

```sql
-- supabase/tests/close_shift_three_way.test.sql
-- S67 (12 D2.2/D2.3) — close_shift_v5 : comptage 3 volets + grille coupures.
--   T1  : nouveaux args NULL + flag OFF -> comportement v4 (non-régression)
--   T2  : counted qris/card fournis -> persist + variances dans le retour…
--   T2b : … et section reconciliation + denominations dans le snapshot Z
--   T3  : écart QRIS seul (cash équilibré) au-dessus du seuil note sans note
--         -> variance_note_required (P0001)
--   T4  : écart carte seul au-dessus du seuil PIN (note fournie)
--         -> pin_approval_required (P0001)
--   T5  : flag ON sans grille -> denominations_required (P0001)
--   T6  : grille dont le total != counted_cash -> denomination_total_mismatch
--   T7  : clé de coupure inconnue -> invalid_denomination
--   T7b : quantité fractionnaire -> invalid_denomination
--   T8  : p_counted_qris < 0 -> counted_method_invalid
--   T9  : happy path flag ON, grille valide -> closed + closing_denominations
--   T9b : … et zéro JE non-cash (aucune JE shift_close si variance cash = 0)
--   T10 : replay sur session fermée -> idempotent_replay, gardes (grille
--         comprise, flag ON) court-circuitées
-- Run via MCP execute_sql (BEGIN/ROLLBACK envelope).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(14);

-- ===========================================================================
-- Fixtures (pattern close_shift_pin_gate) : caller EMP003 (shift.close).
-- Sessions SANS commandes -> expected cash = opening ; expected qris/card = 0.
--  - s1 (opening 500 000) : T1 — compté 500 000, variance 0 partout.
--  - s2 (opening 500 000) : T2 — compté cash 500 000 + qris 30 000/card 20 000
--    comptés avec note (variance qris +30 000 < 50 000, card +20 000 < 50 000
--    -> aucune garde) ; pin le persist + le snapshot.
--  - s3 (opening 500 000) : T3/T4 — cash équilibré, écarts non-cash.
--  - s4 (opening 352 000) : T5..T9 — grille de coupures (3×100 000 + 1×50 000
--    + 4×500 = 352 000).
-- Flag OFF par défaut ; T5..T10 le passent à ON (rollback final).
-- ===========================================================================
DO $fixture$
DECLARE
  v_mgr_auth UUID; v_mgr_prof UUID;
  v_o2 UUID; v_o3 UUID; v_o4 UUID;
BEGIN
  SELECT auth_user_id, id INTO v_mgr_auth, v_mgr_prof
    FROM user_profiles WHERE employee_code = 'EMP003' AND deleted_at IS NULL;
  IF v_mgr_prof IS NULL THEN RAISE EXCEPTION 'fixture: EMP003 profile not found'; END IF;
  PERFORM set_config('request.jwt.claim.sub', v_mgr_auth::text, true);

  -- 3 propriétaires libres (exclusion one_open_session_per_user) pour s2..s4.
  SELECT up.id INTO v_o2 FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id <> v_mgr_prof
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  SELECT up.id INTO v_o3 FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id NOT IN (v_mgr_prof, v_o2)
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  SELECT up.id INTO v_o4 FROM user_profiles up
   WHERE up.deleted_at IS NULL AND up.id NOT IN (v_mgr_prof, v_o2, v_o3)
     AND NOT EXISTS (SELECT 1 FROM pos_sessions ps WHERE ps.opened_by = up.id AND ps.status = 'open')
   LIMIT 1;
  IF v_o4 IS NULL THEN RAISE EXCEPTION 'fixture: not enough free profiles'; END IF;

  INSERT INTO pos_sessions (id, opened_by, opening_cash, status) VALUES
    ('67c50001-0000-0000-0000-000000000001', v_mgr_prof, 500000, 'open'),
    ('67c50001-0000-0000-0000-000000000002', v_o2,       500000, 'open'),
    ('67c50001-0000-0000-0000-000000000003', v_o3,       500000, 'open'),
    ('67c50001-0000-0000-0000-000000000004', v_o4,       352000, 'open');
END $fixture$;

-- T1 — non-régression : nouveaux args absents, flag OFF, variance 0.
SELECT lives_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000001'::uuid, 500000)$$,
  'T1: v4-shaped call (no new args, flag off) still closes'
);

-- T2 — volets comptés sous seuils (+30k qris / +20k card, note fournie par
-- prudence de bande pct expected=0 -> pct skippé, abs < 50k -> pas de garde).
DO $t2$
DECLARE v_res JSONB;
BEGIN
  v_res := close_shift_v5('67c50001-0000-0000-0000-000000000002'::uuid, 500000,
                          NULL, NULL, NULL, NULL, 30000, 20000, NULL);
  PERFORM set_config('s67.t2',
    (v_res ->> 'variance_qris' = '30000' AND v_res ->> 'variance_card' = '20000')::text, false);
END $t2$;
SELECT ok(current_setting('s67.t2')::boolean,
  'T2: counted qris/card -> per-volet variances in the return envelope');

SELECT is(
  (SELECT (counted_qris = 30000 AND counted_card = 20000
           AND (zr.snapshot #>> '{reconciliation,qris,variance}')::numeric = 30000
           AND (zr.snapshot #>> '{reconciliation,card,counted}')::numeric = 20000
           AND zr.snapshot ? 'denominations')
     FROM pos_sessions ps
     JOIN z_reports zr ON zr.shift_id = ps.id
    WHERE ps.id = '67c50001-0000-0000-0000-000000000002'),
  TRUE,
  'T2b: counted persisted on pos_sessions and frozen in snapshot.reconciliation'
);

-- T3 — écart QRIS seul >= 50 000 (abs), cash équilibré, PAS de note.
SELECT throws_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000003'::uuid, 500000,
                          NULL, NULL, NULL, NULL, 60000, NULL, NULL)$$,
  'P0001', 'variance_note_required',
  'T3: QRIS-only variance above note threshold without a note -> variance_note_required'
);

-- T4 — écart carte seul >= 200 000 (abs), note fournie, pas d'approbateur.
SELECT throws_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000003'::uuid, 500000,
                          'terminal settlement missing a batch', NULL, NULL, NULL, NULL, 250000, NULL)$$,
  'P0001', 'pin_approval_required',
  'T4: card-only variance above PIN threshold -> pin_approval_required'
);

-- Flag ON pour T5..T10 (rollback final = sans trace).
UPDATE business_config SET shift_denomination_count_enabled = TRUE WHERE id = 1;

-- T5 — flag ON sans grille.
SELECT throws_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000004'::uuid, 352000)$$,
  'P0001', 'denominations_required',
  'T5: flag on without a grid -> denominations_required'
);

-- T6 — total de grille != counted_cash.
SELECT throws_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"100000": 3, "50000": 1}'::jsonb)$$,
  'P0001', 'denomination_total_mismatch',
  'T6: grid total 350000 != counted 352000 -> denomination_total_mismatch'
);

-- T7 — coupure inconnue.
SELECT throws_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"75000": 4, "50000": 1, "500": 4}'::jsonb)$$,
  'P0001', 'invalid_denomination',
  'T7: unknown denomination 75000 -> invalid_denomination'
);

-- T7b — quantité fractionnaire.
SELECT throws_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"100000": 3.5, "2000": 1}'::jsonb)$$,
  'P0001', 'invalid_denomination',
  'T7b: fractional quantity -> invalid_denomination'
);

-- T8 — comptage négatif.
SELECT throws_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, -1, NULL, NULL)$$,
  'P0001', 'counted_method_invalid',
  'T8: negative counted qris -> counted_method_invalid'
);

-- T9 — happy path grille valide (352 000 = 3×100k + 1×50k + 4×500).
SELECT lives_ok(
  $$SELECT close_shift_v5('67c50001-0000-0000-0000-000000000004'::uuid, 352000,
                          NULL, NULL, NULL, NULL, NULL, NULL,
                          '{"100000": 3, "50000": 1, "500": 4}'::jsonb)$$,
  'T9: flag on with a valid grid -> close succeeds'
);

SELECT is(
  (SELECT (status::text = 'closed'
           AND closing_denominations = '{"100000": 3, "50000": 1, "500": 4}'::jsonb)
     FROM pos_sessions WHERE id = '67c50001-0000-0000-0000-000000000004'),
  TRUE,
  'T9a: closing_denominations persisted'
);

-- T9b — zéro JE : variance cash = 0 sur s4, et surtout AUCUNE JE née des
-- volets non-cash de s2/s3 (l'écart qris/card ne produit jamais d'écriture).
SELECT is(
  (SELECT COUNT(*)::int FROM journal_entries
    WHERE reference_type = 'shift_close'
      AND reference_id IN ('67c50001-0000-0000-0000-000000000002',
                           '67c50001-0000-0000-0000-000000000004')),
  0,
  'T9b: no shift_close JE for zero-cash-variance sessions (non-cash variances never emit one)'
);

-- T10 — replay flag ON : sort avant toutes les gardes (grille comprise).
DO $t10$
DECLARE v_res JSONB; v_caught BOOLEAN := false;
BEGIN
  BEGIN
    v_res := close_shift_v5('67c50001-0000-0000-0000-000000000004'::uuid, 352000);
  EXCEPTION WHEN OTHERS THEN
    v_caught := true;
  END;
  PERFORM set_config('s67.t10',
    (NOT v_caught AND v_res ->> 'idempotent_replay' = 'true')::text, false);
END $t10$;
SELECT ok(current_setting('s67.t10')::boolean,
  'T10: replay on closed session bypasses every guard incl. denominations_required');

SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 2 [CONTROLLER]: Run live**

Via `execute_sql` (la suite embarque déjà BEGIN/ROLLBACK) — gros fichier : utiliser le runner API-from-file si le tool-call tronque (mémoire projet `workflow_supabase_api_from_file_runner`). Capturer les `not ok` (pattern temp-table si besoin).
Expected: 14/14 ok.

**Note fixture** : si la base dev a des seuils `business_config` non-défauts, ajuster comme `close_shift_pin_gate` (les fixtures S66 posent des UPDATE en début de transaction — même approche autorisée ici : fixer les 4 seuils aux défauts 50 000/0.005/200 000/0.02 dans le DO fixture, rollback final).

- [ ] **Step 3: Commit**

```bash
git add supabase/tests/close_shift_three_way.test.sql
git commit -m "test(supabase): close_shift_three_way — 14 asserts 3 volets + coupures live [S67 T6]"
```

---

### Task 7: Repoint suites existantes v4 → v5

**Files:**
- Modify: `supabase/tests/close_shift_pin_gate.test.sql` (toutes les occurrences `close_shift_v4(` → `close_shift_v5(` — les appels sont positionnels sur les 6 premiers args, les 3 nouveaux ont des DEFAULT : aucun autre changement)
- Modify: `supabase/tests/close_shift_note_enforced.test.sql` (idem `close_shift_v3|v4` → `v5` selon l'état du fichier — vérifier, S66 l'a repointée v4)
- Modify: `supabase/tests/cash_register.test.sql` (idem)
- Modify: `supabase/tests/functions/cash-register-close.test.ts` (`.rpc('close_shift_v4'` → `'close_shift_v5'` + le type d'args suit types.generated)

**Interfaces:**
- Consumes: `close_shift_v5` (Task 3), types regen (Task 5).
- Produces: 3 suites pgTAP + 1 suite Vitest vertes sur v5.

- [ ] **Step 1: Repoint SQL suites**

Dans chacun des 3 fichiers SQL : remplacer le nom de fonction (`close_shift_v4` → `close_shift_v5`) dans les appels ET les commentaires d'en-tête qui citent la version courante. Ne toucher ni fixtures ni assertions.

- [ ] **Step 2 [CONTROLLER]: Run les 3 suites live**

`execute_sql` par fichier. Expected : `close_shift_pin_gate` 11/11 · `close_shift_note_enforced` 7/7 · `cash_register` 12/12.

- [ ] **Step 3: Repoint Vitest live-RPC + run**

Dans `cash-register-close.test.ts`, remplacer les appels `supabase.rpc('close_shift_v4', …)` par `'close_shift_v5'` (mêmes args — les nouveaux sont optionnels).
Run: `pnpm --filter @breakery/supabase test cash-register-close`
Expected: PASS (suite env-gated : si elle skippe faute d'env, le noter — baseline connue).

- [ ] **Step 4: Commit**

```bash
git add supabase/tests/close_shift_pin_gate.test.sql supabase/tests/close_shift_note_enforced.test.sql supabase/tests/cash_register.test.sql supabase/tests/functions/cash-register-close.test.ts
git commit -m "test(supabase): repoint suites close_shift v4->v5 [S67 T7]"
```

---

### Task 8: POS `useCloseShift` v5 + `useDenominationCountEnabled`

**Files:**
- Modify: `apps/pos/src/features/shift/hooks/useCloseShift.ts`
- Create: `apps/pos/src/features/shift/hooks/useDenominationCountEnabled.ts`
- Test: `apps/pos/src/features/shift/hooks/__tests__/useDenominationCountEnabled.test.tsx`

**Interfaces:**
- Consumes: `close_shift_v5` (types regen Task 5).
- Produces: `CloseShiftInput` + `counted_qris?: number; counted_card?: number; denominations?: Record<string, number>` ; `CloseShiftResult` + `counted_qris/expected_qris/variance_qris/counted_card/expected_card/variance_card: number | null` ; `useDenominationCountEnabled(): boolean` (fail-closed → `false` : une panne de config ne force jamais la grille). Consommés par Tasks 10-11.

- [ ] **Step 1: Write the failing test (hook flag)**

```tsx
// apps/pos/src/features/shift/hooks/__tests__/useDenominationCountEnabled.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

const maybeSingle = vi.fn();
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({ select: () => ({ limit: () => ({ maybeSingle }) }) }),
  },
}));

import { useDenominationCountEnabled } from '../useDenominationCountEnabled';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

describe('useDenominationCountEnabled', () => {
  it('returns true when business_config has the flag on', async () => {
    maybeSingle.mockResolvedValueOnce({ data: { shift_denomination_count_enabled: true }, error: null });
    const { result } = renderHook(() => useDenominationCountEnabled(), { wrapper });
    await waitFor(() => expect(result.current).toBe(true));
  });
  it('fails CLOSED to false on error (config outage never forces the grid)', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => useDenominationCountEnabled(), { wrapper });
    await waitFor(() => expect(result.current).toBe(false));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/pos test useDenominationCountEnabled`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Implement hook + bump useCloseShift**

```ts
// apps/pos/src/features/shift/hooks/useDenominationCountEnabled.ts
//
// S67 (12 D2.3) — flag business_config.shift_denomination_count_enabled.
// Miroir du pattern useEnabledPaymentMethods (SELECT direct sous JWT PIN),
// mais FAIL-CLOSED (false) : une panne de config ne doit jamais forcer la
// grille et bloquer une ouverture/clôture. Le serveur (close_shift_v5) reste
// l'autorité — si le flag est réellement ON et le client l'a raté, la clôture
// échoue en denominations_required et l'UI affiche le message mappé.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';

export function useDenominationCountEnabled(): boolean {
  const { data } = useQuery({
    queryKey: ['business-config', 'shift-denomination-count-enabled'],
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('shift_denomination_count_enabled')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data?.shift_denomination_count_enabled === true;
    },
  });
  return data === true;
}
```

Éditer `useCloseShift.ts` :
1. En-tête : ajouter la ligne `// S67 (12 D2.2/D2.3) — bumped to close_shift_v5: three-way count (qris/card) + opt-in denomination grid; new error codes mapped below.`
2. `CloseShiftInput` — ajouter :

```ts
  /** S67 — three-way count. Omit a volet when its method is disabled. */
  counted_qris?:  number;
  counted_card?:  number;
  /** S67 — closing-cash denomination grid {"100000": 3, ...}; required by the
   *  server when business_config.shift_denomination_count_enabled. */
  denominations?: Record<string, number>;
```

3. `CloseShiftResult` — ajouter :

```ts
  counted_qris:  number | null;
  expected_qris: number | null;
  variance_qris: number | null;
  counted_card:  number | null;
  expected_card: number | null;
  variance_card: number | null;
```

4. Dans `mutationFn`, étendre le type local `args` avec `p_counted_qris?: number; p_counted_card?: number; p_denominations?: Record<string, number>;` puis après les lignes `if (input.manager_pin …)` :

```ts
      if (input.counted_qris !== undefined)     args.p_counted_qris = input.counted_qris;
      if (input.counted_card !== undefined)     args.p_counted_card = input.counted_card;
      if (input.denominations !== undefined)    args.p_denominations = input.denominations;
```

5. `supabase.rpc('close_shift_v4', args)` → `supabase.rpc('close_shift_v5', args)`.
6. Après le mapping `account_locked`, ajouter :

```ts
        // S67 (12 D2.2/D2.3): three-way count + denomination grid (close_shift_v5).
        if (error.message.includes('denominations_required')) {
          throw new Error('Denomination count is required: count the drawer by denomination');
        }
        if (error.message.includes('denomination_total_mismatch')) {
          throw new Error('The denomination grid total does not match the counted cash');
        }
        if (error.message.includes('invalid_denomination')) {
          throw new Error('Invalid denomination grid — unknown note/coin or bad quantity');
        }
        if (error.message.includes('counted_method_invalid')) {
          throw new Error('Counted amounts must be zero or positive');
        }
```

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @breakery/pos test useDenominationCountEnabled` → PASS. `pnpm --filter @breakery/pos typecheck` → OK.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/shift/hooks/useCloseShift.ts apps/pos/src/features/shift/hooks/useDenominationCountEnabled.ts apps/pos/src/features/shift/hooks/__tests__/useDenominationCountEnabled.test.tsx
git commit -m "feat(pos): useCloseShift v5 (3 volets + grille) + useDenominationCountEnabled fail-closed [S67 T8]"
```

**Note (déviation spec assumée)** : la spec §4 propageait le flag via `useShiftCloseSummary` ; le hook dédié couvre AUSSI `OpenShiftModal` (pas de session ouverte → pas de summary). À consigner DEV-S67-xx dans l'INDEX.

---

### Task 9: POS `DenominationGrid`

**Files:**
- Create: `apps/pos/src/features/shift/components/DenominationGrid.tsx`
- Test: `apps/pos/src/features/shift/components/__tests__/DenominationGrid.smoke.test.tsx`

**Interfaces:**
- Consumes: `IDR_DENOMINATIONS`, `sumDenominations` (Task 1).
- Produces: `DenominationGrid({ value, onChange, 'data-testid'? }: { value: Record<string, number>; onChange: (next: Record<string, number>) => void })` — total auto affiché en pied ; consommé par Tasks 10-11.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// apps/pos/src/features/shift/components/__tests__/DenominationGrid.smoke.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { DenominationGrid } from '../DenominationGrid';

describe('DenominationGrid', () => {
  it('renders one row per IDR denomination with the running total', () => {
    render(<DenominationGrid value={{ '100000': 2, '500': 3 }} onChange={() => {}} />);
    expect(screen.getAllByTestId(/denom-row-/)).toHaveLength(10);
    expect(screen.getByTestId('denom-total')).toHaveTextContent('201.500');
  });
  it('increments a quantity via the + button', () => {
    const onChange = vi.fn();
    render(<DenominationGrid value={{}} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('denom-inc-50000'));
    expect(onChange).toHaveBeenCalledWith({ '50000': 1 });
  });
  it('never goes below zero via the - button', () => {
    const onChange = vi.fn();
    render(<DenominationGrid value={{ '1000': 0 }} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('denom-dec-1000'));
    expect(onChange).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @breakery/pos test DenominationGrid`
Expected: FAIL (module inexistant).

- [ ] **Step 3: Implement**

```tsx
// apps/pos/src/features/shift/components/DenominationGrid.tsx
//
// S67 (12 D2.3) — grille de comptage par coupure IDR (open + close shift).
// Total auto en pied — la saisie remplace le montant libre quand
// business_config.shift_denomination_count_enabled est ON. Cibles 44px.

import type { JSX } from 'react';
import { Minus, Plus } from 'lucide-react';
import { IDR_DENOMINATIONS, sumDenominations } from '@breakery/domain';
import { Currency } from '@breakery/ui';

export interface DenominationGridProps {
  value:    Record<string, number>;
  onChange: (next: Record<string, number>) => void;
}

export function DenominationGrid({ value, onChange }: DenominationGridProps): JSX.Element {
  const total = sumDenominations(value);

  function setQty(face: string, qty: number): void {
    if (qty < 0 || !Number.isInteger(qty)) return;
    onChange({ ...value, [face]: qty });
  }

  return (
    <div className="space-y-1" data-testid="denomination-grid">
      <div className="max-h-[40vh] overflow-y-auto rounded-md border border-border-subtle divide-y divide-border-subtle">
        {IDR_DENOMINATIONS.map((face) => {
          const key = String(face);
          const qty = value[key] ?? 0;
          return (
            <div
              key={key}
              data-testid={`denom-row-${key}`}
              className="flex items-center justify-between gap-2 bg-bg-input px-3 py-1.5"
            >
              <span className="w-24 font-mono tabular-nums text-sm text-text-secondary">
                <Currency amount={face} />
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  aria-label={`Remove one ${face}`}
                  data-testid={`denom-dec-${key}`}
                  onClick={() => { if (qty > 0) setQty(key, qty - 1); }}
                  className="h-11 w-11 grid place-items-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                >
                  <Minus className="h-4 w-4" aria-hidden />
                </button>
                <input
                  type="text"
                  inputMode="numeric"
                  aria-label={`Quantity of ${face}`}
                  data-testid={`denom-qty-${key}`}
                  value={String(qty)}
                  onChange={(e) => {
                    const n = Number(e.target.value.replace(/\D/g, '') || '0');
                    setQty(key, n);
                  }}
                  className="h-11 w-14 rounded-md border border-border-subtle bg-bg-overlay text-center font-mono tabular-nums text-sm focus:outline-none focus:border-gold"
                />
                <button
                  type="button"
                  aria-label={`Add one ${face}`}
                  data-testid={`denom-inc-${key}`}
                  onClick={() => setQty(key, qty + 1)}
                  className="h-11 w-11 grid place-items-center rounded-md border border-border-subtle text-text-secondary hover:text-text-primary hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center justify-between px-1 pt-1 text-sm">
        <span className="uppercase tracking-wide text-xs text-text-secondary">Total counted</span>
        <span className="font-mono tabular-nums text-text-primary" data-testid="denom-total">
          {total.toLocaleString('id-ID')}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @breakery/pos test DenominationGrid`
Expected: PASS (3 tests). (Si `Currency` rend un format différent de `201.500`, caler l'assertion sur le rendu réel de `toLocaleString('id-ID')` — le total utilise ce format directement.)

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/shift/components/DenominationGrid.tsx apps/pos/src/features/shift/components/__tests__/DenominationGrid.smoke.test.tsx
git commit -m "feat(pos): DenominationGrid — grille coupures IDR total auto, cibles 44px [S67 T9]"
```

---

### Task 10: POS `CloseShiftModal` — 3 volets + grille + review par volet

**Files:**
- Modify: `apps/pos/src/features/shift/components/CloseShiftModal.tsx`
- Modify: `apps/pos/src/features/shift/__tests__/CloseShiftModal.smoke.test.tsx`

**Interfaces:**
- Consumes: `useCloseShift` v5 + `useDenominationCountEnabled` (Task 8), `DenominationGrid` (Task 9), `useEnabledPaymentMethods` (S64, `@/features/settings/hooks/useEnabledPaymentMethods`), `shouldShowWarning` (existant).
- Produces: modal 2 étapes inchangé dans sa structure ; props **inchangées** (aucun changement Pos.tsx).

**Comportement cible (résumé exécutable) :**
- Étape `count` (blind) : section cash = Numpad existant OU `DenominationGrid` si `useDenominationCountEnabled()` (le total de grille devient `counted`) ; puis input « QRIS total (terminal) » si `qris` ∈ `useEnabledPaymentMethods()` ; puis input « Card + EDC total (terminal) » si `card` OU `edc` activé. Les 2 inputs non-cash sont **obligatoires quand visibles** (0 accepté) — bouton « Confirm count » désactivé sinon. Aucun expected affiché.
- Étape `review` : tableau 1-3 lignes (volet, counted, expected, variance colorée — expected/variance non-cash calculés client à partir de… **rien** : le client ne connaît pas l'expected non-cash avant l'appel). **Décision d'implémentation** : à l'étape review, seules les lignes **cash** montrent expected/variance (données `useShiftCloseSummary` existantes) ; les volets non-cash affichent le counted saisi avec la mention « reconciled server-side at close ». Les gardes UI (note/PIN) restent calées sur la variance **cash** ; les gardes serveur sur les volets non-cash remontent via les messages mappés de `useCloseShift` (toast) — le serveur est l'autorité (même philosophie que S66 « the RPC is the authority »). Consigner cette précision comme DEV-S67-xx (la spec disait « tableau par volet expected/counted/variance » — l'expected non-cash pré-close exigerait une requête order_payments par méthode côté client, dupliquant la formule serveur : YAGNI, le snapshot Z l'affiche post-close).
- `handleSubmit` : ajoute `counted_qris`/`counted_card` (seulement si volet visible) et `denominations` (si grille active) au payload.

- [ ] **Step 1: Write the failing smoke tests (ajouts)**

Ajouter au fichier smoke existant (adapter les mocks au harnais du fichier — il mocke déjà `useCloseShift`/`useLoginUsers` ; ajouter) :

```tsx
vi.mock('../hooks/useDenominationCountEnabled', () => ({
  useDenominationCountEnabled: () => mockDenomEnabled(),
}));
vi.mock('@/features/settings/hooks/useEnabledPaymentMethods', () => ({
  useEnabledPaymentMethods: () => mockEnabledMethods(),
}));
```

avec `const mockDenomEnabled = vi.fn(() => false);` et `const mockEnabledMethods = vi.fn(() => new Set(['cash', 'card', 'qris', 'edc']));` hoistés (`vi.hoisted` — mémoire projet : refs stables obligatoires). Nouveaux tests :

```tsx
it('shows QRIS and card count inputs on the count step (blind: no expected)', () => {
  renderModal();
  expect(screen.getByTestId('counted-qris-input')).toBeInTheDocument();
  expect(screen.getByTestId('counted-card-input')).toBeInTheDocument();
  expect(screen.queryByText(/expected/i)).not.toBeInTheDocument();
});

it('hides the QRIS volet when the method is disabled', () => {
  mockEnabledMethods.mockReturnValueOnce(new Set(['cash', 'card']));
  renderModal();
  expect(screen.queryByTestId('counted-qris-input')).not.toBeInTheDocument();
});

it('replaces the numpad with the denomination grid when the flag is on', () => {
  mockDenomEnabled.mockReturnValueOnce(true);
  renderModal();
  expect(screen.getByTestId('denomination-grid')).toBeInTheDocument();
});

it('blocks Confirm count until visible non-cash volets are filled', () => {
  renderModal();
  fireEvent.click(screen.getByTestId('numpad-1')); // adapter au harnais existant
  expect(screen.getByRole('button', { name: /confirm count/i })).toBeDisabled();
  fireEvent.change(screen.getByTestId('counted-qris-input'), { target: { value: '0' } });
  fireEvent.change(screen.getByTestId('counted-card-input'), { target: { value: '0' } });
  expect(screen.getByRole('button', { name: /confirm count/i })).toBeEnabled();
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @breakery/pos test CloseShiftModal`
Expected: les nouveaux tests FAIL (testids absents), les 11 existants PASS.

- [ ] **Step 3: Implement**

Modifications de `CloseShiftModal.tsx` (structure conservée) :

1. Imports : `+ useDenominationCountEnabled`, `+ useEnabledPaymentMethods`, `+ DenominationGrid`, `+ sumDenominations` de `@breakery/domain`.
2. State : `+ const [qrisStr, setQrisStr] = useState(''); const [cardStr, setCardStr] = useState(''); const [denoms, setDenoms] = useState<Record<string, number>>({});`
3. Hooks : `const denomEnabled = useDenominationCountEnabled(); const enabledMethods = useEnabledPaymentMethods(); const qrisVisible = enabledMethods.has('qris'); const cardVisible = enabledMethods.has('card') || enabledMethods.has('edc');`
4. `const counted = denomEnabled ? sumDenominations(denoms) : Number(amountStr || '0');` (remplace la ligne existante ; `amountStr` reste pour le mode numpad).
5. `handleConfirmCount` : bloquer si `denomEnabled ? counted <= 0 && Object.keys(denoms).length === 0 : amountStr === ''`, ou si (`qrisVisible && qrisStr === ''`) ou (`cardVisible && cardStr === ''`) — toast « Enter every counted volet (0 is allowed). ».
6. Étape count, rendu : si `denomEnabled` → `<DenominationGrid value={denoms} onChange={setDenoms} />` à la place de `<Numpad …>` ; puis (toujours à l'étape count) :

```tsx
{qrisVisible && (
  <section className="space-y-1">
    <label htmlFor="counted_qris" className="text-xs uppercase tracking-wide text-text-secondary">
      QRIS total (terminal report)
    </label>
    <input
      id="counted_qris"
      data-testid="counted-qris-input"
      type="text"
      inputMode="numeric"
      placeholder="0"
      className="w-full min-h-[44px] bg-bg-input border border-border-subtle rounded-md p-3 text-sm font-mono tabular-nums focus:outline-none focus:border-gold"
      value={qrisStr}
      onChange={(e) => setQrisStr(e.target.value.replace(/\D/g, ''))}
    />
  </section>
)}
{cardVisible && (
  <section className="space-y-1">
    <label htmlFor="counted_card" className="text-xs uppercase tracking-wide text-text-secondary">
      Card + EDC total (terminal report)
    </label>
    <input
      id="counted_card"
      data-testid="counted-card-input"
      type="text"
      inputMode="numeric"
      placeholder="0"
      className="w-full min-h-[44px] bg-bg-input border border-border-subtle rounded-md p-3 text-sm font-mono tabular-nums focus:outline-none focus:border-gold"
      value={cardStr}
      onChange={(e) => setCardStr(e.target.value.replace(/\D/g, ''))}
    />
  </section>
)}
```

7. Étape review, sous la Row Variance existante, ajouter les volets non-cash saisis :

```tsx
{step === 'review' && qrisVisible && (
  <Row
    label="QRIS counted"
    value={<span className="font-mono tabular-nums text-text-primary">Rp {Number(qrisStr || '0').toLocaleString('id-ID')}</span>}
  />
)}
{step === 'review' && cardVisible && (
  <Row
    label="Card + EDC counted"
    value={<span className="font-mono tabular-nums text-text-primary">Rp {Number(cardStr || '0').toLocaleString('id-ID')}</span>}
  />
)}
{step === 'review' && (qrisVisible || cardVisible) && (
  <p className="text-[11px] text-text-secondary">
    Non-cash volets are reconciled server-side at close; any large variance
    will ask for a note or manager approval.
  </p>
)}
```

8. `handleSubmit` payload :

```ts
      if (qrisVisible) payload.counted_qris = Number(qrisStr || '0');
      if (cardVisible) payload.counted_card = Number(cardStr || '0');
      if (denomEnabled) payload.denominations = denoms;
```

(étendre le type local `payload` en conséquence).
9. Le `disabled` du bouton « Confirm count » applique la règle du point 5.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @breakery/pos test CloseShiftModal`
Expected: 11 anciens + 4 nouveaux PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/shift/components/CloseShiftModal.tsx apps/pos/src/features/shift/__tests__/CloseShiftModal.smoke.test.tsx
git commit -m "feat(pos): CloseShiftModal 3 volets (blind intact) + grille coupures si flag [S67 T10]"
```

---

### Task 11: POS `OpenShiftModal` grille + `useShift` opening_denominations

**Files:**
- Modify: `apps/pos/src/features/shift/OpenShiftModal.tsx`
- Modify: `apps/pos/src/features/shift/hooks/useShift.ts`
- Test: `apps/pos/src/features/shift/__tests__/OpenShiftModal.denominations.smoke.test.tsx` (create)

**Interfaces:**
- Consumes: `DenominationGrid` (Task 9), `useDenominationCountEnabled` (Task 8), `sumDenominations` (Task 1).
- Produces: `useOpenShift` input + `opening_denominations?: Record<string, number>` (insert direct RLS — pas de RPC d'open, enforcement client-only assumé, cf. spec §4).

- [ ] **Step 1: Write the failing smoke test**

```tsx
// apps/pos/src/features/shift/__tests__/OpenShiftModal.denominations.smoke.test.tsx
// S67 (12 D2.3) — flag ON : la grille remplace montant libre + quick amounts.
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockDenomEnabled = vi.hoisted(() => vi.fn(() => true));
vi.mock('../hooks/useDenominationCountEnabled', () => ({
  useDenominationCountEnabled: mockDenomEnabled,
}));
vi.mock('../hooks/useShift', () => ({
  useOpenShift: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('../hooks/useLanDevices', () => ({
  useLanDevices: () => ({ data: [] }),
}));
vi.mock('@/features/settings/hooks/usePOSPresets', () => ({
  usePOSPresets: () => ({ presets: { openingCashPresets: [100000, 200000] } }),
}));

import { OpenShiftModal } from '../OpenShiftModal';

describe('OpenShiftModal — denomination grid (flag on)', () => {
  it('shows the grid instead of quick amounts on the cash step', async () => {
    render(<OpenShiftModal open />);
    // Passer l'étape PIN (pas de verifyPin → 6 chiffres acceptés).
    // Le harnais NumpadVirtual expose des touches — utiliser le même pattern
    // que les smokes OpenShiftModal existants pour saisir '123456' et Verify.
    // Après passage à l'étape cash :
    // expect(screen.getByTestId('denomination-grid')).toBeInTheDocument();
    // expect(screen.queryByText(/quick amounts/i)).not.toBeInTheDocument();
  });
});
```

**Important** : regarder d'abord comment les smokes existants du dossier franchissent l'étape PIN (`data-step`, touches NumpadVirtual) et réutiliser ce pattern tel quel ; l'assertion finale est celle en commentaire ci-dessus. Si aucun smoke existant ne franchit l'étape PIN, monter le modal et forcer l'étape cash en saisissant le PIN via les boutons du numpad virtuel (`getByRole('button', { name: '1' })` × 6 puis Verify).

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @breakery/pos test OpenShiftModal.denominations`
Expected: FAIL (grid absent).

- [ ] **Step 3: Implement**

`useShift.ts` — l'input de `useOpenShift` devient :

```ts
    mutationFn: async (input: {
      opening_cash: number;
      opening_notes?: string;
      terminal_id?: string | null;
      /** S67 (12 D2.3) — grille de coupures d'ouverture (flag config ON). */
      opening_denominations?: Record<string, number> | null;
    }) => {
      if (!userId) throw new Error('not_authenticated');
      const { data, error } = await supabase
        .from('pos_sessions')
        .insert({
          opened_by:     userId,
          opening_cash:  input.opening_cash,
          opening_notes: input.opening_notes ?? null,
          terminal_id:   input.terminal_id ?? null,
          opening_denominations: input.opening_denominations ?? null,
        })
```

`OpenShiftModal.tsx` :
1. Imports : `+ DenominationGrid` (`./components/DenominationGrid`), `+ useDenominationCountEnabled` (`./hooks/useDenominationCountEnabled`), `+ sumDenominations` de `@breakery/domain`.
2. State : `+ const [denoms, setDenoms] = useState<Record<string, number>>({});` ; `const denomEnabled = useDenominationCountEnabled();`
3. `const amount = denomEnabled ? sumDenominations(denoms) : Number(amountStr || '0');`
4. Étape cash : quand `denomEnabled`, remplacer les sections « Opening Cash » (input libre) **et** « Quick Amounts » par :

```tsx
<section className="space-y-2">
  <SectionLabel as="div">Opening Cash — count by denomination</SectionLabel>
  <DenominationGrid value={denoms} onChange={setDenoms} />
  <div className="text-center pt-1">
    <Currency amount={amount} emphasis="gold" className="text-2xl font-display" />
  </div>
</section>
```

(les sections Terminal + Notes + CTA restent inchangées ; le CTA reste `disabled={amount <= 0 || openShift.isPending}`).
5. `handleSubmit` : `if (denomEnabled) mutInput.opening_denominations = denoms;` (étendre le type local).
6. Resets (`handleClose`, succès) : `setDenoms({})`.

- [ ] **Step 4: Run tests + typecheck**

Run: `pnpm --filter @breakery/pos test OpenShiftModal && pnpm --filter @breakery/pos typecheck`
Expected: PASS (nouveaux + smokes existants).

- [ ] **Step 5: Commit**

```bash
git add apps/pos/src/features/shift/OpenShiftModal.tsx apps/pos/src/features/shift/hooks/useShift.ts apps/pos/src/features/shift/__tests__/OpenShiftModal.denominations.smoke.test.tsx
git commit -m "feat(pos): OpenShiftModal — grille coupures à l'ouverture (flag), opening_denominations persisté [S67 T11]"
```

---

### Task 12: BO — toggle settings

**Files:**
- Modify: `apps/backoffice/src/pages/settings/SettingsGeneralPage.tsx`

**Interfaces:**
- Consumes: clé settings `shift_denomination_count_enabled` (Task 5) ; infra `FIELDS`/`FieldSpec` existante (type `boolean` déjà supporté — cf. `tax_inclusive`).
- Produces: toggle éditable catégorie `pos`.

- [ ] **Step 1: Add the field**

Dans le tableau `FIELDS`, après la ligne `shift_variance_pin_threshold_abs` :

```ts
  // S67 (12 D2.3) — when true the POS forces the cash count (open & close)
  // through the IDR denomination grid; close_shift_v5 enforces it server-side.
  { key: 'shift_denomination_count_enabled', label: 'Denomination count required', type: 'boolean', category: 'pos', helper: 'When on, opening/closing cash must be counted note-by-note (grid)' },
```

- [ ] **Step 2: Run smokes + typecheck**

Run: `pnpm --filter @breakery/backoffice test SettingsGeneral && pnpm --filter @breakery/backoffice typecheck`
Expected: PASS (si un smoke assert le nombre de champs, l'ajuster de +1).

- [ ] **Step 3: Commit**

```bash
git add apps/backoffice/src/pages/settings/SettingsGeneralPage.tsx
git commit -m "feat(backoffice): toggle Denomination count required (settings pos) [S67 T12]"
```

---

### Task 13: BO Z-report + template PDF — section reconciliation

**Files:**
- Modify: `supabase/functions/_shared/pdf-templates/zreport.ts`
- Modify: `apps/backoffice/src/features/cash-register/components/SignZReportModal.tsx`

**Interfaces:**
- Consumes: clés snapshot `reconciliation`/`denominations` (Task 4).
- Produces: rendu rétro-compatible (clé absente → section omise). EF `generate-zreport-pdf` **redeployée par le contrôleur**.

- [ ] **Step 1: PDF template**

Dans le type snapshot du template, ajouter (optionnels) :

```ts
  reconciliation?: Record<'cash' | 'qris' | 'card', {
    expected: number | null;
    counted:  number | null;
    variance: number | null;
  }> | null;
  denominations?: Record<string, number> | null;
```

Après la section « Payment methods breakdown » (le bloc `sectionTitle('Totals by payment method')`), ajouter :

```ts
  // S67 (12 D2.2/D2.3) — three-way reconciliation + denomination grid.
  // Older snapshots (pre-S67) simply lack the keys: sections are omitted.
  if (snap.reconciliation) {
    sectionTitle('Reconciliation (counted vs expected)');
    for (const volet of ['cash', 'qris', 'card'] as const) {
      const r = snap.reconciliation[volet];
      if (!r || r.counted === null || r.counted === undefined) continue;
      labeled(`${volet} counted`,  Number(r.counted),  1);
      labeled(`${volet} expected`, Number(r.expected ?? 0), 1);
      labeled(`${volet} variance`, Number(r.variance ?? 0), 1);
    }
    y -= 6;
  }
  if (snap.denominations && Object.keys(snap.denominations).length > 0) {
    sectionTitle('Closing cash by denomination');
    for (const [face, qty] of Object.entries(snap.denominations)) {
      if (Number(qty) === 0) continue;
      labeled(`${formatIDR(Number(face))} x ${qty}`, Number(face) * Number(qty), 1);
    }
    y -= 6;
  }
```

(adapter mécaniquement aux helpers réels du fichier — `labeled`/`sectionTitle`/`y` existent déjà pour les sections voisines ; si `labeled` a une autre arité, copier l'usage des lignes « Opening cash »).

- [ ] **Step 2: BO SignZReportModal**

Le modal lit déjà `snapshot?.cash_variance`. Ajouter après la ligne `variance` :

```ts
  const reconciliation = snapshot?.reconciliation as
    | Record<string, { counted: number | null; variance: number | null }>
    | undefined;
```

et dans le rendu, à côté de la ligne variance existante (même style de Row/ligne que le fichier utilise) :

```tsx
{reconciliation?.qris?.counted != null && (
  <div className="flex justify-between text-sm">
    <span className="text-text-secondary">QRIS variance</span>
    <span className="font-mono tabular-nums">{Number(reconciliation.qris.variance ?? 0).toLocaleString('id-ID')}</span>
  </div>
)}
{reconciliation?.card?.counted != null && (
  <div className="flex justify-between text-sm">
    <span className="text-text-secondary">Card+EDC variance</span>
    <span className="font-mono tabular-nums">{Number(reconciliation.card.variance ?? 0).toLocaleString('id-ID')}</span>
  </div>
)}
```

(caler le markup sur les lignes existantes du modal — objectif : 2 lignes conditionnelles, zéro régression sur les vieux snapshots).

- [ ] **Step 3 [CONTROLLER]: Deploy EF + run smokes**

Deploy `generate-zreport-pdf` via MCP `deploy_edge_function` (le template `_shared` est embarqué). Run : `pnpm --filter @breakery/backoffice test SignZReport` → PASS.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/pdf-templates/zreport.ts apps/backoffice/src/features/cash-register/components/SignZReportModal.tsx
git commit -m "feat(zreport): section reconciliation 3 volets + coupures (PDF + modal BO), rétro-compatible [S67 T13]"
```

---

### Task 14: Closeout — suite verte, ancres, INDEX, CLAUDE.md, PR

**Files:**
- Create: `docs/workplan/plans/2026-07-07-session-67-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan : In flight → livré, Merged (latest) S67, décalage S66→Previously)
- Modify: `docs/workplan/remise-a-plat/12-cash-register-shift.md` (bandeau « Mise à jour S67 » en tête, même format que S66 ; D2.2/D2.3 livrés)

- [ ] **Step 1: Suite monorepo verte**

Run: `pnpm typecheck && pnpm build && pnpm test`
Expected: exit 0 partout (baseline env-gated connue tolérée — la citer telle quelle dans l'INDEX).

- [ ] **Step 2 [CONTROLLER]: Ancres pgTAP live**

Re-passer : `s44_money_gates` (12/12 attendu — money-path intouchée), `close_shift_three_way` 14/14, `close_shift_pin_gate` 11/11, `close_shift_note_enforced` 7/7, `cash_register` 12/12.

- [ ] **Step 3: INDEX S67**

Rédiger l'INDEX (format S66) : déviations DEV-S67-01 (hook flag dédié vs useShiftCloseSummary, Task 8) + DEV-S67-02 (review non-cash sans expected pré-close, Task 10) + toute déviation d'exécution ; dettes éventuelles (candidates connues : rapport écarts par caissier D2.4 ; expected non-cash pré-close si le terrain le réclame ; rendu grille dans la page BO Z-reports LIST).

- [ ] **Step 4: CLAUDE.md bump + fiche 12**

Miroir des bumps S66 (In flight, Merged (latest), fiche 12 bandeau).

- [ ] **Step 5: Push + PR**

```bash
git push -u origin swarm/session-67
gh pr create --draft --title "S67 — Clôture de caisse ②③ : comptage 3 volets + comptage par coupure" --body-file <fichier temp dans $CLAUDE_JOB_DIR/tmp — jamais un here-string riche en racine (mémoire projet)>
```

Body : résumé spec + migrations `_121..124` + suites pgTAP + « Money-path non modifiée » + lien INDEX. Footer : `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

---

## Self-Review (fait à l'écriture)

- **Couverture spec** : §1 principe → T3 ; §2.1 → T2 ; §2.2 → T3 ; §2.3 → T4 ; §2.4 → T5 ; §3 domain → T1 ; §4 POS → T8-T11 ; §5 BO/PDF → T12-T13 ; §6 tests → T6-T7 + steps de chaque tâche ; §7 hors périmètre respecté (aucune tâche D2.4/B2.3/D1.2).
- **Écarts spec assumés (à consigner en DEV)** : hook `useDenominationCountEnabled` dédié (au lieu de `useShiftCloseSummary`) ; étape review sans expected non-cash pré-close (le serveur/snapshot restent la vérité). 
- **Types cohérents** : `sumDenominations(Record<string,number>): number` identique T1/T9/T10/T11 ; signature v5 identique T3/T6/T7/T8 ; clés snapshot `reconciliation`/`denominations` identiques T4/T6/T13.
