# Session 38 Implementation Plan — PIN Lockout + Split-Bill étendu + Tests E2E

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fermer SEC-06/07 (brute-force PIN via RPCs in-arg + chemin manager-PIN EF), livrer POS-15 (split-bill modes « parts égales » / « montants libres »), et TEST-05/07 (pgTAP + unit + smoke + premier E2E browser).

**Architecture:** Wave A (DB) crée un helper VOLATILE `_verify_pin_with_lockout` réutilisant les colonnes `user_profiles.failed_login_attempts`/`locked_until` existantes et le câble dans les 5 RPCs PIN-in-arg via CREATE OR REPLACE (signatures inchangées). Wave B (EF) ajoute un bucket durable per-IP consommé sur échec dans `_shared/manager-pin.ts` + audit, redéploie 3 EFs. Wave C (POS) ajoute 2 modes au `SplitPaymentFlow` existant avec helpers purs TDD dans `@breakery/domain` — zéro changement DB/EF/RPC côté paiement. Wave D : review pattern-guardian, sweeps, E2E Playwright.

**Tech Stack:** Postgres (Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP), Deno EFs, React + Zustand POS, Vitest, pgTAP, Playwright MCP.

**Spec:** [`docs/workplan/specs/2026-06-11-session-38-spec.md`](../../specs/archive/2026-06-11-session-38-spec.md)

**Migrations:** NAME-block `20260622000010..015` — vérifier d'abord `list_migrations` (prior max NAME attendu `20260621000020`).

---

## Wave A — DB : lockout PIN (subagent `db-engineer`)

### Task A1: Helper `_verify_pin_with_lockout` (migration `_010`)

**Files:**
- Create: `supabase/migrations/20260622000010_create_verify_pin_with_lockout_helper.sql`

- [ ] **Step 1: Vérifier la base** — MCP `list_migrations` : confirmer prior max NAME `20260621000020`. Si différent, adapter le bloc et le signaler en déviation.

- [ ] **Step 2: Écrire la migration**

```sql
-- 20260622000010_create_verify_pin_with_lockout_helper.sql
-- Session 38 \ Wave A \ Task A1 (SEC-06) — helper interne de validation PIN avec lockout.
-- Réutilise user_profiles.failed_login_attempts + locked_until (20260503000001).
-- Politique unique alignée sur l'EF auth-verify-pin : 5 échecs → lock 15 min.
-- VOLATILE (écrit) — verify_user_pin (STABLE, pur) est conservé pour l'EF login
-- (qui fait son propre comptage) et manager-pin.ts (comptage per-IP, S38 Wave B).

CREATE OR REPLACE FUNCTION public._verify_pin_with_lockout(p_user_id UUID, p_pin TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_hash      TEXT;
  v_attempts  INT;
  v_locked    TIMESTAMPTZ;
  v_new       INT;
BEGIN
  SELECT pin_hash, failed_login_attempts, locked_until
    INTO v_hash, v_attempts, v_locked
    FROM user_profiles
   WHERE id = p_user_id AND deleted_at IS NULL;

  IF v_hash IS NULL THEN
    RETURN false;  -- profil absent / sans PIN : pas d'énumération, pas de comptage
  END IF;

  IF v_locked IS NOT NULL AND v_locked > now() THEN
    RAISE EXCEPTION 'account_locked' USING ERRCODE = 'P0004';
  END IF;

  IF v_hash = crypt(p_pin, v_hash) THEN
    UPDATE user_profiles
       SET failed_login_attempts = 0, locked_until = NULL
     WHERE id = p_user_id;
    RETURN true;
  END IF;

  v_new := COALESCE(v_attempts, 0) + 1;
  IF v_new >= 5 THEN
    UPDATE user_profiles
       SET failed_login_attempts = v_new,
           locked_until = now() + interval '15 minutes'
     WHERE id = p_user_id;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'pin.locked', 'user_profiles', p_user_id,
            jsonb_build_object('attempts', v_new, 'source', 'rpc'));
  ELSE
    UPDATE user_profiles
       SET failed_login_attempts = v_new
     WHERE id = p_user_id;
    INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
    VALUES (p_user_id, 'pin.failed', 'user_profiles', p_user_id,
            jsonb_build_object('attempts', v_new, 'source', 'rpc'));
  END IF;
  RETURN false;
END;
$$;

COMMENT ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) IS
  'S38 SEC-06 — validation PIN avec comptage d''échecs + lockout 5/15min. '
  'Helper interne : appelé uniquement par les RPCs SECURITY DEFINER PIN-in-arg. '
  'P0004 = account_locked (distinct de P0003 invalid_pin).';

-- REVOKE pair canonique S25 — helper interne, aucun rôle applicatif ne l'appelle.
REVOKE ALL ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) FROM anon;
REVOKE EXECUTE ON FUNCTION public._verify_pin_with_lockout(UUID, TEXT) FROM authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
```

