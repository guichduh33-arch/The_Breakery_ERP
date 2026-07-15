# S73 Lot 3 — BO hub, pages & cross-app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development ou
> superpowers:executing-plans. Aucune migration dans ce lot.

**Goal:** Zéro tuile Soon en cul-de-sac, pages POS Configuration + Notifications, formulaire
General durci, dictionnaire de clés partagé, modèle d'autorité documenté.

**Architecture:** UI backoffice uniquement + un module TS partagé dans `packages/supabase`.
Réutilise `useSettings`/`useSetSetting` (catégorie `pos_presets` ajoutée au Lot 2) et le
pattern direct-table `useEmailTemplates` pour `notification_templates` (RLS write =
`notifications.send`, seedée ADMIN/MANAGER/SUPER_ADMIN — vérifié live 2026-07-11).

## Global Constraints

Voir l'INDEX. Dépend du Lot 2 (catégories + type `SettingsCategory`).

---

### Task 11: Hub cleanup + nav + AuditPage `?action=`

**Files:**
- Modify: `apps/backoffice/src/pages/settings/SettingsHubPage.tsx`
- Modify: `apps/backoffice/src/layouts/Sidebar.tsx:210-217`
- Modify: `apps/backoffice/src/pages/reports/AuditPage.tsx:46`
- Test: smoke hub existant (`apps/backoffice/src/features/settings/__tests__/`) + AuditPage smoke

**Interfaces:**
- Consumes: routes Lot 2 (`settings/customer-display`, `settings/printing`) ; routes Tasks
  12-13 (`settings/pos`, `settings/notifications`) — garder ce task APRÈS 12-13 au moment
  du commit final du hub, OU pointer les 2 tuiles dès maintenant (routes livrées dans la
  même PR : acceptable, la PR est atomique).

- [ ] **Step 1: `SettingsHubPage.tsx` — édits tuile par tuile** (réfs lignes du fichier actuel) :
  - l.20-25 : étendre l'interface :

