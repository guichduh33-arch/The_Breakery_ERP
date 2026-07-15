# S64 — Moyens de paiement configurables + fix I-1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre les 6 moyens de paiement activables/désactivables depuis le BO avec effet POS ≤ 60 s (fiche 19 D2.1, ferme B1.1c/B1.7), et neutraliser le double-comptage des voids même-jour dans `get_dashboard_overview_v1` + `get_daily_sales_v1` (I-1, décision propriétaire 2026-07-06).

**Architecture:** Clé JSONB sur le singleton `business_config` (défaut = tout activé), validée par la whitelist `set_setting_v1` existante (audit old/new hérité) ; page BO miroir de `SettingsInventoryPage` ; hook POS miroir de `useTaxRate` (fail-open, polling 60 s) filtrant les deux grilles de méthodes. I-1 = `AND NOT r.is_full_void` dans les soustractions refunds des 2 RPCs de lecture, in-place depuis les corps live.

**Tech Stack:** Postgres/plpgsql (Supabase cloud V3 dev via MCP), pgTAP, React 18 + TanStack Query + Zustand, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-06-s64-configurable-payment-methods-design.md`

## Global Constraints

- **Money-path INTOUCHÉE** : v17/v11/fire_v4/`_record_sale_stock_v1`/EF `process-payment` non modifiés. Chantiers = config + UI + 2 RPCs de lecture pure.
- **DEV-S57-02** : tout corps de RPC réécrit part du corps **live** (`SELECT pg_get_functiondef('public.set_setting_v1(text,jsonb,text)'::regprocedure)`), JAMAIS du fichier de migration d'origine.
- **DEV-S63-01** : les tâches DB/MCP (T1, T4) sont exécutées par le **contrôleur** (les subagents n'ont pas les tools MCP supabase). Cloud = `ikcyvlovptebroadgtvd`.
- **Trio S20** sur toute (re)création de fonction : `REVOKE ALL ... FROM PUBLIC` + `REVOKE EXECUTE ... FROM anon` + `GRANT EXECUTE ... TO authenticated` (+ `ALTER DEFAULT PRIVILEGES` déjà posé — le répéter est idempotent).
- **Jamais de `BEGIN;`/`COMMIT;`** dans un corps de migration (leçon S58).
- Migrations : `20260710000115` (A) puis `20260710000116` (B). Regen types après `_115` → `packages/supabase/src/types.generated.ts` ; `_116` = `[types-noop]` (signatures inchangées).
- Whitelist canonique des 6 méthodes : `cash, card, qris, edc, transfer, store_credit` (ordre de `paymentMethods.ts`).
- pnpm 9.15 + turbo (jamais npm) ; fichiers < 500 lignes ; commits conventionnels co-signés.

---

### Task 1 — DB : migration `_115` + pgTAP + regen types **(CONTRÔLEUR — MCP)**

**Files:**
- Create: `supabase/migrations/20260710000115_enabled_payment_methods.sql`
- Create: `supabase/tests/payment_methods_config.test.sql`
- Modify: `packages/supabase/src/types.generated.ts` (regen MCP)

**Interfaces:**
- Produces: colonne `business_config.enabled_payment_methods JSONB` ; catégorie `'payments'` de `get_settings_by_category_v1` → `{ enabled_payment_methods: string[] }` ; clé `'enabled_payment_methods'` acceptée par `set_setting_v1`.

- [ ] **Step 1 : fetch des corps live** — MCP `execute_sql` : `SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname IN ('get_settings_by_category_v1','set_setting_v1') AND pronamespace = 'public'::regnamespace;` Vérifier que les branches existantes matchent `20260710000020` (sinon, partir du live et le noter en déviation).

- [ ] **Step 2 : écrire la migration** — DDL + les 2 corps live avec pour SEULS ajouts les branches ci-dessous :

```sql
-- 20260710000115_enabled_payment_methods.sql
-- S64 (fiche 19 D2.1) — moyens de paiement activables. Défaut = les 6 → zéro
-- changement de comportement au déploiement. Corps RPC repris du LIVE
-- (pg_get_functiondef, DEV-S57-02) ; seuls ajouts : WHEN 'payments' (get) et
-- WHEN 'enabled_payment_methods' (set).

ALTER TABLE public.business_config
  ADD COLUMN IF NOT EXISTS enabled_payment_methods JSONB NOT NULL
  DEFAULT '["cash","card","qris","edc","transfer","store_credit"]'::jsonb;