> Note : vérifier dans la migration `20260503000001` les noms exacts des colonnes audit_logs (`actor_id, action, entity_type, entity_id, metadata` — convention S28). Si `audit_logs` exige d'autres colonnes NOT NULL, adapter.

- [ ] **Step 3: Appliquer** — MCP `apply_migration` (project_id `ikcyvlovptebroadgtvd`, name `create_verify_pin_with_lockout_helper`).

- [ ] **Step 4: Vérification immédiate** — MCP `execute_sql` :

```sql
SELECT has_function_privilege('authenticated', 'public._verify_pin_with_lockout(uuid, text)', 'EXECUTE') AS auth_exec,
       has_function_privilege('anon', 'public._verify_pin_with_lockout(uuid, text)', 'EXECUTE') AS anon_exec;
-- attendu : false / false
```

- [ ] **Step 5: Commit** — `git add supabase/migrations/20260622000010_*.sql && git commit -m "feat(db): session 38 — wave A1 — _verify_pin_with_lockout helper (SEC-06)"`

### Task A2: Wiring des 5 RPCs (migrations `_011..015`)

**Files:**
- Create: `supabase/migrations/20260622000011_wire_pin_lockout_sign_zreport_v2.sql`
- Create: `supabase/migrations/20260622000012_wire_pin_lockout_close_fiscal_period_v1.sql`
- Create: `supabase/migrations/20260622000013_wire_pin_lockout_create_manual_je_v1.sql`
- Create: `supabase/migrations/20260622000014_wire_pin_lockout_approve_expense_v3.sql`
- Create: `supabase/migrations/20260622000015_wire_pin_lockout_complete_order_v11.sql`

- [ ] **Step 1: Extraire les définitions courantes** — pour chaque RPC, MCP `execute_sql` : `SELECT pg_get_functiondef('public.sign_zreport_v2(uuid, text)'::regprocedure);` (et équivalents). **Source de vérité = cloud**, pas le fichier de migration local (des correctives ont pu passer).

- [ ] **Step 2: Pour chaque RPC, écrire la migration de wiring** — corps = `CREATE OR REPLACE FUNCTION` avec la définition extraite, en remplaçant **chaque** occurrence de `verify_user_pin(` par `_verify_pin_with_lockout(` dans le corps. Signatures STRICTEMENT inchangées (pas de bump — précédent : corrective `_015` S25). En-tête de commentaire expliquant S38 SEC-06. Garder le `RAISE EXCEPTION 'invalid_pin' ... P0003` existant : le helper retourne false sur PIN faux (après comptage) et raise P0004 lui-même si locké.

  Les 5 RPCs et leur signature (à re-vérifier au Step 1) :
  - `sign_zreport_v2(UUID, TEXT)` — `supabase/migrations/20260621000015_bump_sign_zreport_v2_pin.sql:40` (1 occurrence)
  - `close_fiscal_period_v1(UUID, TEXT, BOOLEAN)` — `20260603000022`
  - `create_manual_je_v1(TEXT, DATE, JSONB, TEXT)` — `20260603000025`
  - `approve_expense_v3(UUID, TEXT)` — `20260601181353`
  - `complete_order_with_payment_v11(...)` — `20260621000010` (PIN de `p_discount_authorized_by` ; signature longue 17 args — copier verbatim du functiondef)

