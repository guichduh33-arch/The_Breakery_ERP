# S73 Lot 2 — Promotion org (Customer Display + Printing) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou
> superpowers:executing-plans. Les étapes `CONTROLLER-ONLY` (MCP) sont exécutées par le
> contrôleur, jamais par un subagent (les subagents n'ont pas accès au MCP Supabase).

**Goal:** Promouvoir 4 réglages terminal → org (DB) : copie du customer display
(`display_footer_message`, `display_slogan`) et auto-toggles d'encaissement
(`pos_auto_print_receipt`, `pos_auto_open_drawer`), avec édition POS **et** BO sur les
mêmes RPC/clés. Hard cutover (pas de dual-mode) — décision propriétaire B1 du 2026-07-11.

**Architecture:** 4 colonnes sur `business_config` + 2 catégories symboliques
(`customer_display`, `printing`) ajoutées aux 2 RPC existants (même signature ⇒ CREATE OR
REPLACE, pas de bump). POS lit en SELECT direct (RLS `auth_read`, pattern `useTaxRate`),
écrit via `set_setting_v1` (gate `settings.update`). Le display (kiosk JWT une fois appairé)
lit avec fallback défauts. `posSettingsStore` perd les 4 champs.

**Tech stack:** SQL plpgsql (MCP apply_migration), pgTAP via MCP execute_sql
(BEGIN…ROLLBACK), React Query v5, Vitest.

## Global Constraints

Voir l'INDEX. Migration `20260711000159`, corps RPC repris du **live** (`pg_get_functiondef`),
pas de BEGIN/COMMIT, types regen obligatoire (diff avant commit), money-path intouché.

---

### Task 7: Migration `20260711000159_settings_org_display_printing.sql`

**Files:**
- Create: `supabase/migrations/20260711000159_settings_org_display_printing.sql`
- Create: `supabase/tests/settings_org_display_printing.test.sql`

**Interfaces:**
- Produces: colonnes `business_config.display_footer_message` (text NOT NULL DEFAULT ''),
  `display_slogan` (text NOT NULL DEFAULT ''), `pos_auto_print_receipt` (bool NOT NULL
  DEFAULT true), `pos_auto_open_drawer` (bool NOT NULL DEFAULT true) ; catégories RPC
  `customer_display` et `printing` ; clés `set_setting_v1` homonymes des colonnes.

- [ ] **Step 1 (CONTROLLER-ONLY): récupérer les corps live** — MCP `execute_sql` :

```sql
SELECT pg_get_functiondef(p.oid) FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname='public' AND p.proname IN ('get_settings_by_category_v1','set_setting_v1');
```

  Le fichier de migration est construit à partir de CES corps (DEV-S57-02 : jamais depuis
  `_128` ni depuis ce plan si le live a bougé entre-temps).

- [ ] **Step 2: écrire la migration.** Structure exacte (les corps complets = live + insertions
  ci-dessous) :

```sql
-- 20260711000159_settings_org_display_printing.sql
-- S73 Lot 2 — promote customer-display copy + payment auto-toggles from
-- per-terminal localStorage to org-level business_config (audit
-- docs/workplan/audits/settings-pos-bo-audit.md, owner decision B1 2026-07-11).
-- Same-signature CREATE OR REPLACE (precedent: _128 S67). NO BEGIN/COMMIT.

ALTER TABLE business_config
  ADD COLUMN display_footer_message text    NOT NULL DEFAULT '',
  ADD COLUMN display_slogan         text    NOT NULL DEFAULT '',
  ADD COLUMN pos_auto_print_receipt boolean NOT NULL DEFAULT true,
  ADD COLUMN pos_auto_open_drawer   boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN business_config.display_footer_message IS
  'Customer display idle footer. '''' = built-in default (S73).';
COMMENT ON COLUMN business_config.display_slogan IS
  'Customer display brand slogan. '''' = built-in default (S73).';
COMMENT ON COLUMN business_config.pos_auto_print_receipt IS
  'Org default: auto-print receipt on payment success (S73).';
COMMENT ON COLUMN business_config.pos_auto_open_drawer IS
  'Org default: auto-open cash drawer on cash tender (S73).';

-- <corps live COMPLET de get_settings_by_category_v1, avec ce bloc ajouté
--  dans le CASE, entre WHEN 'payments' et ELSE> :
      WHEN 'customer_display' THEN jsonb_build_object(
        'display_footer_message', v_row.display_footer_message,
        'display_slogan',         v_row.display_slogan
      )
      WHEN 'printing' THEN jsonb_build_object(
        'pos_auto_print_receipt', v_row.pos_auto_print_receipt,
        'pos_auto_open_drawer',   v_row.pos_auto_open_drawer
      )

-- <corps live COMPLET de set_setting_v1, avec ces 4 branches ajoutées dans le
--  CASE p_key, juste avant le ELSE> :
    WHEN 'display_footer_message' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'display_footer_message expects string';
      END IF;
      IF length(p_value #>> '{}') > 120 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'display_footer_message max 120 chars';
      END IF;
      SELECT to_jsonb(display_footer_message) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET display_footer_message = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'display_slogan' THEN
      IF jsonb_typeof(p_value) <> 'string' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'display_slogan expects string';
      END IF;
      IF length(p_value #>> '{}') > 80 THEN
        RAISE EXCEPTION 'setting_value_invalid' USING ERRCODE = '22023', DETAIL = 'display_slogan max 80 chars';
      END IF;
      SELECT to_jsonb(display_slogan) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET display_slogan = p_value #>> '{}', updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pos_auto_print_receipt' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'pos_auto_print_receipt expects boolean';
      END IF;
      SELECT to_jsonb(pos_auto_print_receipt) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pos_auto_print_receipt = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;

    WHEN 'pos_auto_open_drawer' THEN
      IF jsonb_typeof(p_value) <> 'boolean' THEN
        RAISE EXCEPTION 'setting_type_invalid' USING ERRCODE = '22023', DETAIL = 'pos_auto_open_drawer expects boolean';
      END IF;
      SELECT to_jsonb(pos_auto_open_drawer) INTO v_old FROM business_config WHERE id = 1;
      UPDATE business_config SET pos_auto_open_drawer = (p_value #>> '{}')::BOOLEAN, updated_at = now() WHERE id = 1;
      v_new := p_value;
```

  Note : `''` (vide) est VOLONTAIREMENT accepté sur les 2 clés texte = « défaut intégré »,
  parité avec l'ex-comportement localStorage. Pas de REVOKE à ajouter : les 2 fonctions
  conservent leurs ACLs existantes (CREATE OR REPLACE les préserve) et les colonnes héritent
  des policies RLS de `business_config`.

- [ ] **Step 3: écrire le pgTAP** `supabase/tests/settings_org_display_printing.test.sql` :

```sql
-- pgTAP — S73 org display/printing settings. Run via MCP execute_sql inside
-- BEGIN; … ROLLBACK; (capture pattern: temp table, cf. MEMORY workflow_pgtap_via_mcp_capture).
BEGIN;
SELECT plan(8);

SELECT has_column('business_config', 'display_footer_message', 'footer column exists');
SELECT has_column('business_config', 'display_slogan',         'slogan column exists');
SELECT has_column('business_config', 'pos_auto_print_receipt', 'auto-print column exists');
SELECT has_column('business_config', 'pos_auto_open_drawer',   'auto-drawer column exists');

-- get: nouvelle catégorie exposée (exécuté en super-user de test → gate bypassé par
-- le seed helper habituel de la suite ; sinon SET LOCAL request.jwt.claims comme les
-- suites settings existantes).
SELECT is(
  (get_settings_by_category_v1('customer_display')->'settings') ? 'display_footer_message',
  true, 'customer_display category exposes footer');
SELECT is(
  (get_settings_by_category_v1('printing')->'settings') ? 'pos_auto_print_receipt',
  true, 'printing category exposes auto-print');

-- set: round-trip + audit row
SELECT lives_ok($$SELECT set_setting_v1('display_slogan', to_jsonb('Test slogan'::text), 'customer_display')$$,
  'set display_slogan accepts a string');
SELECT is(
  (SELECT count(*) FROM audit_logs WHERE action='setting.update'
     AND metadata->>'key'='display_slogan')::int >= 1,
  true, 'set_setting_v1 audits the change');

SELECT * FROM finish();
ROLLBACK;
```

  (Adapter le préambule d'authentification au pattern des suites settings existantes —
  chercher `set_setting_v1` dans `supabase/tests/` et reprendre leur seed JWT à l'identique.)

- [ ] **Step 4 (CONTROLLER-ONLY): appliquer** — MCP `apply_migration`
  (`project_id='ikcyvlovptebroadgtvd'`, `name='settings_org_display_printing'`, body = le
  fichier). Puis exécuter le pgTAP via MCP `execute_sql` (enveloppe BEGIN…ROLLBACK,
  capture temp-table) → **8/8**.

- [ ] **Step 5:** `git add supabase/ && git commit -m "feat(db): org-level customer display + printing settings, categories customer_display/printing (S73 Lot 2)"`

---

### Task 8: Types regen (CONTROLLER-ONLY)

**Files:**
- Modify: `packages/supabase/src/types.generated.ts`

- [ ] **Step 1:** MCP `generate_typescript_types` → écrire le résultat dans
  `packages/supabase/src/types.generated.ts`.
- [ ] **Step 2:** `git diff packages/supabase/src/types.generated.ts` — vérifier que le diff
  ne contient QUE les 4 colonnes (si du drift étranger d'une session parallèle apparaît :
  édition ciblée au lieu du regen complet, cf. MEMORY types_regen_parallel_sessions).
- [ ] **Step 3:** `pnpm --filter @breakery/supabase build && pnpm typecheck` → verts.
- [ ] **Step 4:** `git commit -m "chore(types): regen after _159 (S73 Lot 2)"`

---

### Task 9: POS — hooks org + consommateurs + cleanup store

**Files:**
- Create: `apps/pos/src/features/settings/hooks/useOrgDisplaySettings.ts`
- Modify: `apps/pos/src/features/payment/SuccessModal.tsx:164-165`
- Modify: `apps/pos/src/features/display/CustomerDisplayPage.tsx:47-49`
- Modify: `apps/pos/src/features/display/components/CDBrandPanel.tsx:21-23`
- Modify: `apps/pos/src/features/settings/components/DisplaySettingsTab.tsx` (édition → DB)
- Modify: `apps/pos/src/features/settings/components/PrintingSettingsTab.tsx` (toggles → DB)
- Modify: `apps/pos/src/stores/posSettingsStore.ts` (retrait des 4 champs)
- Tests: `apps/pos/src/stores/__tests__/posSettingsStore.test.ts`,
  `apps/pos/src/features/payment/__tests__/success-modal-auto-toggles.smoke.test.tsx`,
  `success-modal-loyalty.smoke.test.tsx`, settings smoke tests

**Interfaces:**
- Produces:

```ts
// useOrgDisplaySettings.ts
export interface OrgDisplaySettings {
  displayFooterMessage: string;   // '' = built-in default
  displaySlogan: string;          // '' = built-in default
  autoPrint: boolean;             // pos_auto_print_receipt
  autoOpenDrawer: boolean;        // pos_auto_open_drawer
}
export function useOrgDisplaySettings(): OrgDisplaySettings & { isLoading: boolean };
export function useSetOrgDisplaySetting(): UseMutationResult<void, Error,
  { key: 'display_footer_message' | 'display_slogan' | 'pos_auto_print_receipt' | 'pos_auto_open_drawer';
    value: string | boolean;
    category: 'customer_display' | 'printing' }>;
```

- [ ] **Step 1: écrire le hook** (complet) :

```ts
// apps/pos/src/features/settings/hooks/useOrgDisplaySettings.ts
//
// S73 Lot 2 — org-level customer-display copy + payment auto-toggles, read
// straight off business_config (RLS auth_read; kiosk JWT on the paired
// display). Degrades to the built-in defaults while loading / on error — a
// config read must never block an encaissement (pattern: useTaxRate).
// Writes go through set_setting_v1 (settings.update gate, audit-logged).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Json } from '@breakery/supabase';
import { supabase } from '@/lib/supabase';

const QUERY_KEY = ['business-config', 'org-display-settings'] as const;

export interface OrgDisplaySettings {
  displayFooterMessage: string;
  displaySlogan: string;
  autoPrint: boolean;
  autoOpenDrawer: boolean;
}

const DEFAULTS: OrgDisplaySettings = {
  displayFooterMessage: '',
  displaySlogan: '',
  autoPrint: true,
  autoOpenDrawer: true,
};

export function useOrgDisplaySettings(): OrgDisplaySettings & { isLoading: boolean } {
  const { data, isLoading } = useQuery({
    queryKey: QUERY_KEY,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('business_config')
        .select('display_footer_message, display_slogan, pos_auto_print_receipt, pos_auto_open_drawer')
        .limit(1)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
  });
  return {
    displayFooterMessage: data?.display_footer_message ?? DEFAULTS.displayFooterMessage,
    displaySlogan: data?.display_slogan ?? DEFAULTS.displaySlogan,
    autoPrint: data?.pos_auto_print_receipt ?? DEFAULTS.autoPrint,
    autoOpenDrawer: data?.pos_auto_open_drawer ?? DEFAULTS.autoOpenDrawer,
    isLoading,
  };
}

export function useSetOrgDisplaySetting() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ key, value, category }: {
      key: 'display_footer_message' | 'display_slogan' | 'pos_auto_print_receipt' | 'pos_auto_open_drawer';
      value: string | boolean;
      category: 'customer_display' | 'printing';
    }) => {
      const { error } = await supabase.rpc('set_setting_v1', {
        p_key: key,
        p_value: value as unknown as Json,
        p_category: category,
      });
      if (error) throw error;
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
```

- [ ] **Step 2: tests rouges d'abord.** Adapter `success-modal-auto-toggles.smoke.test.tsx` :
  les `usePosSettingsStore.setState({ autoPrint: … })` deviennent des mocks du hook :

```tsx
vi.mock('@/features/settings/hooks/useOrgDisplaySettings', () => ({
  useOrgDisplaySettings: vi.fn(() => ({ displayFooterMessage: '', displaySlogan: '',
    autoPrint: true, autoOpenDrawer: true, isLoading: false })),
}));
// puis par test : vi.mocked(useOrgDisplaySettings).mockReturnValue({ …, autoPrint: false, … })
```

  → run : FAIL tant que SuccessModal lit encore le store.

- [ ] **Step 3: basculer les consommateurs.**
  - `SuccessModal.tsx:164-165` → `const { autoPrint, autoOpenDrawer } = useOrgDisplaySettings();`
  - `CustomerDisplayPage.tsx:48-49` → `const { displayFooterMessage } = useOrgDisplaySettings();`
    puis `const idleFooter = displayFooterMessage || DEFAULT_DISPLAY_FOOTER;`
  - `CDBrandPanel.tsx:22-23` → même pattern avec `displaySlogan || DEFAULT_DISPLAY_SLOGAN`.
  - `DisplaySettingsTab.tsx` : lit `useOrgDisplaySettings()`, édite en draft local +
    bouton Save par champ appelant `useSetOrgDisplaySetting().mutate({ key, value, category: 'customer_display' })`
    (toast succès/erreur comme GeneralTab) ; `ScopeBadge scope="org"` (remplace `terminal`
    posé au Lot 1) ; `disabled={readOnly || mutation.isPending}`.
  - `PrintingSettingsTab.tsx` : les 2 `SettingToggle` lisent `useOrgDisplaySettings()` et
    écrivent `useSetOrgDisplaySetting().mutate({ key: 'pos_auto_print_receipt'|'pos_auto_open_drawer', value, category: 'printing' })` ;
    badge du bloc toggles → `org`, le champ URL garde son badge `terminal`.

- [ ] **Step 4: cleanup `posSettingsStore.ts`** — retirer `autoPrint`, `autoOpenDrawer`,
  `displayFooterMessage`, `displaySlogan` (+ setters l.59-60/63-64, DEFAULTS l.46-47/50-51,
  partialize l.72-73/76-77, types l.21-22/30-31). Puis
  `grep -rn "autoPrint\|autoOpenDrawer\|displayFooterMessage\|displaySlogan" apps/pos/src`
  → ne doit rester QUE le nouveau hook et ses consommateurs/mocks. Mettre à jour
  `posSettingsStore.test.ts` (retirer les asserts des champs supprimés) et
  `success-modal-loyalty.smoke.test.tsx` (le `setState` ne doit plus poser ces clés).
  NB : la clé localStorage `pos:settings` conserve d'anciens champs orphelins chez les
  terminaux existants — inoffensif (zustand ignore les clés inconnues), ne pas migrer.

- [ ] **Step 5:** `pnpm --filter @breakery/pos test settings payment display stores && pnpm --filter @breakery/pos typecheck && pnpm --filter @breakery/pos lint` → verts.
- [ ] **Step 6:** `git commit -m "feat(pos): customer-display copy + auto toggles read org business_config, drop localStorage copies (S73 Lot 2)"`

---

### Task 10: BO — pages Customer Display + Printing

**Files:**
- Modify: `apps/backoffice/src/features/settings/hooks/useSettings.ts:10` (type)
- Create: `apps/backoffice/src/pages/settings/SettingsCustomerDisplayPage.tsx`
- Create: `apps/backoffice/src/pages/settings/SettingsPrintingPage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` (2 routes, gate `settings.read`, pattern l.898-905)
- Modify: `apps/backoffice/src/pages/settings/SettingsHubPage.tsx:60,74` (tuiles → `to:`)
- Test: `apps/backoffice/src/features/settings/__tests__/settings-customer-display-page.smoke.test.tsx`
  (+ idem printing)

**Interfaces:**
- Consumes: Task 7 (catégories `customer_display`/`printing`), `useSettings`/`useSetSetting`.
- Produces: routes `/backoffice/settings/customer-display` et `/backoffice/settings/printing`.

- [ ] **Step 1:** `useSettings.ts:10` →

```ts
export type SettingsCategory =
  | 'business' | 'localization' | 'tax' | 'pos' | 'inventory' | 'payments'
  | 'pos_presets' | 'customer_display' | 'printing';
```

- [ ] **Step 2: page Customer Display** (complète — même squelette pour Printing) :

```tsx
// apps/backoffice/src/pages/settings/SettingsCustomerDisplayPage.tsx
//
// S73 Lot 2 — org-level customer display copy (business_config via
// get_settings_by_category_v1('customer_display') / set_setting_v1).
// The POS display reads the same keys; '' = built-in default.
import { useEffect, useState } from 'react';
import { Button } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

const FIELDS = [
  { key: 'display_footer_message', label: 'Idle footer message', max: 120,
    helper: "Shown when no order is active. Blank = built-in default (Open daily · 07:00 — 21:00)." },
  { key: 'display_slogan', label: 'Brand slogan', max: 80,
    helper: 'Shown under the logo. Blank = built-in default (French Bakery & Pastry).' },
] as const;

export default function SettingsCustomerDisplayPage() {
  const canUpdate = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('customer_display');
  const setSetting = useSetSetting();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setDraft({
      display_footer_message: String(data.settings['display_footer_message'] ?? ''),
      display_slogan: String(data.settings['display_slogan'] ?? ''),
    });
  }, [data]);

  const dirty = FIELDS.filter((f) => draft[f.key] !== String(data?.settings[f.key] ?? ''));

  async function handleSave() {
    setServerError(null);
    try {
      for (const f of dirty) {
        await setSetting.mutateAsync({ key: f.key, value: draft[f.key] ?? '', category: 'customer_display' });
      }
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Save failed');
    }
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="font-serif text-3xl">Customer Display</h1>
        <p className="text-text-secondary text-sm mt-1">
          Copy shown on every customer-facing display (all terminals). Audited on change.
        </p>
      </div>
      {isLoading && <div className="text-text-secondary">Loading…</div>}
      {error && <div className="text-red">Failed to load: {error.message}</div>}
      {!isLoading && !error && (
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
          {FIELDS.map((f) => (
            <div key={f.key} className="space-y-1">
              <label htmlFor={f.key} className="text-sm font-medium">{f.label}</label>
              <input id={f.key} type="text" maxLength={f.max} disabled={!canUpdate}
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                className="h-9 w-full rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary disabled:opacity-50" />
              <p className="text-xs text-text-secondary">{f.helper}</p>
            </div>
          ))}
          {serverError && <p className="text-red text-sm" role="alert">{serverError}</p>}
          {canUpdate && (
            <Button type="submit" variant="primary" disabled={dirty.length === 0 || setSetting.isPending}>
              {setSetting.isPending ? 'Saving…' : dirty.length === 0 ? 'No changes' : `Save ${dirty.length} change${dirty.length === 1 ? '' : 's'}`}
            </Button>
          )}
        </form>
      )}
    </div>
  );
}
```

- [ ] **Step 3: page Printing** — même squelette avec 2 checkboxes booléens
  (`pos_auto_print_receipt` « Auto-print receipt on payment », `pos_auto_open_drawer`
  « Auto-open cash drawer (cash) »), catégorie `'printing'`, titre « Printing », sous-titre
  « Org-wide payment automation. The print-server URL stays per-terminal (POS Settings). »
  Draft typé `Record<string, boolean>`.

- [ ] **Step 4: routes + tuiles.** `routes/index.tsx` : 2 lazy imports + 2 `<Route>` sous
  `settings/…`, `PermissionGate required="settings.read"` (pattern exact l.898-905).
  `SettingsHubPage.tsx` : l.60 → `{ to: '/backoffice/settings/customer-display', title: 'Customer Display', blurb: 'Idle footer + brand slogan (all displays).', icon: Monitor }` ;
  l.74 → `{ to: '/backoffice/settings/printing', title: 'Printing', blurb: 'Auto-print + drawer automation (org-wide).', icon: Printer }`.

- [ ] **Step 5: smoke tests** (pattern des smoke settings existants dans
  `apps/backoffice/src/features/settings/__tests__/` — mock supabase rpc, render, assert
  labels + disabled sans permission). Un fichier par page, 2-3 asserts chacun.

- [ ] **Step 6:** `pnpm --filter @breakery/backoffice test settings && pnpm --filter @breakery/backoffice typecheck && pnpm lint` → verts.
- [ ] **Step 7:** `git commit -m "feat(backoffice): Customer Display + Printing org settings pages (S73 Lot 2)"`
  puis ouvrir la **PR Lot 2** (base = branche Lot 1).
