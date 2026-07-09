# Stock Management Audit Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal :** corriger les 22 findings de l'audit [`docs/audit/archive/2026-06-12-stock-management-audit.md`](../../audit/archive/2026-06-12-stock-management-audit.md) — 4 critiques (pages mortes, 2 crons en échec silencieux, production sans section), 7 majeurs, 11 mineurs — en 4 waves committables indépendamment.

**Architecture :** Wave A = hotfixes front purs (résurrection immédiate des 4 pages mortes, zéro DB). Wave B = correctives DB (NAME-block `20260626000010..016`, pattern corrective S25/S38 : `CREATE OR REPLACE` sans bump quand la signature ne change pas). Wave C = navigation + config. Wave D = data cleanup + docs + E2E de régression. Branche : `swarm/stock-audit-fixes` (ou `fix/stock-audit` si hors session swarm).

**Tech stack :** React 18 + TanStack Query (BO), Supabase cloud V3 dev `ikcyvlovptebroadgtvd` via MCP (`apply_migration` / `execute_sql`), pgTAP via `execute_sql` enveloppe `BEGIN...ROLLBACK`, Vitest, Playwright.

---

## Hors scope (décisions actées, ne pas implémenter ici)

| Finding | Décision |
|---|---|
| **M3 — FIFO réel** (consommation par lots) | **Spec séparée obligatoire.** Toucherait `complete_order_with_payment_v11` (POS), `record_production_v1`, `waste_stock_v1`, les transfers. Un fix partiel (créer des lots sans consommer dessus) ferait auto-waster du stock déjà vendu une fois le cron C2 réparé → dangereux. Écrire `docs/workplan/specs/2026-06-XX-fifo-consumption-spec.md` avant tout code. |
| **m2 — parents de variantes stockables** | Décision produit requise (un parent porte-t-il du stock ?). Documenté en D2, pas de code. |
| **m8 — auto-submit PIN 6 digits** | Hors module stock (login POS/BO partagé). Ticket séparé. |
| **m9/m10/m11** | Conventions à documenter (D2), pas des bugs. |

**Prérequis exécution :** dev server BO up (`pnpm --filter @breakery/app-backoffice dev`), MCP Supabase configuré. Vérifier la base de numérotation : `mcp list_migrations` → le dernier NAME-block est `20260625000016` (S41) ; ce plan utilise `20260626000010..016`.

---

# WAVE A — Hotfixes front (résurrection des pages mortes)

### Task A1 : C1 — lier `supabase.rpc` dans les 8 hooks cassés + garde de régression

**Files:**
- Modify: `apps/backoffice/src/features/inventory-opname/hooks/useOpnameMutations.ts:19-21`
- Modify: `apps/backoffice/src/features/inventory-movements/hooks/useStockMovementsFeed.ts:48`
- Modify: `apps/backoffice/src/features/inventory-movements/hooks/useMovementAggregates.ts:27`
- Modify: `apps/backoffice/src/features/inventory-alerts/hooks/useLowStock.ts:25`
- Modify: `apps/backoffice/src/features/inventory-alerts/hooks/useReorderSuggestions.ts:27`
- Modify: `apps/backoffice/src/features/inventory-alerts/components/ProductionAlertsTab.tsx:32`
- Modify: `apps/backoffice/src/features/inventory-dashboard/hooks/useProductDashboard.ts:75`
- Modify: `apps/backoffice/src/features/print-queue/hooks/useCancelPrintJob.ts:13`
- Test: `apps/backoffice/src/__tests__/no-unbound-supabase-rpc.test.ts` (create)

Contexte : `supabase.rpc` est une **méthode** qui utilise `this.rest` en interne. L'extraire (`const rpc = supabase.rpc as ...` ou `return supabase.rpc as ...`) puis l'appeler sans receveur donne `this === undefined` → `TypeError: Cannot read properties of undefined (reading 'rest')`. Les casts inline `(supabase.rpc as X)(...)` conservent le binding et ne sont PAS concernés (transfers/purchasing fonctionnent).

- [ ] **Step 1 : écrire le test de régression (échoue avant fix)**

