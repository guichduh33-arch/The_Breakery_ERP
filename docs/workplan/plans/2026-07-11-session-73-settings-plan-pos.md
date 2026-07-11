# S73 Lot 1 — POS Settings fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rebrancher le verrou de permission sur l'onglet Printing, clarifier la portée
(org vs terminal), dédupliquer les surfaces, et câbler les discount presets au modal.

**Architecture:** Aucun changement DB. Tout est dans `apps/pos/src/features/settings/`,
`apps/pos/src/features/cart|discounts/`, et `packages/ui` (prop additive sur DiscountModal).

**Tech stack:** React 18 + zustand persist + TanStack Query v5 + Vitest (jsdom). Tests:
`pnpm --filter @breakery/pos test <pattern>` et `pnpm --filter @breakery/ui test <pattern>`.

## Global Constraints

Voir l'INDEX. En bref : pas de DB, tokens design only, fichiers < 500 lignes,
typecheck+lint+tests verts à chaque tâche, commits conventionnels co-authorés Claude.

---

### Task 1: PrintingSettingsTab — verrou `readOnly` (P0, audit 1.1.2)

**Files:**
- Modify: `apps/pos/src/features/settings/components/PrintingSettingsTab.tsx`
- Modify: `apps/pos/src/features/settings/POSSettingsPage.tsx:84`
- Test: `apps/pos/src/features/settings/__tests__/printing-settings-tab.smoke.test.tsx`

**Interfaces:**
- Produces: `PrintingSettingsTab({ readOnly }: { readOnly: boolean })` — signature attendue
  par les Tasks 2 et 4, et par le Lot 2 (ajout des toggles org dans ce même fichier).

- [ ] **Step 1: test rouge** — ajouter au smoke test existant :

```tsx
it('readOnly disables the URL input and both toggles', () => {
  render(<PrintingSettingsTab readOnly />);
  expect(screen.getByLabelText('Print server URL')).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Auto-print receipt on payment' })).toBeDisabled();
  expect(screen.getByRole('switch', { name: 'Auto-open cash drawer (cash)' })).toBeDisabled();
});
```

- [ ] **Step 2:** `pnpm --filter @breakery/pos test printing-settings-tab` → FAIL
  (prop inexistante / éléments non désactivés).

- [ ] **Step 3: implémentation.** Dans `PrintingSettingsTab.tsx` :
  1. Supprimer le `Toggle` local (l.16-46) et importer le composant partagé :
     `import { SettingToggle } from './SettingToggle';`
  2. Signature : `export function PrintingSettingsTab({ readOnly }: { readOnly: boolean }): JSX.Element`
  3. `<Input … disabled={readOnly} />` sur le champ URL (l.67-73).
  4. Remplacer les deux `<Toggle …/>` par :

```tsx
<SettingToggle
  label="Auto-print receipt on payment"
  description="Send the receipt to the print server without tapping Print."
  checked={autoPrint}
  onChange={setAutoPrint}
  disabled={readOnly}
/>
<SettingToggle
  label="Auto-open cash drawer (cash)"
  description="Pop the drawer when the tender is cash."
  checked={autoOpenDrawer}
  onChange={setAutoOpenDrawer}
  disabled={readOnly}
/>
```

  5. Dans `POSSettingsPage.tsx:84` : `{topTab === 'printing' && <PrintingSettingsTab readOnly={!canEdit} />}`

- [ ] **Step 4:** `pnpm --filter @breakery/pos test printing-settings-tab` → PASS, puis
  `pnpm --filter @breakery/pos test POSSettingsPage` → PASS (mettre à jour les rendus
  existants du smoke test si la signature casse un `render(<PrintingSettingsTab />)` :
  passer `readOnly={false}`).

- [ ] **Step 5:** `git add … && git commit -m "fix(pos-settings): honor settings.update gate on Printing tab (S73 A1)"`

---

### Task 2: Supprimer l'onglet Automation — Printing devient canonique (A4, audit 1.1.4)