- [ ] **Step 3: Appliquer les 5 migrations** via MCP `apply_migration`, une par une, dans l'ordre.

- [ ] **Step 4: Vérifier** — `execute_sql` : `SELECT proname FROM pg_proc WHERE prosrc LIKE '%_verify_pin_with_lockout%' AND pronamespace = 'public'::regnamespace;` — attendu : les 5 RPCs (et le helper lui-même).

- [ ] **Step 5: Types regen sanity** — MCP `generate_typescript_types`, diff vs `packages/supabase/src/types.generated.ts` : attendu **aucun changement** (pas de schéma/signature modifiés). Si diff → STOP, investiguer.

- [ ] **Step 6: Commit** — `git add supabase/migrations/2026062200001[1-5]_*.sql && git commit -m "feat(db): session 38 — wave A2 — wire PIN lockout into 5 PIN-in-arg RPCs (SEC-06)"`

### Task A3: pgTAP `pin_lockout.test.sql`

**Files:**
- Create: `supabase/tests/pin_lockout.test.sql`

- [ ] **Step 1: Écrire la suite** (8 tests, enveloppe `BEGIN ... ROLLBACK`, GUC-chaining pattern S25 pour les DO blocks). Structure :

```sql
-- supabase/tests/pin_lockout.test.sql — S38 SEC-06 (T1-T8)
BEGIN;
SELECT plan(8);

-- Setup : créer un user_profile de test avec pin_hash = hash_pin('123456'),
-- role MANAGER + permission zreports.sign (réutiliser les fixtures pattern
-- des suites sign_zreport_pin / order_discount_gate S37 — les copier).

-- T1 : helper happy path — _verify_pin_with_lockout(uid, '123456') = true
-- T2 : 5 appels avec '000000' → false ×5 ; locked_until IS NOT NULL après le 5e
-- T3 : 6e appel → raise P0004 (utiliser throws_ok('SELECT _verify_pin_with_lockout(...)', 'P0004'))
-- T4 : audit_logs contient >= 4 rows action='pin.failed' + 1 row 'pin.locked' pour cet user
-- T5 : reset manuel locked_until=NULL + failed=0, puis PIN correct → true ET failed_login_attempts revient à 0 après un échec puis un succès
-- T6 : sign_zreport_v2 avec PIN faux (caller seedé) → P0003 ET failed_login_attempts incrémenté de 1
-- T7 : REVOKE — has_function_privilege('authenticated', ..., 'EXECUTE') = false ; idem anon
-- T8 : non-régression — sign_zreport_v2 avec PIN correct → succès (réutiliser le scénario happy de supabase/tests/ sign_zreport S37)

SELECT * FROM finish();
ROLLBACK;
```

  L'agent DOIT lire `supabase/tests/` (suites S37 : `order_discount_gate`, `sign_zreport_pin`) pour copier les fixtures exactes (seed user_profiles + role_permissions + z_reports draft) au lieu de les réinventer.

- [ ] **Step 2: Exécuter via cloud MCP** — `execute_sql` avec le fichier complet. Attendu : 8/8 PASS. Itérer jusqu'à PASS.

- [ ] **Step 3: Commit** — `git add supabase/tests/pin_lockout.test.sql && git commit -m "test(db): session 38 — wave A3 — pgTAP pin_lockout 8/8 (SEC-06)"`

---

## Wave B — EF : manager-pin hardening (subagent `edge-functions-engineer`) — parallélisable avec Wave C

### Task B1: `_shared/manager-pin.ts` + 3 EFs

**Files:**
- Modify: `supabase/functions/_shared/manager-pin.ts`
- Modify: `supabase/functions/void-order/index.ts`
- Modify: `supabase/functions/cancel-item/index.ts`
- Modify: `supabase/functions/refund-order/index.ts`

- [ ] **Step 1: Lire les 4 fichiers** + `_shared/rate-limit.ts` (signature exacte de `checkRateLimitDurable`).