```ts
// apps/backoffice/src/__tests__/no-unbound-supabase-rpc.test.ts
// Garde de régression C1 (audit 2026-06-12) : interdit d'extraire supabase.rpc
// sans .bind(supabase) — l'appel non lié casse avec "reading 'rest'".
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { globSync } from 'glob';

const SRC = join(__dirname, '..');
// Capture `= supabase.rpc as` et `return supabase.rpc as` SANS .bind — les
// casts inline `(supabase.rpc as ...)(` restent autorisés (binding conservé).
const UNBOUND = /(?:=|return)\s+supabase\.rpc\s+as\s/;

describe('no unbound supabase.rpc extraction', () => {
  it('every file binds supabase.rpc before extracting it', () => {
    const offenders: string[] = [];
    for (const file of globSync('**/*.{ts,tsx}', { cwd: SRC, ignore: ['**/__tests__/**'] })) {
      const text = readFileSync(join(SRC, file), 'utf8');
      if (UNBOUND.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2 : lancer le test, vérifier qu'il échoue en listant les 8 fichiers**

Run: `pnpm --filter @breakery/app-backoffice test no-unbound-supabase-rpc`
Expected: FAIL — `offenders` contient les 8 chemins ci-dessus.

- [ ] **Step 3 : corriger les 8 fichiers — même diff partout**

Pattern « return » (useOpnameMutations, useStockMovementsFeed, useMovementAggregates, useLowStock, useReorderSuggestions, useCancelPrintJob) :

```ts
// AVANT
function rpc(): RpcFn {
  return supabase.rpc as unknown as RpcFn;
}
// APRÈS
function rpc(): RpcFn {
  return supabase.rpc.bind(supabase) as unknown as RpcFn;
}
```

Pattern « const » (useProductDashboard:75, ProductionAlertsTab:32) :

```ts
// AVANT
const rpc = supabase.rpc as unknown as RpcFn;
// APRÈS
const rpc = supabase.rpc.bind(supabase) as unknown as RpcFn;
```

- [ ] **Step 4 : re-lancer le test + typecheck**

Run: `pnpm --filter @breakery/app-backoffice test no-unbound-supabase-rpc` → PASS
Run: `pnpm --filter @breakery/app-backoffice typecheck` → PASS

- [ ] **Step 5 : vérification navigateur (les 4 pages ressuscitent)**

Avec le dev server up et une session loguée (PIN 123456, rate-limit 3/min — un seul login) :
`playwright-cli open http://localhost:5174 --headed` → login → visiter `/backoffice/inventory/movements` (la table charge), `/backoffice/inventory/alerts` (3 onglets sans alerte d'erreur), `/backoffice/inventory/opname` → New count → Create (la session de comptage se crée), `/backoffice/products/<id>/dashboard`. Zéro `reading 'rest'` en console.

- [ ] **Step 6 : commit**

```bash
git add apps/backoffice/src
git commit -m "fix(backoffice): bind supabase.rpc in 8 hooks — resurrects opname, movements, alerts, product dashboard (audit C1)"
```

---

### Task A2 : C4-front — section obligatoire sur Production (single + batch) et normalisation `'' → null`

**Files:**
- Modify: `apps/backoffice/src/features/inventory-production/components/ProductionForm.tsx:64,137,285`
- Modify: `apps/backoffice/src/features/inventory-production/hooks/useRecordProduction.ts:39-40,84,95`
- Modify: `apps/backoffice/src/pages/inventory/BatchProductionPage.tsx` (champ Section)
- Test: `apps/backoffice/src/features/inventory-production/__tests__/production-section-required.test.tsx` (create)

Contexte : le CHECK `chk_stock_movements_section_required` exige au moins une section pour `production_*`. Une production sans section est donc **impossible au niveau DB** — l'UI doit l'exiger au lieu d'afficher « optional » puis crasher (`""` → 22P02 en single, NULL → 23514 en batch).

- [ ] **Step 1 : test — le bouton submit reste disabled sans section**

```tsx
// production-section-required.test.tsx — smoke : ProductionForm n'autorise pas
// le submit sans section (audit C4). Mock supabase comme les smokes existants
// du dossier (reprendre le setup de BatchProductionPage.smoke.test.tsx).
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
// ... même harness de mock/providers que BatchProductionPage.smoke.test.tsx ...

describe('ProductionForm section required', () => {
  it('submit disabled tant que la section est vide', async () => {
    // render(<ProductionForm ... />) avec produit + yields remplis, section ''
    expect(screen.getByRole('button', { name: /record production/i })).toBeDisabled();
  });
});
```

- [ ] **Step 2 : lancer le test → FAIL** (le bouton est enabled aujourd'hui dès produit+yield remplis)

Run: `pnpm --filter @breakery/app-backoffice test production-section-required`

- [ ] **Step 3 : implémenter**

`ProductionForm.tsx` :
- ligne 285 : label `Section (optional)` → `Section` ; ajouter `required` sur le `<select>`.
- condition de validité du submit : ajouter `&& sectionId !== ''`.

`useRecordProduction.ts` :
- ligne 39-40 : remplacer le commentaire « Empty string sent to server » par `/** UUID de section — REQUIS (CHECK chk_stock_movements_section_required côté DB). */`
- défense en profondeur ligne 95 : `p_section_id: args.sectionId,` → ne jamais envoyer `''` :

```ts
      if (args.sectionId === '') {
        throw new RecordProductionError('section_not_found', 'section_required');
      }
```

`BatchProductionPage.tsx` : même traitement — label sans « optional », `required`, submit disabled si section vide.

- [ ] **Step 4 : tests + typecheck**

Run: `pnpm --filter @breakery/app-backoffice test production-section-required` → PASS
Run: `pnpm --filter @breakery/app-backoffice test inventory-production` → PASS (suite existante)

- [ ] **Step 5 : commit**

```bash
git add apps/backoffice/src/features/inventory-production apps/backoffice/src/pages/inventory/BatchProductionPage.tsx
git commit -m "fix(backoffice): production section is required — was 'optional' then 22P02/23514 (audit C4 front)"
```

---

### Task A3 : M1 — les pickers stock filtrent `track_inventory`, plus `is_active`

**Files:**
- Modify: `apps/backoffice/src/features/inventory/hooks/useProductsForInventory.ts:35`
- Test: `apps/backoffice/src/features/inventory/__tests__/products-typeahead-filter.test.ts` (create)

Contexte : `is_active` = « vendable au POS ». Les 15 ingrédients sont `is_active=false` mais `track_inventory=true` (vérifié en DB) → introuvables dans Adjust/Receive/Waste alors que la table de la page les affiche. Le bon filtre stock est `track_inventory`.

- [ ] **Step 1 : test — la requête utilise track_inventory et pas is_active**

```ts
// products-typeahead-filter.test.ts — assert sur le builder PostgREST mocké :
// le typeahead inventaire filtre track_inventory=true et n'exclut PAS les
// produits is_active=false (audit M1 : ingrédients invisibles des modals).
import { describe, expect, it, vi } from 'vitest';
const eq = vi.fn().mockReturnThis();
vi.mock('@/lib/supabase.js', () => ({
  supabase: { from: vi.fn(() => ({ select: vi.fn().mockReturnThis(), is: vi.fn().mockReturnThis(), eq, ilike: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue({ data: [], error: null }) })) },
}));
// renderHook(useProductsForInventory('flour')) via @testing-library/react +
// QueryClientProvider, attendre le settle, puis :
//   expect(eq).toHaveBeenCalledWith('track_inventory', true);
//   expect(eq).not.toHaveBeenCalledWith('is_active', true);
```

- [ ] **Step 2 : lancer → FAIL**

Run: `pnpm --filter @breakery/app-backoffice test products-typeahead-filter`

- [ ] **Step 3 : fix une ligne**

```ts
        .is('deleted_at', null)
        .eq('track_inventory', true)   // était .eq('is_active', true) — audit M1
```

- [ ] **Step 4 : tests → PASS, puis vérif navigateur** : modal Receive → taper « Flour » → le produit apparaît.

- [ ] **Step 5 : commit**

```bash
git add apps/backoffice/src/features/inventory
git commit -m "fix(backoffice): inventory pickers filter track_inventory not is_active — ingredients were unreachable (audit M1)"
```

---

### Task A4 : M4 — surfacing d'erreur honnête (Alerts « All clear » + « Error: unknown »)

**Files:**
- Modify: `apps/backoffice/src/pages/inventory/AlertsPage.tsx:61-66`
- Modify: `apps/backoffice/src/features/inventory-production/components/ProductionForm.tsx` (rendu de l'alerte)
- Modify: `apps/backoffice/src/pages/inventory/BatchProductionPage.tsx` (rendu de l'alerte)
- Test: `apps/backoffice/src/features/inventory-alerts/__tests__/alerts-status-error.test.tsx` (create)

- [ ] **Step 1 : test — la card Status n'affiche jamais « All clear » quand la query a échoué**

```tsx
// alerts-status-error.test.tsx : mocker useLowStock pour retourner
// { data: undefined, error: new Error('boom'), isLoading: false } et asserter
// que le tile Status affiche 'Unavailable' et PAS 'All clear'.
```

- [ ] **Step 2 : lancer → FAIL** (aujourd'hui `counts.total === 0` → « All clear » même en erreur)

- [ ] **Step 3 : fix AlertsPage**

```tsx
        <KpiTile
          label="Status"
          value={
            lowStock.error !== null ? 'Unavailable'
            : counts.total === 0    ? 'All clear'
            :                         'Action needed'
          }
          icon={ShoppingCart}
          footer={lowStock.error !== null ? 'Failed to load — check console / retry' : undefined}
        />
```

- [ ] **Step 4 : fix « Error: unknown » sur les 2 pages production** — quand `classify()` retourne `'unknown'`, afficher le message serveur brut au lieu du code :

```tsx
// dans le rendu de l'alerte d'erreur (les deux pages) :
{mutError !== null && (
  <div role="alert" className="...">
    {mutError.code === 'unknown'
      ? `Erreur serveur : ${mutError.message}`
      : LABELS[mutError.code]}
  </div>
)}
```

- [ ] **Step 5 : tests + commit**

Run: `pnpm --filter @breakery/app-backoffice test alerts-status-error` → PASS

```bash
git add apps/backoffice/src
git commit -m "fix(backoffice): honest error surfacing — no false 'All clear', raw server message instead of 'Error: unknown' (audit M4)"
```

---

### Task A5 : mineurs UI recettes (m3, m5, m6, m7)

**Files:**
- Modify: `apps/backoffice/src/pages/inventory/RecipeEditorPage.tsx` (labels du `<select>` produit)
- Modify: `apps/backoffice/src/features/inventory-production/components/RecipeEditor.tsx` (DndContext + libellé History)
- Modify: `apps/backoffice/src/pages/inventory/BatchProductionPage.tsx` (aria-label)

- [ ] **Step 1 : m3 — ajouter le SKU aux options du picker recettes.** Localiser le `<option>` (grep `'(pcs)'` ou `.unit})` dans RecipeEditorPage) et passer le label de `` `${p.name} (${p.unit})` `` à `` `${p.name} — ${p.sku} (${p.unit})` ``. Les 5 paires d'homonymes (American Bagel ×2, Flat White ×3, Pain au Chocolat ×2, Cheesy Brie ×2, Sourdough ×2) deviennent distinguables.

- [ ] **Step 2 : m5 — supprimer le warning validateDOMNesting.** Dans `RecipeEditor.tsx`, le `<DndContext>` de dnd-kit rend son annonce a11y (`HiddenText`, un `<div>`) DANS le `<table>`. Fix : sortir l'annonceur du tableau via le prop officiel :

```tsx
<DndContext
  accessibility={{ container: document.body }}
  /* ...props existants inchangés... */
>
```

- [ ] **Step 3 : m6 — espace badge diff + locale date.** Dans le composant History (grep `added` dans `features/inventory-production/components/`), le badge est collé au nom (« Butteradded »). Ajouter `className="ml-1"` (ou un espace) au `<span>` du badge. Pour les dates : remplacer le `toLocaleDateString('id-ID', ...)` (ou `Intl.DateTimeFormat('id-ID')`) par `'en-US'` pour matcher le reste du BO — grep `id-ID` dans le dossier pour trouver le site exact.

- [ ] **Step 4 : m7 — aria-label.** Dans `BatchProductionPage.tsx`, le combobox recette a `aria-label="Search ingredient"` avec placeholder « Search recipe… » : aligner sur `aria-label="Search recipe"`.

- [ ] **Step 5 : sweep tests + commit**

Run: `pnpm --filter @breakery/app-backoffice test recipes` et `test inventory-production` → PASS (pas de régression)

```bash
git add apps/backoffice/src
git commit -m "fix(backoffice): recipe picker SKU labels, dnd a11y container, history badge spacing, locale + aria fixes (audit m3/m5/m6/m7)"
```

---

# WAVE B — Correctives DB (migrations `20260626000010..016`)

> Toutes via MCP `apply_migration` sur `ikcyvlovptebroadgtvd`, pgTAP via `execute_sql` en `BEGIN...ROLLBACK`. Vérifier la base AVANT : `list_migrations` → max NAME = `20260625000016`. Pattern corrective : `CREATE OR REPLACE` quand la signature ne change pas (précédent S38 `_011..015`).

### Task B1 : C2 — réparer le cron spoilage (`mark_expired_lots_hourly` échoue toutes les heures)

**Files:**
- Migration: `20260626000010_fix_stock_movement_cron_context.sql`
- Test: pgTAP inline (BEGIN/ROLLBACK)

Cause : `record_stock_movement_v1` fait `SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid` ; sous cron `auth.uid()` est NULL → `RAISE 'forbidden' P0003`. `stock_movements.created_by` est NOT NULL → il faut un profil SYSTEM.

- [ ] **Step 1 : récupérer la définition exacte de la primitive**

Via MCP `execute_sql` : `SELECT pg_get_functiondef('public.record_stock_movement_v1'::regproc);` — conserver le texte intégral, la migration le réécrit.

- [ ] **Step 2 : écrire la migration**

```sql
-- 20260626000010_fix_stock_movement_cron_context.sql
-- Audit 2026-06-12 C2 : le cron mark_expired_lots_hourly échoue à CHAQUE run
-- ('forbidden' P0003) car auth.uid() est NULL hors PostgREST. On seed un
-- profil SYSTEM non-loggable et la primitive l'utilise comme acteur quand
-- (auth.uid() IS NULL AND session_user = 'postgres') — PostgREST se connecte
-- en 'authenticator', donc anon/authenticated ne passent JAMAIS cette branche.

INSERT INTO public.user_profiles (id, employee_code, full_name, pin_hash, role_code)
VALUES ('00000000-0000-0000-0000-000000000999', 'SYS-CRON', 'System (cron)',
        'no-login', 'SUPER_ADMIN')          -- pin_hash non-bcrypt → aucun PIN ne matche
ON CONFLICT (id) DO NOTHING;

-- CREATE OR REPLACE record_stock_movement_v1 : coller la définition du Step 1
-- INTÉGRALEMENT, en remplaçant uniquement le bloc gate :
--   SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
--   IF v_profile IS NULL THEN
--     RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
--   END IF;
-- par :
--   SELECT id INTO v_profile FROM user_profiles WHERE auth_user_id = v_uid AND deleted_at IS NULL;
--   IF v_profile IS NULL THEN
--     IF v_uid IS NULL AND session_user = 'postgres' THEN
--       v_profile := '00000000-0000-0000-0000-000000000999';  -- SYSTEM (cron)
--     ELSE
--       RAISE EXCEPTION 'forbidden' USING ERRCODE='P0003';
--     END IF;
--   END IF;
-- Signature INCHANGÉE → pas de bump, pas de REVOKE à rejouer (ACL conservées
-- par CREATE OR REPLACE).
```

- [ ] **Step 3 : appliquer via MCP `apply_migration`** (name `fix_stock_movement_cron_context`).

- [ ] **Step 4 : test pgTAP (exécuté en postgres via MCP — exerce exactement la branche cron)**

```sql
BEGIN;
SELECT plan(3);
-- T1 : la primitive accepte le contexte cron (auth.uid() NULL, session_user postgres)
SELECT lives_ok($$ SELECT record_stock_movement_v1(
  p_product_id => (SELECT id FROM products WHERE sku='PAS-CROI'),
  p_movement_type => 'waste'::movement_type, p_quantity => -1,
  p_reason => 'pgtap cron-context test', p_unit_cost => NULL, p_supplier_id => NULL,
  p_idempotency_key => NULL, p_unit => 'pcs', p_from_section_id => NULL,
  p_to_section_id => NULL, p_metadata => '{}'::jsonb) $$, 'cron context accepted');
-- T2 : l'acteur est le profil SYSTEM
SELECT is((SELECT created_by FROM stock_movements ORDER BY created_at DESC LIMIT 1),
  '00000000-0000-0000-0000-000000000999'::uuid, 'actor = SYSTEM profile');
-- T3 : le wrapper cron complet tourne sans erreur
SELECT lives_ok($$ SELECT mark_expired_lots_hourly() $$, 'cron function runs');
SELECT * FROM finish();
ROLLBACK;
```

Expected: 3/3 PASS.

- [ ] **Step 5 : vérifier au prochain run réel** : `SELECT status, return_message FROM cron.job_run_details r JOIN cron.job j ON j.jobid=r.jobid WHERE j.jobname='mark_expired_lots_hourly' ORDER BY end_time DESC LIMIT 1;` → `succeeded`.

- [ ] **Step 6 : commit du fichier migration**

```bash
git add supabase/migrations/20260626000010_fix_stock_movement_cron_context.sql
git commit -m "fix(db): stock movement primitive accepts cron context via SYSTEM profile — spoilage cron failed hourly since deploy (audit C2)"
```

---

### Task B2 : C3 — réparer le cron marges (`numeric field overflow` quotidien)

**Files:**
- Migration: `20260626000011_widen_margin_alerts_pct_columns.sql`

Cause : `margin_alerts.expected_margin_pct` et `target_margin_pct` sont NUMERIC(5,2) (max ±999.99) ; la fonction calcule en DECIMAL(7,2) — un produit à cost élevé / prix faible déborde à l'INSERT. Échec quotidien depuis ~2026-05-17 (Margin Watch figé).

- [ ] **Step 1 : migration**

```sql
-- 20260626000011_widen_margin_alerts_pct_columns.sql
-- Audit 2026-06-12 C3 : recompute-recipe-margins-daily échoue chaque jour
-- (numeric overflow 5,2). Aligne les colonnes sur le type de calcul (7,2).
ALTER TABLE public.margin_alerts
  ALTER COLUMN expected_margin_pct TYPE NUMERIC(7,2),
  ALTER COLUMN target_margin_pct   TYPE NUMERIC(7,2);
```

- [ ] **Step 2 : appliquer via MCP, puis exécuter la fonction à la main**

`SELECT public.recompute_recipe_margins_v1();` via `execute_sql` → doit retourner son JSON de stats sans erreur.

- [ ] **Step 3 : vérifier le rafraîchissement** : `SELECT max(computed_at) FROM margin_alerts;` (ou la colonne de date que porte la table — la vérifier via `information_schema.columns`) → timestamp du jour. Recharger `/backoffice/inventory/production/margin-watch` : colonne Computed au 2026-06-12.

- [ ] **Step 4 : types regen** (changement de type de colonne) : MCP `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`.

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/20260626000011_widen_margin_alerts_pct_columns.sql packages/supabase/src/types.generated.ts
git commit -m "fix(db): widen margin_alerts pct columns to NUMERIC(7,2) — daily margins cron failed since 2026-05-17 (audit C3)"
```

---

### Task B3 : C4-batch — erreur claire `section_required` dans `record_batch_production_v1`

**Files:**
- Migration: `20260626000012_batch_production_section_required.sql`

Le front (A2) exige désormais la section, mais le RPC doit refuser proprement un NULL (aujourd'hui : violation CHECK 23514 illisible).

- [ ] **Step 1 : récupérer la définition** : `SELECT pg_get_functiondef('public.record_batch_production_v1'::regproc);`

- [ ] **Step 2 : migration — CREATE OR REPLACE avec garde en tête de corps**

```sql
-- 20260626000012_batch_production_section_required.sql
-- Audit 2026-06-12 C4 : sans section le RPC violait chk_stock_movements_section_required
-- (23514 → 'Error: unknown' à l'écran). Gate explicite, signature inchangée.
-- [coller la définition complète, en insérant juste après BEGIN :]
--   IF p_section_id IS NULL THEN
--     RAISE EXCEPTION 'section_required' USING ERRCODE = 'P0001',
--       HINT = 'production movements require a section (chk_stock_movements_section_required)';
--   END IF;
```

Appliquer la même garde à `record_production_v1` si son `p_section_id` accepte NULL (vérifier dans la définition récupérée en B1/Step 1 — sinon ne pas y toucher).

- [ ] **Step 3 : pgTAP**

```sql
BEGIN;
SELECT plan(1);
SELECT throws_ok(
  $$ SELECT record_batch_production_v1('[{"product_id":"00000000-0000-0000-0000-000000000001","quantity":1,"waste":0}]'::jsonb, NULL, NULL, gen_random_uuid()) $$,
  'P0001', 'section_required', 'NULL section rejected with clear error');
-- NB : adapter l'appel à la signature réelle relevée au Step 1.
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4 : commit**

```bash
git add supabase/migrations/20260626000012_batch_production_section_required.sql
git commit -m "fix(db): record_batch_production_v1 raises clear section_required instead of CHECK 23514 (audit C4)"
```

---

### Task B4 : M2 — solde par section réellement enforced (transfers) + assainissement des négatifs

**Files:**
- Migration: `20260626000013_enforce_section_stock_balance.sql`

État constaté : 7 lignes `section_stock` négatives (dont MAIN_WAREHOUSE -2 créée par le test d'audit) ; `create/receive_internal_transfer_v1` ne vérifie pas le solde source malgré la promesse UI.

- [ ] **Step 1 : récupérer les définitions** de `create_internal_transfer_v1` ET `receive_internal_transfer_v1` (`pg_get_functiondef`). Identifier laquelle émet les `transfer_out` (le « direct receive » passe par les deux).

- [ ] **Step 2 : migration**

```sql
-- 20260626000013_enforce_section_stock_balance.sql
-- Audit 2026-06-12 M2 : transferts acceptés depuis une section vide →
-- section_stock négatif (7 lignes). 3 volets :

-- 1. Data fix : remettre à zéro les soldes négatifs (cache, pas ledger) + trace.
INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
SELECT '00000000-0000-0000-0000-000000000999', 'section_stock.negative_reset',
       'section_stock', ss.section_id,
       jsonb_build_object('product_id', ss.product_id, 'was', ss.quantity,
                          'source', 'audit-2026-06-12 M2 data fix')
FROM section_stock ss WHERE ss.quantity < 0;
UPDATE section_stock SET quantity = 0 WHERE quantity < 0;

-- 2. Garde RPC : dans la fonction qui émet le transfer_out (relevée au Step 1),
--    insérer AVANT l'émission des mouvements, pour chaque ligne du transfert :
--   SELECT quantity INTO v_avail FROM section_stock
--    WHERE section_id = v_from_section AND product_id = v_item.product_id
--    FOR UPDATE;
--   IF COALESCE(v_avail, 0) < v_item.quantity THEN
--     RAISE EXCEPTION 'insufficient_section_stock' USING ERRCODE='P0001',
--       DETAIL = json_build_object('product_id', v_item.product_id,
--         'available', COALESCE(v_avail,0), 'requested', v_item.quantity)::text;
--   END IF;

-- 3. Backstop : contrainte (après data fix).
ALTER TABLE public.section_stock
  ADD CONSTRAINT chk_section_stock_non_negative CHECK (quantity >= 0) NOT VALID;
ALTER TABLE public.section_stock VALIDATE CONSTRAINT chk_section_stock_non_negative;
```

⚠️ Avant le volet 3, vérifier que les flux légitimes n'écrivent jamais de négatif transitoire : `SELECT prosrc FROM pg_proc WHERE proname LIKE '%section_stock%'` + relire le trigger de maintenance du cache. Si un flux légitime (ex. vente non sectionnée) peut décrémenter une section sous 0, NE PAS poser la contrainte — garder seulement les volets 1+2 et documenter (le signaler en INDEX de déviation).

- [ ] **Step 3 : pgTAP**

```sql
BEGIN;
SELECT plan(2);
-- T1 : transfert depuis une section vide → rejet propre
SELECT throws_ok($$ SELECT create_internal_transfer_v1(/* from=CAFE_STORAGE (vide),
  to=FRONT_SALES, items=[{PAS-CROI, qty:1}], direct:=true — adapter à la signature réelle */) $$,
  'P0001', 'insufficient_section_stock', 'empty source rejected');
-- T2 : aucun solde négatif ne subsiste
SELECT is((SELECT count(*)::int FROM section_stock WHERE quantity < 0), 0, 'no negative section stock');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4 : vérif navigateur** : `/backoffice/inventory/transfers/new` → transfert depuis une section vide → l'UI affiche l'erreur claire (plus de faux succès).

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/20260626000013_enforce_section_stock_balance.sql
git commit -m "fix(db): enforce section balance on transfers + reset 7 negative section_stock rows + CHECK backstop (audit M2)"
```

---

### Task B5 : M5 — `production_in` valorisé au coût réellement consommé (+ WAC du produit fini)

**Files:**
- Migration: `20260626000014_production_in_actual_cost_valuation.sql`

Constat chiffré : production 5 pcs → `production_in` valorisé 35 000 (5 × cost_price 7 000) vs 72 300 consommés → 37 300 d'écart muet en 5110, et `cost_price` du fini jamais resynchronisé (coût recette réel 14 450/pc).

- [ ] **Step 1 : récupérer la définition de `record_production_v1`** et localiser : (a) la boucle de consommation (les PERFORM `record_stock_movement_v1` de type `production_out` avec `p_unit_cost => v_material_cost` ou équivalent), (b) l'émission du `production_in` (son `p_unit_cost`).

- [ ] **Step 2 : migration — CREATE OR REPLACE, deux changements internes**

```sql
-- 20260626000014_production_in_actual_cost_valuation.sql
-- Audit 2026-06-12 M5 : le produit fini était valorisé à products.cost_price
-- (stale) au lieu du coût réellement consommé → écart muet en 5110.
-- Changement 1 — accumuler le coût consommé dans la boucle d'ingrédients :
--   DECLARE v_total_consumed NUMERIC(14,2) := 0;
--   ... dans la boucle, après chaque production_out :
--   v_total_consumed := v_total_consumed + (v_required_qty * v_material_cost);
-- Changement 2 — valoriser le production_in à l'unité réelle :
--   p_unit_cost => CASE WHEN p_quantity_produced > 0
--                       THEN round(v_total_consumed / p_quantity_produced, 2)
--                       ELSE NULL END
-- Signature inchangée. Appliquer le MÊME changement dans
-- record_batch_production_v1 (qui duplique ou appelle la logique — vérifier).

-- Changement 3 — le WAC du produit fini suit la production :
-- le trigger tr_update_product_cost_on_purchase ne couvre que 'purchase'.
DROP TRIGGER IF EXISTS tr_update_product_cost_on_purchase ON public.stock_movements;
CREATE TRIGGER tr_update_product_cost_on_purchase
  AFTER INSERT ON public.stock_movements
  FOR EACH ROW
  WHEN (NEW.movement_type IN ('purchase', 'production_in'))
  EXECUTE FUNCTION public.update_product_cost_on_purchase();
-- (relever le nom exact de la fonction du trigger via pg_trigger/pg_proc avant —
--  la formule WAC existante gère déjà le cas old_cost<=0 et la pondération.)
```

- [ ] **Step 3 : pgTAP — l'événement production est désormais équilibré**

```sql
BEGIN;
SELECT plan(2);
-- Seed : stocks ingrédients suffisants (UPDATE direct, test-only), puis :
-- SELECT record_production_v1(<Croissant Beurre>, 5, <section PASTRY>, 0, gen_random_uuid());
-- T1 : valeur du production_in = somme des production_out (à l'arrondi près)
SELECT ok(
  abs( (SELECT sum(quantity * unit_cost) FROM stock_movements
         WHERE movement_type='production_in' AND created_at > now() - interval '1 minute')
     + (SELECT sum(quantity * unit_cost) FROM stock_movements
         WHERE movement_type='production_out' AND created_at > now() - interval '1 minute') ) < 1,
  'production event balanced (in value = out value)');
-- T2 : cost_price du fini ≈ coût BOM (14 450 ± arrondi), plus 7 000
SELECT ok((SELECT cost_price FROM products WHERE sku='PAS-002') > 10000, 'finished cost_price follows BOM');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 4 : non-régression** : re-dérouler dans le navigateur une production complète (avec section) + vérifier les JE émises (requête de l'audit §vérification waste/production) — l'écart 5110 disparaît.

- [ ] **Step 5 : commit**

```bash
git add supabase/migrations/20260626000014_production_in_actual_cost_valuation.sql
git commit -m "fix(db): production_in valued at actual consumed cost + WAC trigger covers production_in (audit M5)"
```

---

### Task B6 : m1 — REVOKE des privilèges superflus sur le ledger

**Files:**
- Migration: `20260626000015_revoke_extra_privileges_stock_tables.sql`

- [ ] **Step 1 : migration**

```sql
-- 20260626000015_revoke_extra_privileges_stock_tables.sql
-- Audit 2026-06-12 m1 : authenticated détenait TRUNCATE/TRIGGER/REFERENCES sur
-- stock_movements. TRUNCATE n'est pas filtré par RLS. Non exploitable via
-- PostgREST, mais contraire à la doctrine REVOKE-all S20 — defense in depth.
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.stock_movements  FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.stock_lots       FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.section_stock    FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.display_stock     FROM authenticated, anon;
REVOKE TRUNCATE, TRIGGER, REFERENCES ON public.display_movements FROM authenticated, anon;
```

- [ ] **Step 2 : pgTAP**

```sql
BEGIN;
SELECT plan(1);
SELECT is((SELECT count(*)::int FROM information_schema.role_table_grants
  WHERE table_name='stock_movements' AND grantee IN ('anon','authenticated')
    AND privilege_type IN ('TRUNCATE','TRIGGER','REFERENCES')), 0, 'ledger extra grants revoked');
SELECT * FROM finish();
ROLLBACK;
```

- [ ] **Step 3 : commit**

```bash
git add supabase/migrations/20260626000015_revoke_extra_privileges_stock_tables.sql
git commit -m "fix(db): revoke TRUNCATE/TRIGGER/REFERENCES on stock tables from authenticated+anon (audit m1)"
```

---

# WAVE C — Navigation & configuration

### Task C1 : M6 — désorpheliner Incoming, Transfers, ExpiringStock

**Files:**
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:89-101` (groupe Stock Management)
- Modify: `apps/backoffice/src/routes/index.tsx` (route expiring)
- Test: `apps/backoffice/src/layouts/__tests__/Sidebar.test.tsx` (étendre)

- [ ] **Step 1 : test — la sidebar contient les 3 nouvelles entrées** (étendre le test existant qui énumère le groupe Stock Management ; asserter la présence de « Incoming », « Transfers », « Expiring stock »).

- [ ] **Step 2 : lancer → FAIL.**

- [ ] **Step 3 : sidebar** — insérer après la ligne 93 (`Stock & Inventory`) :

```tsx
      { to: '/backoffice/inventory/incoming',  label: 'Incoming',       icon: PackagePlus, permission: 'inventory.receive', indent: 1 },
      { to: '/backoffice/inventory/transfers', label: 'Transfers',      icon: ArrowLeftRight, permission: 'inventory.read', indent: 1 },
      { to: '/backoffice/inventory/expiring',  label: 'Expiring stock', icon: TimerOff, permission: 'inventory.read', indent: 1 },
```

(importer `PackagePlus`, `ArrowLeftRight`, `TimerOff` depuis `lucide-react`.)

- [ ] **Step 4 : route ExpiringStockPage** — dans `routes/index.tsx`, ajouter l'import `import ExpiringStockPage from '@/features/inventory/pages/ExpiringStockPage.js';` puis, à côté des routes inventory :

```tsx
        <Route
          path="inventory/expiring"
          element={
            <PermissionGate required="inventory.read">
              <ExpiringStockPage />
            </PermissionGate>
          }
        />
```

- [ ] **Step 5 : tests + vérif navigateur** (3 liens cliquables, pages rendent) **+ commit**

```bash
git add apps/backoffice/src
git commit -m "feat(backoffice): sidebar links for incoming/transfers + route ExpiringStockPage — were orphaned (audit M6)"
```

---

### Task C2 : M7 — éditeur de seuil min de stock

**Files:**
- Modify: `apps/backoffice/src/features/products/components/GeneralPanel.tsx` (champ + patch)
- Test: étendre `apps/backoffice/src/features/products/__tests__/product-detail-save.smoke.test.tsx`

Contexte : `min_stock_threshold = 0` sur 78/78 produits → alerting structurellement vide. L'allowlist de `update_product_v1` contient déjà `min_stock_threshold` (vérifié) → fix front-only.

- [ ] **Step 1 : test — le panel expose un input « Min stock threshold » et le patch l'inclut** (suivre le harness du smoke test existant `product-detail-save` : modifier le champ, save, asserter l'arg RPC `p_patch.min_stock_threshold`).

- [ ] **Step 2 : lancer → FAIL.**

- [ ] **Step 3 : implémenter** dans `GeneralPanel.tsx`, à côté des champs numériques existants (suivre le style du champ retail price) :

```tsx
<label className="...">
  Min stock threshold
  <input type="number" min={0} step="1"
    value={draft.min_stock_threshold ?? 0}
    onChange={(e) => setField('min_stock_threshold', Number(e.target.value))} />
  <span className="text-xs text-text-muted">Sous ce seuil le produit remonte dans Alerts / reorder. 0 = jamais.</span>
</label>
```

(adapter `draft`/`setField` aux noms réels du panel — même mécanique que les 5 toggles S27.)

- [ ] **Step 4 : tests + vérif navigateur** : poser un seuil de 10 sur Croissant → la page Alerts (ressuscitée en A1) liste le produit si stock < 10.

- [ ] **Step 5 : commit**

```bash
git add apps/backoffice/src/features/products
git commit -m "feat(backoffice): editable min_stock_threshold in product general panel — all thresholds were 0 (audit M7)"
```

---

# WAVE D — Data cleanup, docs, E2E de régression

### Task D1 : m4 — nettoyage des données résiduelles (validation owner requise)

**Files:**
- Migration: `20260626000016_data_cleanup_test_residue.sql`

⚠️ **Demander confirmation à l'owner avant d'exécuter** (suppressions de données métier) — lister d'abord, supprimer ensuite.

- [ ] **Step 1 : inventorier l'impact** (via `execute_sql`) : produits dans « S41E2E Cat », mouvements/ordres référant `test_smoke`, produits des catégories « Ingredient » vs « Ingredients ».

- [ ] **Step 2 : migration (après accord)**

```sql
-- 20260626000016_data_cleanup_test_residue.sql
-- Audit 2026-06-12 m4 — dev-DB cleanup (validé owner le JJ/MM) :
-- 1. merge catégorie dupliquée 'Ingredients' → 'Ingredient'
UPDATE products SET category_id = (SELECT id FROM categories WHERE name='Ingredient')
 WHERE category_id = (SELECT id FROM categories WHERE name='Ingredients');
UPDATE categories SET is_active = false, name = 'Ingredients (merged)'
 WHERE name='Ingredients';
-- 2. désactiver les résidus de test (soft, jamais hard — FK order_items)
UPDATE products  SET is_active=false, deleted_at=now() WHERE name='test_smoke' AND deleted_at IS NULL;
UPDATE categories SET is_active=false WHERE name='S41E2E Cat';
-- 3. renommage homonymes (décision owner) : ex. BEV-CAPP 'Flat White' → 'Cappuccino'
-- UPDATE products SET name='Cappuccino' WHERE sku='BEV-CAPP';
```

- [ ] **Step 3 : commit**

```bash
git add supabase/migrations/20260626000016_data_cleanup_test_residue.sql
git commit -m "chore(db): merge duplicate Ingredient category, deactivate test residue (audit m4, owner-approved)"
```

### Task D2 : documentation des conventions + skill à jour

**Files:**
- Modify: `.claude/skills/stock-management/SKILL.md`

- [ ] **Step 1 :** dans la section « Audit checklist » / « Known gaps », acter : C2 réparé (profil SYSTEM `...999`, branche cron dans la primitive — vérifier `session_user='postgres'` si on change de pooler) ; C3 réparé (colonnes 7,2) ; M2 : solde par section enforced + CHECK ; M5 : production_in au coût réel + WAC étendu à production_in ; conventions m9 (audit `stock.movement` → entity = movement id, produit dans metadata), m10 (toute prod migrée doit entrer le stock initial via le ledger), m11 (les lignes transfer in/out portent toutes deux from+to). Statut M3 : FIFO non câblé, spec dédiée à venir.

- [ ] **Step 2 : commit**

```bash
git add .claude/skills/stock-management/SKILL.md
git commit -m "docs(skills): stock-management — record audit fixes + ledger conventions (audit D2)"
```

### Task D3 : E2E Playwright de régression sur les pages ressuscitées

**Files:**
- Create: `tests/e2e/stock-inventory-pages.spec.ts`

- [ ] **Step 1 : écrire le spec** — suivre le harness existant (`tests/e2e/s40-reports.spec.ts` : `loginWithPin` partagé en `beforeAll`, serial, baseURL `E2E_BO_URL ?? localhost:5174`, rate-limit 3/min → un seul login) :

```ts
// tests/e2e/stock-inventory-pages.spec.ts — régression audit 2026-06-12 C1.
// T1 /inventory/movements : la table charge, aucune alerte "Failed to load".
// T2 /inventory/alerts : 3 onglets, pas de TypeError, Status ≠ faux 'All clear'.
// T3 /inventory/opname : New count → Pastry Kitchen → Create → la liste montre
//    la session (status Draft/Counting) — puis cancel pour ne pas polluer.
// T4 /products/<id du 1er produit de la liste>/dashboard : titre produit rendu,
//    aucune alerte d'erreur.
// Chaque test : page.on('console') → fail si message contient "reading 'rest'".
```

(Écrire les 4 tests complets sur le modèle T1-T4 de s40 — sélecteurs par rôle/testid relevés dans l'audit : bouton `New count`, dialog `New stock count`, select `Section`, bouton `Create count`.)

- [ ] **Step 2 : lancer** : `npx playwright test tests/e2e/stock-inventory-pages.spec.ts` (dev server up) → 4/4 PASS.

- [ ] **Step 3 : commit**

```bash
git add tests/e2e/stock-inventory-pages.spec.ts
git commit -m "test(e2e): stock pages regression — movements/alerts/opname/product-dashboard alive (audit C1 guard)"
```

---

# Close-out

- [ ] Sweep complet : `pnpm --filter @breakery/app-backoffice test` (baseline : 485/486, 1 skip pré-existant — toute nouvelle failure est une régression de ce plan), `pnpm typecheck` (6/6).
- [ ] Re-dérouler les workflows de l'audit dans le navigateur : adjust / receive / waste / production AVEC et SANS section (sans → erreur claire, plus de crash) / transfer depuis section vide (rejet propre) / opname create→count→validate→finalize de bout en bout (premier passage complet possible post-C1 : vérifier les mouvements `opname_*` et la JE).
- [ ] Vérifier les 2 crons au lendemain : `cron.job_run_details` → `succeeded` ×2.
- [ ] PR vers `master` : squash `fix(stock): audit 2026-06-12 — close C1-C4, M1-M2, M4-M7, m1-m7 (lots FIFO deferred)` + mettre à jour la ligne Active Workplan de `CLAUDE.md`.
- [ ] Ouvrir le chantier suivant : spec FIFO consommation (M3) — seul finding majeur restant.

## Traçabilité findings → tâches

| Finding | Tâche | | Finding | Tâche |
|---|---|---|---|---|
| C1 pages mortes | A1, D3 | | M6 orphelines | C1 |
| C2 cron spoilage | B1 | | M7 seuils à 0 | C2 |
| C3 cron marges | B2 | | m1 TRUNCATE | B6 |
| C4 production sans section | A2 + B3 | | m3 SKU picker | A5 |
| M1 ingrédients introuvables | A3 | | m4 data résidus | D1 |
| M2 solde section | B4 | | m5/m6/m7 UI | A5 |
| M3 FIFO | **exclu — spec dédiée** | | m8 PIN | exclu |
| M4 erreurs muettes | A4 | | m9/m10/m11 | D2 |
| M5 valorisation production | B5 | | m2 parents | D2 (décision) |