```tsx
interface SettingTile {
  to?:         string;  // omitted + planned=false → ne devrait plus exister
  planned?:    boolean; // true = surface actée pour une session dédiée (rendu désactivé + libellé)
  permission?: string;  // masque la tuile si l'utilisateur n'a pas la permission de la route
  title:  string;
  blurb:  string;
  icon:   LucideIcon;
}
```

  - l.40 : **supprimer** la tuile `Tax` (doublon de route avec Company ; le blurb Company
    couvre déjà « currency, tax, address »).
  - l.47 : `{ to: '/backoffice/settings/pos', title: 'POS Configuration', blurb: 'Quick payment amounts, opening cash, discount presets.', icon: Coffee }`
  - l.57 : `{ to: '/backoffice/categories', title: 'Product Categories', blurb: 'Category tree + colours.', icon: Tag }`
  - l.58 : `{ to: '/backoffice/products', title: 'Product Types', blurb: 'Raw / Semi-finished / Finished — set per product.', icon: Layers }`
    (vérifier la route exacte de la liste produits dans `routes/index.tsx` avant commit ;
    si c'est `/backoffice/products` avec filtre type en query param, l'utiliser).
  - l.59 : `{ planned: true, title: 'KDS Configuration', blurb: 'Stations, routing, prep times. (Planned — dedicated session)', icon: Monitor }`
  - l.60 : tuile Customer Display → déjà liée au Lot 2 (no-op ici).
  - l.74 : tuile Printing → déjà liée au Lot 2 (no-op ici).
  - l.75 : `{ to: '/backoffice/settings/notifications', title: 'Notifications', blurb: 'System notification templates.', icon: Bell }`
  - l.76 : ajouter `permission: 'settings.security.manage'` + blurb honnête :
    `blurb: 'Per-role session timeout.'` (la page n'a ni PIN policies ni 2FA — audit 1.2.8).
  - l.77 : ajouter `permission: 'accounting.period.close'`.
  - l.82 : renommer `title: 'Network Devices (LAN)'` (absorbe la tuile Soon).
  - l.83 : **supprimer** la tuile `Network Devices` (fusion).
  - l.84 : `{ to: '/backoffice/reports/audit?action=setting.update', title: 'Settings History', blurb: 'Audit trail of every setting change.', icon: History }`
  - l.91 : `{ planned: true, title: 'Floor Plan', blurb: 'Tables, sections, walking paths. (Planned — dedicated session)', icon: Map }`
  - Section System : ajouter `{ to: '/backoffice/settings/expense-thresholds', title: 'Expense Thresholds', blurb: 'Approval thresholds + SOD.', icon: FileText, permission: 'expenses.thresholds.read' }`.

- [ ] **Step 2: rendu** — dans le composant (l.97+) :

```tsx
const hasPermission = useAuthStore((s) => s.hasPermission);
// dans la boucle tiles :
if (t.permission !== undefined && !hasPermission(t.permission)) return null;
```

  (import `useAuthStore` comme dans `SettingsGeneralPage.tsx:10`). Le rendu désactivé
  existant (l.124-140) reste pour `planned: true` — remplacer la condition `t.to !== undefined`
  par le même test, inchangé par ailleurs.

- [ ] **Step 3: Sidebar** — dans le bloc Settings (l.210-217) ajouter :

```tsx
{ to: '/backoffice/settings/payment-methods', label: 'Payment Methods', icon: CreditCard, permission: 'settings.read' },
```

- [ ] **Step 4: AuditPage `?action=`** — `AuditPage.tsx:46` :

```tsx
import { useSearchParams } from 'react-router-dom';
// …
const [searchParams] = useSearchParams();
const [filters, setFilters] = useState<AuditLogFilterValues>(() => ({
  ...EMPTY_AUDIT_LOG_FILTERS,
  action: searchParams.get('action') ?? '',
}));
```

- [ ] **Step 5: tests.** Mettre à jour le smoke du hub : plus aucune tuile avec littéral
  `(Soon)` ; les 2 `planned` présentes ; tuile Security absente quand
  `hasPermission('settings.security.manage')` → false. AuditPage smoke : render sous
  `MemoryRouter initialEntries={['/reports/audit?action=setting.update']}` → le filtre
  action est pré-rempli.
- [ ] **Step 6:** `pnpm --filter @breakery/backoffice test settings AuditPage && pnpm --filter @breakery/backoffice typecheck` → verts.
- [ ] **Step 7:** `git commit -m "feat(backoffice): settings hub — no dead-end tiles, gated tiles, Settings History link, sidebar PaymentMethods (S73 B1/B3/B7)"`

---

### Task 12: Page BO « POS Configuration » (`pos_presets`)

**Files:**
- Create: `apps/backoffice/src/pages/settings/SettingsPosConfigPage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` (route `settings/pos`, gate `settings.read`)
- Test: `apps/backoffice/src/features/settings/__tests__/settings-pos-config-page.smoke.test.tsx`

**Interfaces:**
- Consumes: `useSettings('pos_presets')` + `useSetSetting` (catégorie ajoutée au Lot 2).
  Clés : `pos_quick_payment_amounts` (number[]), `pos_opening_cash_presets` (number[]),
  `pos_discount_presets` ({value:number; name:string}[]) — validation serveur déjà dans
  `set_setting_v1` (éléments > 0, value 0-100, name non vide).

- [ ] **Step 1: page complète** — 3 éditeurs. Squelette (les 2 groupes numériques partagent
  `NumberListEditor`, le 3e a son éditeur nom+valeur) :

```tsx
// apps/backoffice/src/pages/settings/SettingsPosConfigPage.tsx
//
// S73 Lot 3 (audit 1.2.4) — the BO becomes the org editor for the POS presets
// the terminals consume (same RPC pair + keys as apps/pos usePOSPresets; the
// POS Settings General tab keeps its own editor). No parallel schema.
import { useState } from 'react';
import { Trash2, Plus } from 'lucide-react';
import { Button, Card, CardContent, CardHeader, CardTitle } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { useSettings } from '@/features/settings/hooks/useSettings.js';
import { useSetSetting } from '@/features/settings/hooks/useSetSetting.js';

interface DiscountPreset { value: number; name: string }

function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.filter((x): x is number => typeof x === 'number' && x > 0) : [];
}
function asDiscountArray(v: unknown): DiscountPreset[] {
  return Array.isArray(v)
    ? v.filter((x): x is DiscountPreset =>
        !!x && typeof x === 'object'
        && typeof (x as DiscountPreset).value === 'number'
        && typeof (x as DiscountPreset).name === 'string')
    : [];
}

function NumberListEditor({ title, helper, values, canEdit, isPending, onSave }: {
  title: string; helper: string; values: number[]; canEdit: boolean;
  isPending: boolean; onSave: (next: number[]) => void;
}) {
  const [draft, setDraft] = useState('');
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-text-secondary">{helper}</p>
        <div className="flex flex-wrap gap-2">
          {values.map((v, i) => (
            <span key={`${v}-${i}`} className="inline-flex items-center gap-1 rounded-md border border-border-subtle px-3 h-8 text-sm font-mono tabular-nums">
              {v.toLocaleString('id-ID')}
              {canEdit && (
                <button type="button" aria-label={`Remove ${v}`} disabled={isPending}
                  onClick={() => { const next = values.filter((_, j) => j !== i); if (next.length > 0) onSave(next); }}
                  className="text-red/80 hover:text-red disabled:opacity-30 p-0.5">
                  <Trash2 className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
        </div>
        {canEdit && (
          <div className="flex items-center gap-2">
            <input type="number" inputMode="numeric" placeholder="e.g. 50000" value={draft}
              onChange={(e) => setDraft(e.target.value)} aria-label={`New ${title} value`}
              className="h-9 w-40 rounded-md border border-border-subtle bg-bg-input px-3 text-sm" />
            <Button variant="secondary" size="sm" disabled={isPending || draft.trim() === ''}
              onClick={() => {
                const n = Number(draft);
                if (Number.isFinite(n) && n > 0 && !values.includes(n)) { onSave([...values, n]); setDraft(''); }
              }}>
              <Plus className="h-4 w-4" aria-hidden /> Add
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function SettingsPosConfigPage() {
  const canEdit = useAuthStore((s) => s.hasPermission('settings.update'));
  const { data, isLoading, error } = useSettings('pos_presets');
  const setSetting = useSetSetting();
  const [discountDraft, setDiscountDraft] = useState<{ name: string; pct: string }>({ name: '', pct: '' });

  const quick    = asNumberArray(data?.settings['pos_quick_payment_amounts']);
  const opening  = asNumberArray(data?.settings['pos_opening_cash_presets']);
  const discounts = asDiscountArray(data?.settings['pos_discount_presets']);

  const save = (key: string, value: unknown) =>
    setSetting.mutate({ key, value, category: 'pos_presets' });

  if (isLoading) return <div className="text-text-secondary">Loading…</div>;
  if (error) return <div className="text-red">Failed to load: {error.message}</div>;

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-serif text-3xl">POS Configuration</h1>
        <p className="text-text-secondary text-sm mt-1">
          Org-wide presets consumed by every POS terminal. Audited on change.
        </p>
      </div>
      <NumberListEditor title="Quick payment amounts" helper="Cash entry buttons in the payment terminal."
        values={quick} canEdit={canEdit} isPending={setSetting.isPending}
        onSave={(next) => save('pos_quick_payment_amounts', next)} />
      <NumberListEditor title="Shift opening cash presets" helper="Tap-to-fill amounts when opening a shift."
        values={opening} canEdit={canEdit} isPending={setSetting.isPending}
        onSave={(next) => save('pos_opening_cash_presets', next)} />
      <Card>
        <CardHeader><CardTitle className="text-base">Quick discount presets</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-text-secondary">One-tap presets in the POS discount modal (cart & line).</p>
          <ul className="space-y-1">
            {discounts.map((d, i) => (
              <li key={`${d.name}-${i}`} className="flex items-center gap-3 rounded-md border border-border-subtle px-3 py-2 text-sm">
                <span className="font-mono w-12 tabular-nums">{d.value}%</span>
                <span className="text-text-secondary">{d.name}</span>
                <span className="flex-1" />
                {canEdit && (
                  <button type="button" aria-label={`Remove ${d.name}`} disabled={setSetting.isPending}
                    onClick={() => { const next = discounts.filter((_, j) => j !== i); if (next.length > 0) save('pos_discount_presets', next); }}
                    className="text-red/80 hover:text-red disabled:opacity-30 p-1">
                    <Trash2 className="h-3 w-3" aria-hidden />
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canEdit && (
            <div className="flex items-center gap-2">
              <input type="text" placeholder="Name (e.g. Staff Meal)" value={discountDraft.name}
                onChange={(e) => setDiscountDraft((d) => ({ ...d, name: e.target.value }))}
                aria-label="New discount preset name"
                className="h-9 flex-1 max-w-xs rounded-md border border-border-subtle bg-bg-input px-3 text-sm" />
              <input type="number" inputMode="numeric" placeholder="%" value={discountDraft.pct}
                onChange={(e) => setDiscountDraft((d) => ({ ...d, pct: e.target.value }))}
                aria-label="New discount preset percent"
                className="h-9 w-24 rounded-md border border-border-subtle bg-bg-input px-3 text-sm" />
              <Button variant="secondary" size="sm" disabled={setSetting.isPending || discountDraft.pct.trim() === ''}
                onClick={() => {
                  const value = Number(discountDraft.pct);
                  if (!Number.isFinite(value) || value < 0 || value > 100) return;
                  const name = discountDraft.name.trim() || `${value}%`;
                  if (discounts.some((d) => d.name === name)) return;
                  save('pos_discount_presets', [...discounts, { value, name }]);
                  setDiscountDraft({ name: '', pct: '' });
                }}>
                <Plus className="h-4 w-4" aria-hidden /> Add
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
```

- [ ] **Step 2: route** `settings/pos` (lazy import + PermissionGate `settings.read`,
  pattern `routes/index.tsx:898-905`).
- [ ] **Step 3: smoke test** — mock `useSettings` (payload avec les 3 clés), assert les
  3 titres + `Remove` absent quand `hasPermission` → false ; un `save` déclenche
  `set_setting_v1` avec la bonne catégorie (mock rpc).
- [ ] **Step 4:** tests + typecheck verts → `git commit -m "feat(backoffice): POS Configuration page on pos_presets (S73 B2)"`

---

### Task 13: Page BO « Notifications » (`notification_templates`)

**Files:**
- Create: `apps/backoffice/src/features/settings/hooks/useNotificationTemplates.ts`
- Create: `apps/backoffice/src/pages/settings/SettingsNotificationsPage.tsx`
- Modify: `apps/backoffice/src/routes/index.tsx` (route `settings/notifications`, gate `settings.read`)
- Test: `apps/backoffice/src/features/settings/__tests__/settings-notifications-page.smoke.test.tsx`

**Interfaces:**
- Consumes: table `notification_templates` (RLS: SELECT authenticated ; write
  `notifications.send` — migration `20260517000180:93-106`). Colonnes : id, code, channel,
  subject_template, body_template, variables (jsonb[]), is_active.
- Produces: update-only (codes système consommés par `enqueue_notification_v1` — pas de
  create/delete depuis l'UI, on ne fabrique pas d'événements système).

- [ ] **Step 1: hook** — copie conforme du pattern `useEmailTemplates.ts` :

```ts
// apps/backoffice/src/features/settings/hooks/useNotificationTemplates.ts
// S73 Lot 3 — system notification templates (channel in_app/email; consumed by
// enqueue_notification_v1). Update-only: codes are system events.
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import type { Database } from '@breakery/supabase';

export type NotificationTemplateRow    = Database['public']['Tables']['notification_templates']['Row'];
export type NotificationTemplateUpdate = Database['public']['Tables']['notification_templates']['Update'];

export const NOTIFICATION_TEMPLATES_QUERY_KEY = ['notification-templates'] as const;

export function useNotificationTemplatesList() {
  return useQuery<NotificationTemplateRow[]>({
    queryKey: NOTIFICATION_TEMPLATES_QUERY_KEY,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_templates').select('*').order('code', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpdateNotificationTemplate() {
  const qc = useQueryClient();
  return useMutation<NotificationTemplateRow, Error, { id: string; values: NotificationTemplateUpdate }>({
    mutationFn: async ({ id, values }) => {
      const { data, error } = await supabase
        .from('notification_templates').update(values).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { await qc.invalidateQueries({ queryKey: NOTIFICATION_TEMPLATES_QUERY_KEY }); },
  });
}
```

- [ ] **Step 2: page** — liste de cards (code + badge channel + toggle `is_active` +
  édition inline subject/body en `<textarea>` avec Save par template + affichage des
  `variables` disponibles en chips lecture seule). S'inspirer du rendu de
  `SettingsEmailTemplatesPage.tsx` (même dossier) pour rester homogène ; gate d'édition :
  `hasPermission('notifications.send')` (c'est la permission de la policy RLS write —
  PAS `settings.update`), lecture libre.
- [ ] **Step 3: route + smoke test** (render liste mockée, toggle désactivé sans permission,
  update appelle `.from('notification_templates').update`).
- [ ] **Step 4:** verts → `git commit -m "feat(backoffice): Notifications settings page on notification_templates (S73 B1)"`

---

### Task 14: Durcissement `SettingsGeneralPage` (B4)

**Files:**
- Modify: `apps/backoffice/src/pages/settings/SettingsGeneralPage.tsx`
- Test: `apps/backoffice/src/features/settings/__tests__/` (smoke General existant)

**Interfaces:**
- Le contrat RPC ne change pas : `tax_rate` et les 2 seuils `_pct` restent stockés en
  décimal [0,1] — SEUL l'affichage passe en %.

- [ ] **Step 1: test rouge** (smoke General) :

```tsx
it('currency and timezone are selects, tax rate is a percent input', () => {
  renderPage();
  expect(screen.getByLabelText('Currency code').tagName).toBe('SELECT');
  expect(screen.getByLabelText('Timezone').tagName).toBe('SELECT');
  expect(screen.getByLabelText(/tax rate/i)).toHaveAttribute('type', 'number');
  // valeur DB 0.10 rendue 10 (%)
  expect(screen.getByLabelText(/tax rate/i)).toHaveValue(10);
});
```

- [ ] **Step 2: implémentation.**
  1. `FieldType` → `'text' | 'number' | 'boolean' | 'select' | 'percent'` ; `FieldSpec`
     gagne `options?: readonly string[]` et `section: 'identity' | 'cash'`.
  2. Constantes :

```tsx
const CURRENCIES = ['IDR', 'USD', 'EUR', 'SGD', 'MYR', 'AUD', 'JPY', 'CNY', 'GBP'] as const;
const TIMEZONES: readonly string[] =
  typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Asia/Makassar', 'Asia/Jakarta', 'UTC'];
```

  3. `FIELDS` : `currency` → `type:'select', options: CURRENCIES` ; `timezone` →
     `type:'select', options: TIMEZONES` ; `tax_rate`, `shift_variance_threshold_pct`,
     `shift_variance_pin_threshold_pct` → `type:'percent'` (helper « en % — ex. 10 ») ;
     champs `name/fiscal_address/currency/timezone/tax_*` → `section:'identity'`,
     les 5 `shift_*` → `section:'cash'`.
  4. Hydratation : pour `percent`, `next[f.key] = v === null ? null : Number(v) * 100`
     (arrondi `Math.round(x * 10000) / 10000` pour éviter 10.000000001).
  5. `handleSave` : pour `percent`, `payload = n / 100` ; garde bornes client `0 ≤ n ≤ 100`.
  6. Rendu : cas `select` → `<select id={inputId} …>{options.map(o => <option key={o}>{o}</option>)}</select>`
     (mêmes classes que les inputs) ; cas `percent` → input number `min={0} max={100} step="any"`
     avec suffixe visuel `%`.
  7. Rendu en 2 sections : boucle sur `[['identity','Identity & locale'],['cash','Caisse — shift controls']]`
     avec un `<h2 className="font-serif text-xl pt-2">` par section.

- [ ] **Step 3:** tests + typecheck verts. Vérifier manuellement qu'un save de `tax_rate`
  10 % écrit bien `0.1` (mock rpc assert) — c'est le garde anti-régression money-path.
- [ ] **Step 4:** `git commit -m "feat(backoffice): harden General settings — ISO/IANA selects, percent inputs, cash section (S73 B4)"`

---

### Task 15: Dictionnaire de clés partagé + doc autorité + CLAUDE.md

**Files:**
- Create: `packages/supabase/src/settings-keys.ts`
- Modify: `packages/supabase/src/index.ts` (export)
- Modify: `apps/backoffice/src/features/settings/hooks/useSettings.ts` (type importé)
- Modify: `apps/pos/src/features/settings/hooks/useOrgDisplaySettings.ts` + `usePOSPresets.ts` (clés importées)
- Create: `docs/reference/settings-authority-model.md`
- Modify: `CLAUDE.md` (Active Workplan)
- Modify: `docs/workplan/audits/settings-pos-bo-audit.md` (statut final)

- [ ] **Step 1: dictionnaire** (source unique des chaînes — types stricts, zéro magic string) :

```ts
// packages/supabase/src/settings-keys.ts
// S73 Phase 3 — single typed dictionary of business_config setting keys and
// symbolic categories (server truth: set_setting_v1 / get_settings_by_category_v1,
// migration 20260711000159). Add a key here ONLY together with its RPC branch.
export const SETTINGS_CATEGORIES = [
  'business', 'localization', 'tax', 'pos', 'pos_presets',
  'inventory', 'payments', 'customer_display', 'printing',
] as const;
export type SettingsCategory = (typeof SETTINGS_CATEGORIES)[number];

export const SETTING_KEYS = {
  business:         ['name', 'fiscal_address'],
  localization:     ['currency', 'timezone'],
  tax:              ['tax_rate', 'tax_inclusive'],
  pos:              ['shift_variance_threshold_pct', 'shift_variance_threshold_abs',
                     'shift_variance_pin_threshold_pct', 'shift_variance_pin_threshold_abs',
                     'shift_denomination_count_enabled'],
  pos_presets:      ['pos_quick_payment_amounts', 'pos_opening_cash_presets', 'pos_discount_presets'],
  inventory:        ['allow_negative_stock'],
  payments:         ['enabled_payment_methods'],
  customer_display: ['display_footer_message', 'display_slogan'],
  printing:         ['pos_auto_print_receipt', 'pos_auto_open_drawer'],
} as const satisfies Record<SettingsCategory, readonly string[]>;
export type SettingKey = (typeof SETTING_KEYS)[SettingsCategory][number];
```

- [ ] **Step 2:** exporter depuis `packages/supabase/src/index.ts` ; remplacer le type local
  `SettingsCategory` de `useSettings.ts:10` par un ré-export
  (`export type { SettingsCategory } from '@breakery/supabase';`) ; dans les hooks POS,
  référencer les clés via `SETTING_KEYS.customer_display[0]` n'apporte rien — garder les
  littéraux MAIS ajouter un test de conformité :

```ts
// packages/supabase/src/__tests__/settings-keys.test.ts
import { SETTING_KEYS, SETTINGS_CATEGORIES } from '../settings-keys';
it('every category has at least one key and no duplicates across categories', () => {
  const all = SETTINGS_CATEGORIES.flatMap((c) => SETTING_KEYS[c]);
  expect(new Set(all).size).toBe(all.length);
});
```

- [ ] **Step 3: doc** `docs/reference/settings-authority-model.md` — contenu : tableau
  clé → catégorie → où c'est éditable (BO page / POS tab) → permission (`settings.update`,
  sauf notifications = `notifications.send`, security = `settings.security.manage` via
  `update_role_session_timeout_v1`) → portée (org DB vs terminal localStorage
  `pos:settings` : printerUrl, deviceCode, defaultOrderType) → qui prime (org DB fait foi ;
  les seuls réglages terminal restants sont matériels/locaux par nature). Lien retour vers
  l'audit + ce plan.
- [ ] **Step 4: CLAUDE.md** — Active Workplan : bloc « Merged (latest) S73 » résumant les
  3 lots (une fois mergés), retirer la mention S73 de « Prochaine session », ajouter la
  session dédiée Floor Plan/KDS à la liste des restes. Checklist fin de session (bandeaux
  remise-a-plat fiche 19-settings si touchée, pas de version RPC en dur, liens relatifs).
- [ ] **Step 5: audit doc** — statut → « ✅ VALIDÉ + EXÉCUTÉ S73 (PRs #…) ».
- [ ] **Step 6:** `pnpm build && pnpm typecheck && pnpm test` (full) → verts.
  `git commit -m "feat(settings): shared typed settings-keys dictionary + authority model doc (S73 Phase 3)"`
  puis ouvrir la **PR Lot 3**, et passer `pattern-guardian` sur la branche complète avant merge.