- [ ] **Step 2: Étendre `manager-pin.ts`** — ajouter une fonction exportée :

```typescript
// S38 SEC-07 — bucket durable per-IP consommé UNIQUEMENT sur échec de PIN manager.
// 5 PIN faux / 15 min / IP → blocked. PAS de comptage per-manager sur ce chemin :
// verifyManagerPin teste le PIN contre tous les managers, compter per-user
// lockerait tous les comptes managers à chaque faute de frappe (DoS interne).
const MANAGER_PIN_FAIL_MAX = 5;
const MANAGER_PIN_FAIL_WINDOW_SEC = 900;

export async function recordManagerPinFailure(
  ip: string,
  functionName: string,
): Promise<{ blocked: boolean; retryAfterSec: number }> {
  const rl = await checkRateLimitDurable({
    functionName: 'manager-pin-fail',
    bucketKey: `ip:${ip}`,
    ipAddress: ip,
    maxPerWindow: MANAGER_PIN_FAIL_MAX,
    windowSec: MANAGER_PIN_FAIL_WINDOW_SEC,
  });
  // audit : aujourd'hui les échecs de PIN manager sont invisibles
  await admin.from('audit_logs').insert({
    actor_id: null,
    action: 'manager_pin.failed',
    entity_type: 'edge_function',
    entity_id: null,
    metadata: { ip, function: functionName },
  });
  return { blocked: !rl.allowed, retryAfterSec: rl.retryAfterSec };
}

export async function isManagerPinBlocked(ip: string): Promise<boolean> {
  // peek read-only : SELECT sur edge_function_rate_limits sans incrémenter
  const { data } = await admin
    .from('edge_function_rate_limits')
    .select('request_count, window_end')
    .eq('function_name', 'manager-pin-fail')
    .eq('bucket_key', `ip:${ip}`)
    .gt('window_end', new Date().toISOString())
    .maybeSingle();
  return (data?.request_count ?? 0) >= MANAGER_PIN_FAIL_MAX;
}
```

  Adapter les imports (`admin` client, `checkRateLimitDurable`) au style réel du fichier. Si `audit_logs.actor_id` est NOT NULL, utiliser le pattern existant du projet pour les events système (vérifier une row `login.failed` : elle porte l'actor_id du profil ciblé — ici pas de profil → vérifier la nullabilité réelle dans la migration `20260503000001` et sinon poser `entity_type='edge_function'` + omettre actor, ou réutiliser la colonne `payload` S19 ; **vérifier le schéma réel avant d'écrire**).

- [ ] **Step 3: Câbler les 3 EFs** — dans `void-order`, `cancel-item`, `refund-order`, autour de l'appel `verifyManagerPin(pin)` :
  1. AVANT : `if (await isManagerPinBlocked(ip)) return 429` (avec `retry_after`).
  2. Si résultat `{ok: false}` : `const { blocked } = await recordManagerPinFailure(ip, 'void-order'); return blocked ? 429 : 401;`
  Conserver le rate-limit IP 10/min global existant en amont (défense en profondeur, buckets distincts).

- [ ] **Step 4: Déployer** — MCP `deploy_edge_function` ×3 sur V3 dev. Vérifier `get_logs` après un appel manuel de smoke (PIN bidon → 401, audit row présente via `execute_sql SELECT ... FROM audit_logs WHERE action='manager_pin.failed' ORDER BY created_at DESC LIMIT 1`).

- [ ] **Step 5: Commit** — `git add supabase/functions && git commit -m "feat(edge): session 38 — wave B1 — manager-pin fail bucket + audit (SEC-07)"`

---

## Wave C — POS : split-bill modes equal/custom (subagent `pos-specialist`) — parallélisable avec Wave B

### Task C1: Domain helpers TDD

**Files:**
- Create: `packages/domain/src/payment/splitModes.ts`
- Create: `packages/domain/src/payment/__tests__/splitModes.test.ts`
- Modify: `packages/domain/src/index.ts` (exports)