**Files:**
- Delete: `apps/pos/src/features/settings/components/AutomationSettingsTab.tsx`
- Modify: `apps/pos/src/features/settings/POSSettingsPage.tsx` (imports l.38, type l.44, sous-tab l.139, rendu l.145)
- Test: `apps/pos/src/features/settings/__tests__/POSSettingsPage.test.tsx`

**Interfaces:**
- Consumes: Task 1 (`PrintingSettingsTab({readOnly})` porte désormais seul les 2 toggles).

- [ ] **Step 1: test rouge** — dans `POSSettingsPage.test.tsx`, ajouter :

```tsx
it('has no Automation sub-tab (S73 A4 — toggles live on Printing)', () => {
  renderPage(); // helper existant du fichier
  expect(screen.queryByRole('button', { name: /automation/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2:** run → FAIL (le sous-tab existe encore).

- [ ] **Step 3:** dans `POSSettingsPage.tsx` : retirer l'import (l.38), retirer `'automation'`
  du type `ConfigTab` (l.44), retirer le `<SubTabButton … label="Automation" …/>` (l.139)
  et la ligne de rendu (l.145). Supprimer le fichier `AutomationSettingsTab.tsx`.
  `grep -r "AutomationSettingsTab" apps/pos/src` doit rendre 0 hit.

- [ ] **Step 4:** `pnpm --filter @breakery/pos test POSSettingsPage` → PASS ;
  `pnpm --filter @breakery/pos typecheck` → 0 erreur.

- [ ] **Step 5:** `git commit -m "refactor(pos-settings): drop Automation tab, Printing is the single surface for auto toggles (S73 A4)"`

---

### Task 3: Rename « Customer Display » + badges de portée (A3 + A2, audit 1.1.3/1.1.1)

**Files:**
- Create: `apps/pos/src/features/settings/components/ScopeBadge.tsx`
- Modify: `apps/pos/src/features/settings/POSSettingsPage.tsx:78` (libellé top-tab)
- Modify: `PrintingSettingsTab.tsx`, `BehaviorSettingsTab.tsx`, `AdvancedSettingsTab.tsx`,
  `DevicesSettingsTab.tsx`, `DisplaySettingsTab.tsx` (badge « Ce terminal »),
  `POSSettingsPage.tsx` GeneralTab (badge « Établissement »)
- Test: `apps/pos/src/features/settings/__tests__/POSSettingsPage.test.tsx`

**Interfaces:**
- Produces: `ScopeBadge({ scope }: { scope: 'org' | 'terminal' })` — réutilisé par le Lot 2.

- [ ] **Step 1: écrire `ScopeBadge.tsx`** (nouveau, complet) :

```tsx
// apps/pos/src/features/settings/components/ScopeBadge.tsx
//
// S73 (audit 1.1.1) — explicit persistence scope on every settings block:
// 'org'      → stored in business_config (DB, shared by every terminal)
// 'terminal' → stored in posSettingsStore (localStorage, this device only)
import type { JSX } from 'react';
import { Building2, MonitorSmartphone } from 'lucide-react';
import { cn } from '@breakery/ui';