ALTER TABLE public.business_config
  ADD CONSTRAINT business_config_enabled_payment_methods_check
  CHECK (jsonb_typeof(enabled_payment_methods) = 'array'
     AND jsonb_array_length(enabled_payment_methods) > 0);

COMMENT ON COLUMN public.business_config.enabled_payment_methods IS
  'Sous-ensemble non vide de {cash,card,qris,edc,transfer,store_credit} présenté au POS '
  '(filtre UI). Enforcement UI-level v1 : l''EF process-payment accepte toujours les 6 '
  '(dette S64 — enforcement serveur = session future).';
```

Branche `get_settings_by_category_v1` (après `WHEN 'inventory'`, avant `ELSE`) :

```sql
      WHEN 'payments' THEN jsonb_build_object(
        'enabled_payment_methods', v_row.enabled_payment_methods
      )
```

Branche `set_setting_v1` (après `WHEN 'allow_negative_stock'`, avant `ELSE`) :

```sql
    WHEN 'enabled_payment_methods' THEN
      IF jsonb_typeof(p_value) <> 'array' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023',
          DETAIL = 'enabled_payment_methods expects array';
      END IF;
      IF jsonb_array_length(p_value) = 0 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'at least one payment method must remain enabled';
      END IF;
      FOR v_elem IN SELECT * FROM jsonb_array_elements(p_value) LOOP
        IF jsonb_typeof(v_elem) <> 'string'
           OR (v_elem #>> '{}') NOT IN ('cash','card','qris','edc','transfer','store_credit') THEN
          RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
            DETAIL = 'unknown payment method: ' || COALESCE(v_elem #>> '{}', jsonb_typeof(v_elem));
        END IF;
      END LOOP;
      IF (SELECT COUNT(*) FROM jsonb_array_elements_text(p_value))
         <> (SELECT COUNT(DISTINCT e) FROM jsonb_array_elements_text(p_value) AS e) THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023',
          DETAIL = 'duplicate payment method';
      END IF;
      SELECT enabled_payment_methods INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET enabled_payment_methods = p_value, updated_at = now() WHERE id = 1;
      v_new := p_value;
```

Terminer par le trio S20 sur les DEUX fonctions (mêmes 4 lignes que `_020:82-85` et `:285-288`).

- [ ] **Step 3 : appliquer** — MCP `apply_migration` (`name='enabled_payment_methods'`). Vérifier : `SELECT enabled_payment_methods FROM business_config WHERE id = 1;` → les 6.

- [ ] **Step 4 : écrire la suite pgTAP** `supabase/tests/payment_methods_config.test.sql` — en-tête d'impersonation admin repris d'une suite settings-adjacente existante (ex. `retail_tab_credit_gate.test.sql`) ; assertions (~12) :
  1. défaut : `get_settings_by_category_v1('payments')->'settings'->'enabled_payment_methods'` = les 6 ;
  2. set valide `["cash","qris"]` → relecture = `["cash","qris"]` ;
  3. `throws_ok` array vide → `setting_value_invalid` ;
  4. `throws_ok` élément inconnu `["cash","bitcoin"]` → `setting_value_invalid` ;
  5. `throws_ok` non-array `"cash"` → `setting_type_invalid` ;
  6. `throws_ok` doublon `["cash","cash"]` → `setting_value_invalid` ;
  7. `throws_ok` élément non-string `[1]` → `setting_value_invalid` ;
  8. audit : dernière ligne `audit_logs` `action='setting.update'` avec `metadata->>'key'='enabled_payment_methods'` et `old`/`new` non nuls ;
  9. `42501` : impersonation d'un rôle sans `settings.update` → `throws_ok permission_denied` ;
  10. ACL : `SELECT has_function_privilege('anon', 'public.set_setting_v1(text,jsonb,text)', 'EXECUTE')` = false (idem get) ;
  11. CHECK table : UPDATE direct à `'[]'::jsonb` échoue (23514).

- [ ] **Step 5 : run live** — MCP `execute_sql` enveloppe `BEGIN;...ROLLBACK;` avec le pattern de capture temp-table (mémoire `workflow_pgtap_via_mcp_capture`). Expected : 0 `not ok`.

- [ ] **Step 6 : regen types** — MCP `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`. Diff attendu : +`enabled_payment_methods` sur `business_config`.

- [ ] **Step 7 : commit** — `feat(settings): enabled_payment_methods key + validation (_115) [S64 T1]` (migration + test + types).

### Task 2 — BO : page Settings « Payment Methods » **(subagent backoffice-specialist)**

**Files:**
- Create: `apps/backoffice/src/pages/settings/SettingsPaymentMethodsPage.tsx`
- Create: `apps/backoffice/src/features/settings/__tests__/SettingsPaymentMethodsPage.smoke.test.tsx`
- Modify: `apps/backoffice/src/features/settings/hooks/useSettings.ts:10` (union `SettingsCategory` + `'payments'`)
- Modify: `apps/backoffice/src/routes/index.tsx` (lazy import ~l.82 + Route après `settings/inventory` ~l.887)
- Modify: `apps/backoffice/src/pages/settings/SettingsHubPage.tsx:47` (tuile active)

**Interfaces:**
- Consumes: `useSettings('payments')` / `useSetSetting()` (T1) — payload `{ settings: { enabled_payment_methods: string[] } }`.
- Produces: route `/backoffice/settings/payment-methods` (gate `settings.read`).

- [ ] **Step 1 : étendre le type** — `export type SettingsCategory = 'business' | 'localization' | 'tax' | 'pos' | 'inventory' | 'payments';`

- [ ] **Step 2 : écrire le smoke test** (miroir harness de `SettingsInventoryPage.smoke.test.tsx` — même mock supabase/authStore) : (a) rendu avec `['cash','card']` → cases cash/card cochées, qris/edc/transfer/store_credit décochées ; (b) tout décocher → bouton Enregistrer `disabled` + message « au moins une méthode » ; (c) décocher `card` puis save → `supabase.rpc('set_setting_v1', { p_key: 'enabled_payment_methods', p_value: ['cash'], p_category: 'payments' })`. Run : `pnpm --filter @breakery/backoffice test SettingsPaymentMethodsPage` → FAIL (page inexistante).

- [ ] **Step 3 : écrire la page** — miroir exact du pattern `SettingsInventoryPage.tsx` (draft/dirty/save/gates) :

```tsx
// apps/backoffice/src/pages/settings/SettingsPaymentMethodsPage.tsx
// S64 (fiche 19 D2.1) — active/désactive les moyens de paiement présentés au POS.
// Écrit business_config.enabled_payment_methods via set_setting_v1 (audité old/new).

import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const ALL_METHODS = [
  { value: 'cash',         label: 'Cash' },
  { value: 'card',         label: 'Card' },
  { value: 'qris',         label: 'QRIS' },
  { value: 'edc',          label: 'EDC' },
  { value: 'transfer',     label: 'Transfer' },
  { value: 'store_credit', label: 'Store Credit' },
] as const;

export default function SettingsPaymentMethodsPage() {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canRead   = hasPermission('settings.read');
  const canUpdate = hasPermission('settings.update');

  const payments   = useSettings('payments');
  const setSetting = useSetSetting();

  const [draft, setDraft]   = useState<string[] | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const [savedAt, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (!payments.data) return;
    const raw = payments.data.settings.enabled_payment_methods;
    setDraft(Array.isArray(raw) ? raw.filter((m): m is string => typeof m === 'string') : ALL_METHODS.map((m) => m.value));
  }, [payments.data]);

  if (!canRead) {
    return <div className="text-text-secondary">Accès refusé aux réglages.</div>;
  }

  const original = payments.data && Array.isArray(payments.data.settings.enabled_payment_methods)
    ? (payments.data.settings.enabled_payment_methods as string[])
    : null;
  const dirty = draft !== null && original !== null
    && (draft.length !== original.length || draft.some((m) => !original.includes(m)));
  const empty = draft !== null && draft.length === 0;

  function toggle(value: string, checked: boolean) {
    setDraft((prev) => {
      if (prev === null) return prev;
      return checked ? [...prev, value] : prev.filter((m) => m !== value);
    });
  }

  async function handleSave() {
    if (draft === null || draft.length === 0) return;
    setError(null);
    try {
      // Ordre canonique stable (évite un dirty fantôme par réordonnancement).
      const ordered = ALL_METHODS.map((m) => m.value).filter((v) => draft.includes(v));
      await setSetting.mutateAsync({ key: 'enabled_payment_methods', value: ordered, category: 'payments' });
      setSaved(new Date().toLocaleTimeString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Échec de l'enregistrement");
    }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">Moyens de paiement</h1>
        <p className="text-text-secondary text-sm mt-1">
          Les méthodes décochées disparaissent des terminaux POS (≤ 60 s, sans redémarrage).
          Chaque changement écrit une entrée d&apos;audit.
        </p>
      </div>

      {payments.isLoading && <div className="text-text-secondary">Chargement…</div>}
      {payments.error && <div className="text-red">Échec du chargement : {payments.error.message}</div>}

      {!payments.isLoading && !payments.error && draft !== null && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          <div className="space-y-3">
            {ALL_METHODS.map((m) => (
              <label key={m.value} className="flex items-center gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={draft.includes(m.value)}
                  disabled={!canUpdate}
                  onChange={(e) => toggle(m.value, e.target.checked)}
                />
                <span>{m.label}</span>
              </label>
            ))}
          </div>

          {empty && <p className="text-red text-sm" role="alert">Au moins une méthode doit rester activée.</p>}
          {error && <p className="text-red text-sm" role="alert">{error}</p>}
          {savedAt && !dirty && <p className="text-emerald-700 text-xs" role="status">Enregistré à {savedAt}</p>}

          {canUpdate && (
            <Button type="submit" variant="primary" disabled={!dirty || empty || setSetting.isPending}>
              {setSetting.isPending ? 'Enregistrement…' : dirty ? 'Enregistrer' : 'Aucun changement'}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 4 : route + tuile** — lazy import `SettingsPaymentMethodsPage` ; Route `settings/payment-methods` sous `PermissionGate required="settings.read"` (copie du bloc `settings/inventory`) ; tuile hub : `{ to: '/backoffice/settings/payment-methods', title: 'Payment Methods', blurb: 'Enable or disable POS payment methods.', icon: CreditCard }`.

- [ ] **Step 5 : run** — `pnpm --filter @breakery/backoffice test SettingsPaymentMethodsPage` → PASS ; `pnpm --filter @breakery/backoffice typecheck` → 0 erreur.

- [ ] **Step 6 : commit** — `feat(backoffice): Settings Payment Methods page + hub tile [S64 T2]`.

### Task 3 — POS : filtre des méthodes + effet ≤ 60 s **(subagent pos-specialist)**

**Files:**
- Create: `apps/pos/src/features/settings/hooks/useEnabledPaymentMethods.ts`
- Create: `apps/pos/src/features/settings/hooks/__tests__/useEnabledPaymentMethods.test.tsx`
- Modify: `apps/pos/src/features/payment/components/PaymentMethodGrid.tsx:19` (filtre)
- Modify: `apps/pos/src/features/payment/split/PerPayerMethodStep.tsx:169` (filtre)
- Modify: `apps/pos/src/features/payment/hooks/usePaymentFlowLogic.ts` (garde de désélection)

**Interfaces:**
- Consumes: colonne `business_config.enabled_payment_methods` (T1), types regénérés.
- Produces: `useEnabledPaymentMethods(): ReadonlySet<PaymentMethod>` (fail-open = les 6).

- [ ] **Step 1 : écrire le test du hook** (harness QueryClientProvider + `vi.mock('@/lib/supabase')`, miroir des tests hooks existants) : (a) DB renvoie `["cash","qris"]` → Set de taille 2 ; (b) erreur supabase → Set des 6 (fail-open) ; (c) valeur non-array → Set des 6 ; (d) array vide → Set des 6. Run : `pnpm --filter @breakery/pos test useEnabledPaymentMethods` → FAIL.

- [ ] **Step 2 : écrire le hook** :

```ts
// apps/pos/src/features/settings/hooks/useEnabledPaymentMethods.ts
//
// S64 (fiche 19 D2.1) — méthodes de paiement activées par le BO.
// Miroir du pattern useTaxRate : SELECT direct business_config sous le JWT PIN,
// FAIL-OPEN (les 6 méthodes) pendant le chargement ou sur erreur/valeur invalide —
// une panne de config ne bloque JAMAIS un encaissement.
// « Effet immédiat » v1 : staleTime 30 s + refetchInterval 60 s + refetch on focus.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PaymentMethod } from '@breakery/domain';
import { supabase } from '@/lib/supabase';

export const ALL_PAYMENT_METHODS: readonly PaymentMethod[] = [
  'cash', 'card', 'qris', 'edc', 'transfer', 'store_credit',
];
const ALL_SET: ReadonlySet<PaymentMethod> = new Set(ALL_PAYMENT_METHODS);
const QUERY_KEY = ['business-config', 'enabled-payment-methods'] as const;

export function useEnabledPaymentMethods(): ReadonlySet<PaymentMethod> {
  const { data } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<PaymentMethod[]> => {
      const { data, error } = await supabase
        .from('business_config')
        .select('enabled_payment_methods')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      const raw = data?.enabled_payment_methods;
      if (!Array.isArray(raw)) return [...ALL_PAYMENT_METHODS];
      const valid = raw.filter(
        (m): m is PaymentMethod => typeof m === 'string' && (ALL_SET as Set<string>).has(m),
      );
      return valid.length > 0 ? valid : [...ALL_PAYMENT_METHODS];
    },
  });
  return useMemo(() => (data ? new Set<PaymentMethod>(data) : ALL_SET), [data]);
}
```

- [ ] **Step 3 : run** → PASS.

- [ ] **Step 4 : filtrer les deux grilles** — dans `PaymentMethodGrid` : `const enabled = useEnabledPaymentMethods();` puis `METHODS.filter((m) => enabled.has(m.value)).map(...)`. Idem dans `PerPayerMethodStep` sur sa copie locale `METHODS` (les deux tableaux restent distincts — libellés voulus différents ; seul le hook est partagé).

- [ ] **Step 5 : garde de désélection** — dans `usePaymentFlowLogic` (après la ligne 67 `const taxRate = useTaxRate();`) :

```ts
  const enabledMethods = useEnabledPaymentMethods();
  // S64 — si la méthode draft vient d'être désactivée au BO (ou si le défaut
  // 'cash' posé par open() est désactivé), on désélectionne. paymentStore.
  // selectMethod n'accepte pas null → setState direct.
  useEffect(() => {
    if (selectedMethod && !enabledMethods.has(selectedMethod)) {
      usePaymentStore.setState({ selectedMethod: null, cashReceivedStr: '' });
    }
  }, [selectedMethod, enabledMethods]);
```

(ajouter `useEffect` à l'import React l.10 et l'import du hook). NOTE : la garde ne touche PAS les tenders déjà ajoutés ni un draft de payer split confirmé — une méthode désactivée après ajout part quand même (enforcement UI v1, dette documentée).

- [ ] **Step 6 : tests de rendu** — dans la suite de tests existante de PaymentTerminal/PaymentMethodGrid (ou nouvelle co-locée) : mock du hook → `["cash","card"]` : `pay-method-qris` absent du DOM, `pay-method-cash` présent. Run : `pnpm --filter @breakery/pos test payment` → PASS (baseline env-gated inchangée).

- [ ] **Step 7 : typecheck + commit** — `pnpm --filter @breakery/pos typecheck` ; `feat(pos): filter payment methods by enabled_payment_methods [S64 T3]`.

### Task 4 — DB : fix I-1 voids même-jour (migration `_116`) **(CONTRÔLEUR — MCP)**

**Files:**
- Create: `supabase/migrations/20260710000116_net_revenue_exclude_full_void_refunds.sql`
- Create: `supabase/tests/net_revenue_full_void.test.sql`

**Interfaces:**
- Consumes: corps live de `get_dashboard_overview_v1()` et `get_daily_sales_v1(...)` ; colonne `refunds.is_full_void` (vérifier `NOT NULL`/défaut avant d'écrire).
- Produces: sémantique « net = brut − refunds partiels » sur les DEUX RPCs ; signatures inchangées → commit `[types-noop]`.

- [ ] **Step 1 : fetch live** — `pg_get_functiondef` des 2 RPCs + `SELECT column_name, is_nullable, column_default FROM information_schema.columns WHERE table_name='refunds' AND column_name='is_full_void';`

- [ ] **Step 2 : écrire la migration** — réécriture in-place des 2 corps ; dans CHAQUE soustraction de refunds (CTE/sous-requête sur `refunds r` : `revenue_today` et `revenue_30d` côté dashboard ; l'équivalent côté daily_sales), ajouter au WHERE :

```sql
        AND NOT COALESCE(r.is_full_void, false)
```

(si la colonne est `NOT NULL DEFAULT false`, simplifier en `AND NOT r.is_full_void`). En-tête de migration : rappeler le lineage `20260704000018` (void = status voided + refund is_full_void=true → double pénalité) et la décision propriétaire 2026-07-06. Trio S20 répété. Appliquer via MCP `apply_migration`.

- [ ] **Step 3 : écrire la suite pgTAP** `supabase/tests/net_revenue_full_void.test.sql` — delta-based (DB non vide), seed repris de `supabase/tests/dashboard_overview.test.sql` (les contraintes `chk_orders_void_consistency` / trigger `fn_create_je_for_refund` y sont déjà résolues — DEV-S63-02) :
  1. baseline : `revenue_today` (dashboard) + net du jour (`get_daily_sales_v1`) capturés en temp table ;
  2. seed commande payée aujourd'hui (total T) → delta = +T sur les deux ;
  3. void même-jour : `status='voided'` (+ colonnes de consistance) + refund `is_full_void=true` montant T → **delta net redevient 0 sur les DEUX RPCs** (pin du fix — avant : −T) ;
  4. seed 2ᵉ commande payée (total T2) + refund partiel `is_full_void=false` montant R → delta = T2−R sur les deux (le partiel reste soustrait) ;
  5. non-régression S63 : la commande voidée reste hors `orders_count`/brut.

- [ ] **Step 4 : run live** — MCP `execute_sql` `BEGIN;...ROLLBACK;` + capture temp-table. Expected : 0 `not ok`. Re-passer aussi `dashboard_overview.test.sql` (14/14) — le fix ne doit pas la casser (elle ne teste pas de full-void même-jour, DEV-S63 D-2).

- [ ] **Step 5 : commit** — `fix(reports): exclude full-void refunds from net revenue (dashboard + daily_sales, _116) [types-noop] [S64 T4]` + fermer I-1 dans l'INDEX S63 (note « fixé S64, décision 2026-07-06 »).

### Task 5 — Closeout **(CONTRÔLEUR)**

**Files:**
- Create: `docs/workplan/plans/2026-07-06-session-64-INDEX.md`
- Modify: `docs/workplan/remise-a-plat/19-settings-configuration.md` (bandeau MAJ S64 — D2.1 livré), `03-payments-split.md` (note filtre POS), `00-INDEX.md` (Vague 2 : moyens de paiement ✅ SOLDÉ), `2026-07-06-session-63-INDEX.md` (I-1 fermé)
- Modify: `CLAUDE.md` (Active Workplan : S64 merged, in-flight vidé, prochaine session)

- [ ] **Step 1 : suite monorepo** — `pnpm typecheck && pnpm build && pnpm test` → exit 0 (baseline env-gated tolérée).
- [ ] **Step 2 : revue finale de branche** — pattern-guardian (read-only) sur le diff complet vs master ; corriger tout Critical/Important.
- [ ] **Step 3 : INDEX S64** — livré, commits, déviations (DEV-S64-01 : brainstorming interactif sauté, utilisateur AFK, périmètre = fiche D2.1 + décision I-1 actée en cours de session), dettes (enforcement EF des méthodes désactivées ; tenders/split drafts non re-gatés ; realtime différé au profit du polling 60 s).
- [ ] **Step 4 : docs** — bandeaux fiches 19/03, 00-INDEX, fermeture I-1, bump CLAUDE.md.
- [ ] **Step 5 : PR** — `gh pr create` (body via `--body-file`, mémoire junk-files) → squash-merge `master`.

## Self-Review

- **Couverture spec** : A.2.1→Task 1 (colonne+CHECK) ; A.2.2→Task 1 (2 branches) ; A.2.3→Task 2 ; A.2.4/A.2.5→Task 3 ; A.2.6→dette INDEX (Task 5) ; A.3→Steps de test T1/T2/T3 ; B.2→Task 4 ; B.3→Task 4 Step 3 ; critères de sortie→Task 5. ✔
- **Placeholders** : aucun TBD ; les seuls renvois sont vers des fichiers EXISTANTS à imiter (harness de test, en-tête d'impersonation pgTAP) — assumés, le code cible est fourni. ✔
- **Cohérence de types** : `enabled_payment_methods: string[]` (BO, non typé PaymentMethod car payload JSONB) vs `ReadonlySet<PaymentMethod>` (POS, filtré runtime) — volontaire, frontière de validation. `SettingsCategory + 'payments'` utilisé par T2 et défini T2 Step 1. ✔