- [ ] **Step 1: Écrire les tests AVANT l'implémentation**

```typescript
// packages/domain/src/payment/__tests__/splitModes.test.ts
import { describe, it, expect } from 'vitest';
import { splitEqualAmounts, validateCustomSplit } from '../splitModes';

describe('splitEqualAmounts', () => {
  it('splits evenly when divisible', () => {
    expect(splitEqualAmounts(90_000, 3)).toEqual([30_000, 30_000, 30_000]);
  });
  it('last payer absorbs the rounding remainder, sum is exact', () => {
    const parts = splitEqualAmounts(100_000, 3);
    expect(parts).toEqual([33_333, 33_333, 33_334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
  });
  it('every part stays positive', () => {
    expect(splitEqualAmounts(5, 5)).toEqual([1, 1, 1, 1, 1]);
  });
  it('throws on count out of 2..5', () => {
    expect(() => splitEqualAmounts(100, 1)).toThrow();
    expect(() => splitEqualAmounts(100, 6)).toThrow();
  });
  it('throws on non-positive total', () => {
    expect(() => splitEqualAmounts(0, 2)).toThrow();
  });
});

describe('validateCustomSplit', () => {
  it('accepts exact sum', () => {
    expect(validateCustomSplit(100_000, [60_000, 40_000])).toEqual({ ok: true });
  });
  it('rejects sum mismatch with delta', () => {
    expect(validateCustomSplit(100_000, [60_000, 30_000]))
      .toEqual({ ok: false, reason: 'sum_mismatch', delta: 10_000 });
  });
  it('rejects bad count', () => {
    expect(validateCustomSplit(100, [100])).toEqual({ ok: false, reason: 'bad_count' });
  });
  it('rejects non-positive amounts', () => {
    expect(validateCustomSplit(100, [110, -10]))
      .toEqual({ ok: false, reason: 'nonpositive_amount' });
  });
});
```

- [ ] **Step 2: Run → FAIL** — `pnpm --filter @breakery/domain test splitModes` (module absent).

- [ ] **Step 3: Implémenter**

```typescript
// packages/domain/src/payment/splitModes.ts
// S38 POS-15 — pure helpers for equal/custom split-bill modes. IO-free.
// IDR has no decimals: amounts are integers; the LAST payer absorbs the
// rounding remainder so that sum(parts) === total exactly (RPC v11 enforces it).

export function splitEqualAmounts(total: number, count: number): number[] {
  if (!Number.isInteger(count) || count < 2 || count > 5) {
    throw new Error(`splitEqualAmounts: count must be 2..5, got ${count}`);
  }
  if (!Number.isFinite(total) || total <= 0) {
    throw new Error(`splitEqualAmounts: total must be > 0, got ${total}`);
  }
  const base = Math.floor(total / count);
  const parts = Array.from({ length: count }, () => base);
  parts[count - 1] = total - base * (count - 1);
  return parts;
}

export type CustomSplitValidation =
  | { ok: true }
  | { ok: false; reason: 'sum_mismatch'; delta: number }
  | { ok: false; reason: 'bad_count' | 'nonpositive_amount' };

export function validateCustomSplit(total: number, amounts: number[]): CustomSplitValidation {
  if (amounts.length < 2 || amounts.length > 5) return { ok: false, reason: 'bad_count' };
  if (amounts.some((a) => !Number.isFinite(a) || a <= 0)) {
    return { ok: false, reason: 'nonpositive_amount' };
  }
  const sum = amounts.reduce((a, b) => a + b, 0);
  if (sum !== total) return { ok: false, reason: 'sum_mismatch', delta: total - sum };
  return { ok: true };
}
```

  + exporter depuis `packages/domain/src/index.ts` en suivant le style des exports `payment/` existants (`splitTender.ts`).

- [ ] **Step 4: Run → PASS** — `pnpm --filter @breakery/domain test splitModes` : 9/9.

- [ ] **Step 5: Commit** — `git commit -m "feat(domain): session 38 — wave C1 — splitEqualAmounts + validateCustomSplit (POS-15, TDD)"`