export function ScopeBadge({ scope }: { scope: 'org' | 'terminal' }): JSX.Element {
  const isOrg = scope === 'org';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest',
        isOrg
          ? 'border-gold/40 text-gold bg-gold/10'
          : 'border-border-subtle text-text-muted bg-bg-overlay',
      )}
      title={
        isOrg
          ? 'Shared setting — applies to every terminal (stored in the database).'
          : 'This terminal only — stored on this device.'
      }
    >
      {isOrg ? (
        <Building2 className="h-3 w-3" aria-hidden />
      ) : (
        <MonitorSmartphone className="h-3 w-3" aria-hidden />
      )}
      {isOrg ? 'Établissement' : 'Ce terminal'}
    </span>
  );
}
```

- [ ] **Step 2: test rouge** dans `POSSettingsPage.test.tsx` :

```tsx
it('labels the display top-tab "Customer Display" and scopes General as org', () => {
  renderPage();
  expect(screen.getByRole('button', { name: /customer display/i })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /kds/i })).not.toBeInTheDocument();
  expect(screen.getAllByText('Établissement').length).toBeGreaterThan(0);
});
```

- [ ] **Step 3:** run → FAIL.

- [ ] **Step 4: implémentation.**
  - `POSSettingsPage.tsx:78` : `label="Customer Display"` (le type interne `'kds'` peut rester).
  - GeneralTab : sous le `<SectionLabel>` de chaque `NumericPresetGroup`/`DiscountPresetsGroup`,
    pas nécessaire par groupe — ajouter UNE fois en tête du `return` du GeneralTab :
    `<div className="flex items-center gap-2"><ScopeBadge scope="org" /><span className="text-xs text-text-muted">Presets partagés par tous les terminaux.</span></div>`
  - Chaque tab terminal (Printing, Behavior, Advanced, Devices, Display) : même ligne en tête
    avec `scope="terminal"` et libellé `Réglages de ce terminal uniquement.`
    (Display passera « org » au Lot 2 — laisser `terminal` ici, le Lot 2 le change.)

- [ ] **Step 5:** run tests + `pnpm --filter @breakery/pos typecheck` → PASS.
- [ ] **Step 6:** `git commit -m "feat(pos-settings): Customer Display rename + org/terminal scope badges (S73 A2+A3)"`

---

### Task 4: Printer URL mono-surface (A6, audit 1.1.8)

**Files:**
- Modify: `apps/pos/src/features/settings/components/DevicesSettingsTab.tsx` (l.89-95 zone du champ URL)

- [ ] **Step 1:** dans `DevicesSettingsTab.tsx`, remplacer le `<Input>` d'édition de
  `printerUrl` par un affichage lecture seule (le champ reste nécessaire aux tests
  hardware qui lisent le store) :

```tsx
<div className="space-y-1">
  <span className="block font-bold uppercase tracking-widest text-text-muted text-xs">
    Print server URL
  </span>
  <p className="text-sm font-mono text-text-secondary">
    {printerUrl || 'default (VITE_PRINT_SERVER_URL → localhost:3001)'}
  </p>
  <p className="text-xs text-text-muted">Edit it on the Printing tab.</p>
</div>
```

  Supprimer l'usage de `setPrinterUrl` dans ce fichier (retirer du destructuring).

- [ ] **Step 2:** `pnpm --filter @breakery/pos test settings && pnpm --filter @breakery/pos typecheck` → PASS
  (adapter tout test qui tapait dans ce champ).
- [ ] **Step 3:** `git commit -m "refactor(pos-settings): printer URL editable on Printing tab only (S73 A6)"`

---

### Task 5: `DiscountModal` — prop `presets` (A5 partie UI, audit 1.1.7)

**Files:**
- Modify: `packages/ui/src/components/DiscountModal.tsx`
- Test: `packages/ui/src/components/__tests__/DiscountModal.test.tsx`

**Interfaces:**
- Produces: prop optionnelle `presets?: ReadonlyArray<{ value: number; name: string }>` —
  cliquer un preset ⇒ `type='percentage'`, `raw=String(value)`, `reason='Preset — {name}'`
  (≥ 5 chars garanti par le préfixe). Consommée en Task 6.

- [ ] **Step 1: test rouge** (dans le fichier de test existant, mêmes helpers) :

```tsx
it('preset chip fills percentage, value and reason', async () => {
  const onConfirm = vi.fn();
  render(
    <DiscountModal open onClose={() => {}} onConfirm={onConfirm} base={100_000}
      onRequireAuthorization={async () => 'mgr-1'}
      presets={[{ value: 10, name: '10%' }, { value: 50, name: 'Staff Meal' }]} />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Staff Meal' }));
  expect(screen.getByTestId('discount-value-display')).toHaveTextContent('50%');
  expect(screen.getByLabelText(/reason/i)).toHaveValue('Preset — Staff Meal');
});

it('renders no preset row when the prop is absent', () => {
  render(<DiscountModal open onClose={() => {}} onConfirm={vi.fn()} base={100_000}
    onRequireAuthorization={async () => null} />);
  expect(screen.queryByTestId('discount-presets')).not.toBeInTheDocument();
});
```

- [ ] **Step 2:** `pnpm --filter @breakery/ui test DiscountModal` → FAIL.

- [ ] **Step 3: implémentation** dans `DiscountModal.tsx` :
  1. Props : ajouter

```tsx
/** Optional quick presets (POS Settings → General → Quick Discount Presets). */
presets?: ReadonlyArray<{ value: number; name: string }>;
```

  2. Dans le corps, juste APRÈS le bloc « Type toggle » (l.142) et avant « Value display » :

```tsx
{presets && presets.length > 0 && (
  <div className="flex flex-wrap justify-center gap-2" data-testid="discount-presets">
    {presets.map((p) => (
      <button
        key={p.name}
        type="button"
        onClick={() => {
          setType('percentage');
          setRaw(String(p.value));
          setReason(`Preset — ${p.name}`);
        }}
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border-subtle bg-bg-input px-3 h-9 text-sm font-semibold',
          'hover:border-gold hover:text-gold transition-colors',
        )}
      >
        {p.name}
        <span className="text-text-muted font-normal">{p.value}%</span>
      </button>
    ))}
  </div>
)}
```

  (Le `reason` reste éditable ; la validation ≥ 5 chars et le PIN d'autorisation S43/S55
  sont inchangés — les presets ne contournent aucun garde.)

- [ ] **Step 4:** `pnpm --filter @breakery/ui test DiscountModal` → PASS.
- [ ] **Step 5:** `git commit -m "feat(ui): DiscountModal quick presets prop (S73 A5)"`

---

### Task 6: Câbler les presets aux 2 call-sites (A5 partie POS)

**Files:**
- Modify: `apps/pos/src/features/cart/BottomActionBar.tsx` (~l.94 hook, ~l.387 modal)
- Modify: `apps/pos/src/features/cart/ActiveOrderPanel.tsx` (~l.322 modal ligne)
- Modify: `apps/pos/src/features/settings/POSSettingsPage.tsx:464-466` (note « not wired »)

**Interfaces:**
- Consumes: Task 5 (`presets` prop) + `usePOSPresets()` existant
  (`apps/pos/src/features/settings/hooks/usePOSPresets.ts:87` — fallback intégré, jamais vide).

- [ ] **Step 1:** dans `BottomActionBar.tsx` : `import { usePOSPresets } from '@/features/settings/hooks/usePOSPresets';`
  puis dans le composant `const { presets: posPresets } = usePOSPresets();` et sur le modal
  (l.387) ajouter `presets={posPresets.discountPresets}`.
- [ ] **Step 2:** même ajout dans `ActiveOrderPanel.tsx` sur le `<DiscountModal>` ligne (l.322).
- [ ] **Step 3:** dans `POSSettingsPage.tsx`, remplacer le paragraphe l.464-466 par :

```tsx
<p className="text-text-muted text-xs mt-1 italic">
  Shown as one-tap presets in the POS discount modal (cart & line).
</p>
```

- [ ] **Step 4: test** — dans `apps/pos/src/features/cart/__tests__/`, les smoke tests qui
  montent `BottomActionBar` mockent déjà supabase ; vérifier qu'ils passent. Ajouter dans
  le smoke le plus proche du discount (ou créer `discount-presets.smoke.test.tsx`) :

```tsx
it('discount modal shows the org presets', async () => {
  renderBar(); // helper existant, cart non vide
  fireEvent.click(screen.getByRole('button', { name: /discount/i }));
  expect(await screen.findByTestId('discount-presets')).toBeInTheDocument();
});
```

- [ ] **Step 5:** `pnpm --filter @breakery/pos test cart && pnpm --filter @breakery/pos typecheck && pnpm --filter @breakery/pos lint` → verts.
- [ ] **Step 6:** `git commit -m "feat(pos): wire pos_discount_presets into cart & line discount modals (S73 A5)"`
  puis ouvrir la **PR Lot 1** (base master).