### Task C2: SplitPaymentFlow — mode_select + custom_amounts

**Files:**
- Modify: `apps/pos/src/features/payment/split/types.ts`
- Modify: `apps/pos/src/features/payment/split/SplitPaymentFlow.tsx`
- Create: `apps/pos/src/features/payment/split/ModeSelectStep.tsx`
- Create: `apps/pos/src/features/payment/split/CustomAmountsStep.tsx`
- Modify: `apps/pos/src/features/payment/split/PerPayerMethodStep.tsx` (afficher `assignedAmount` quand mode ≠ items)

- [ ] **Step 1: Étendre les types**

```typescript
// types.ts — ajouts
export type SplitMode = 'items' | 'equal' | 'custom';

export type SplitStep =
  | 'mode_select'      // S38 — choix du mode de split
  | 'payer_count'
  | 'assign_items'     // mode 'items' uniquement
  | 'custom_amounts'   // S38 — mode 'custom' uniquement
  | 'per_payer_method'
  | 'per_payer_cash';

export interface SplitPayer {
  // ... champs existants inchangés ...
  /** S38 — montant assigné (modes 'equal'/'custom'). undefined en mode 'items'. */
  assignedAmount?: number;
}
```

- [ ] **Step 2: `ModeSelectStep.tsx`** — 3 tuiles (style tuiles `PayerCountStep`, mêmes tokens sémantiques) : « By items », « Equal parts », « Custom amounts ». Callback `onSelect(mode: SplitMode)`.

- [ ] **Step 3: `CustomAmountsStep.tsx`** — par payer : montant édité au numpad (réutiliser le composant numpad du `PerPayerCashStep`), header live `Assigned X / Total Y — Remaining Z`, bouton « Last payer takes remainder » (pose `total - sum(autres)` sur le dernier payer), CTA « Continue » disabled tant que `validateCustomSplit(total, amounts).ok !== true`.

- [ ] **Step 4: Câbler la state machine** dans `SplitPaymentFlow.tsx` :
  - step initial `'mode_select'` ; `payer_count` ensuite pour les 3 modes.
  - mode `'equal'` : après `payer_count`, calculer `splitEqualAmounts(total, n)` (import `@breakery/domain`), poser `payers[i].assignedAmount`, sauter directement à `per_payer_method`.
  - mode `'custom'` : après `payer_count` → `custom_amounts` → `per_payer_method`.
  - mode `'items'` : flux existant inchangé (`assign_items`).
  - subtotal par payer pour méthode/cash : `payer.assignedAmount ?? payerSubtotal(payer, cartItems)` — factoriser dans un helper local.
  - Sortie `onComplete(tenders)` : montant du tender = ce même subtotal. Règle SP2 inchangée.
  - Back navigation cohérente (custom_amounts → payer_count → mode_select).

- [ ] **Step 5: Typecheck + suite POS courante** — `pnpm --filter @breakery/app-pos typecheck && pnpm --filter @breakery/app-pos test split` : non-régression du flux items.

- [ ] **Step 6: Commit** — `git commit -m "feat(pos): session 38 — wave C2 — split-bill equal/custom modes (POS-15)"`

### Task C3: Surfacing lockout POS + smokes

**Files:**
- Modify: `apps/pos/src/features/payment/hooks/useCheckout.ts` (mapping erreur `account_locked`)
- Modify: `apps/pos/src/features/discounts/hooks/useVerifyManagerPin.ts` (vérifier que 403 `account_locked` n'est pas avalé en `permission_missing`)
- Create: `apps/pos/src/features/payment/split/__tests__/split-modes.smoke.test.tsx`

- [ ] **Step 1: Lire le handling d'erreur actuel** de `useCheckout` (réponse EF non-2xx) et `useVerifyManagerPin:6-28`. Si l'EF/RPC remonte `account_locked` (P0004 → message PostgREST `account_locked`), mapper sur une erreur utilisateur dédiée : « Compte manager verrouillé 15 min (PIN erronés). ». Dans `useVerifyManagerPin`, distinguer `error === 'account_locked'` AVANT le fallback 403 → `permission_missing`.

- [ ] **Step 2: Smokes** (pattern des smokes S35/S36, `@testing-library/react` + mocks) :
  - T1 : `SplitPaymentFlow` rend `mode_select` avec 3 tuiles.
  - T2 : mode equal, 3 payers, total 100 000 → `onComplete` reçoit 3 tenders `[33333, 33333, 33334]`, somme exacte.
  - T3 : mode custom — bouton remainder complète le dernier payer ; Continue disabled si somme ≠ total.
  - T4 : mode items — flux existant atteint `assign_items` (non-régression).

- [ ] **Step 3: Run** — `pnpm --filter @breakery/app-pos test split-modes` : PASS. Puis sweep `pnpm --filter @breakery/app-pos test` complet.

- [ ] **Step 4: Commit** — `git commit -m "feat(pos)+test(pos): session 38 — wave C3 — lockout surfacing + split-modes smokes"`

---

## Wave D — Review, sweeps, E2E (lead + subagents `pattern-guardian`, `test-engineer`)

### Task D1: Code review

- [ ] **Step 1:** Spawner `pattern-guardian` sur le diff `master..swarm/session-38` — vérifier notamment : REVOKE pair helper, signatures RPC inchangées, append-only ledgers intacts, PIN jamais en body, domain IO-free, pas d'INSERT direct stock_movements.
- [ ] **Step 2:** Corriger toute violation, re-passer si nécessaire. Commit fixes.

### Task D2: Sweeps complets

- [ ] **Step 1:** `pnpm --filter @breakery/domain test` + `pnpm --filter @breakery/ui test` + `pnpm --filter @breakery/app-pos test` + `pnpm --filter @breakery/app-backoffice test` — comparer au baseline env-gated connu (13 BO files VITE_SUPABASE_URL = pré-existant).
- [ ] **Step 2:** `pnpm typecheck` — 6/6 PASS.
- [ ] **Step 3:** Re-run pgTAP S37 voisines (`sign_zreport_pin`, `order_discount_gate`) via cloud MCP — non-régression des RPCs réécrites.

### Task D3: E2E browser (lead, Playwright MCP)

- [ ] **Step 1:** Lancer `pnpm --filter @breakery/app-pos dev` en arrière-plan ; noter l'URL locale.
- [ ] **Step 2:** Dérouler au navigateur : login PIN (1 échec volontaire → message d'erreur visible, puis PIN correct) → ouvrir un shift si nécessaire → ajouter 2-3 produits → Charge → Split → Equal parts → 2 payers → cash ×2 → SuccessModal : total exact affiché. Captures d'écran aux étapes clés.
- [ ] **Step 3:** Vérifier en DB (`execute_sql`) : 2 rows `order_payments` pour l'order créé, somme = total.
- [ ] **Step 4:** Documenter le déroulé + résultats dans l'INDEX §tests.

### Task D4: Closeout

- [ ] **Step 1:** Rédiger `docs/workplan/plans/2026-06-11-session-38-INDEX.md` (résumé, migrations, RPCs, tests, déviations DEV-S38-*).
- [ ] **Step 2:** Bumper CLAUDE.md §Active Workplan (S38 current, S37 reference) + §Migration sequence (block `20260622000010..015`).
- [ ] **Step 3:** Commit final + récap PR-ready.

---

## Self-review (fait à la rédaction)

- Couverture spec : §2 → A1/A2/A3 ; §3 → B1 ; §4 → C1/C2/C3 ; §5 → A3 + C3 + D2/D3 ; §6 → A1/A2 ; critères §8 tous adressés.
- Cohérence types : `SplitMode`/`assignedAmount` utilisés identiquement en C2/C3 ; `_verify_pin_with_lockout(UUID, TEXT)` partout ; P0004 unique.
- Pas de placeholder : les zones « vérifier le schéma réel » sont des instructions de vérification exécutables (MCP), pas du TBD — convention projet (les agents vérifient le cloud avant d'affirmer).
