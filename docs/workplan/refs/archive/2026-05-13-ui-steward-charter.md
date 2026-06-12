# `ui-steward` Charter — `packages/ui` Single-Owner Governance

> **Date** : 2026-05-13 (Phase 0.3 of Session 13)
> **Spec ref** : `docs/workplan/specs/2026-05-13-session-13-spec.md` D9 (ui-steward + 22-006 batching)
> **Plan ref** : `docs/workplan/plans/2026-05-13-session-13-INDEX.md` Phase 0.3 lines 175-198
> **Audit ref** : `docs/workplan/specs/2026-05-13-session-13-architecture-audit.md` R10 (`packages/ui` contention)
> **Status** : Draft for lead review — staged in `docs/workplan/refs/` per the executor brief
> **Author** : ui-steward subagent (executor of Phase 0.3 — ui-steward hat)

---

## 0. Why this charter exists

L'audit (R10) identifie une zone de contention quasi-certaine en Session 13 : **5 modules ouvrent en parallèle des PRs touchant `packages/ui/`** :

| Module | Tasks Session 13 touchant `packages/ui` | Conflict surface |
|---|---|---|
| **02 POS** | 02-001/002/006/020 (UX hardening Phase 4) | `Numpad`, `OrderTypeTabs`, `PinVerificationModal`, `CustomerSearchModal` |
| **04 KDS** | 04-001/003/004/006/009 (Phase 4) | `Card`, `Badge`, `Toaster` — KDS-spécifique surcharges |
| **16 Display** | Build-from-scratch Phase 4 | Nouveaux primitives display + reuse `Card`, `Currency`, `Badge` |
| **17 Tablet** | 17-001/002/003/006 (Phase 4) | `TabletOrderCard`, `TabletInboxRow`, `Numpad`, `ModifierModal` |
| **22 Design** | 22-001..006 (Phase 1.D + Phase 4 + Phase 6) | **TOUT** : tokens, primitives, modals, motion |

Sans gouvernance unique, 4 PRs ouvertes en parallèle sur `packages/ui/src/components/` produiraient un merge-hell garanti. D9 décide : **un steward unique nommé `ui-steward` maintient `packages/ui` pour toute la session**, et toute modification y passe par lui.

---

## 1. Role definition

### 1.1 Charter de `ui-steward`

| Aspect | Détail |
|---|---|
| **Identité** | Subagent **nommé `ui-steward`** (au sens SendMessage-first dans CLAUDE.md "Agent Comms"). Re-spawné à chaque phase Session 13 si besoin, mais **le rôle est constant et identifié**. |
| **Scope étroit** | Owns : `packages/ui/src/`, `packages/ui/tailwind-preset.ts`, `packages/ui/src/tokens/`. Touche **PAS** : `apps/pos/src/features/**`, `apps/backoffice/src/features/**`, `packages/domain/src/`. |
| **Scope étendu (review-only)** | Approves : tous les PRs (Session 13) qui IMPORTENT depuis `@breakery/ui`. Veto power sur l'usage incorrect d'un primitive (ex : `<Button variant="..."` non-token). |
| **Responsabilités** | (a) Implémenter 22-001/002/004/005/006/007 (P1) et 22-008/009/010 (P2) sur la session. (b) Reviewer chaque PR d'autre agent qui touche `packages/ui/`. (c) Batcher 22-006 en 3 fenêtres (cf §4). (d) Maintenir le token système + Tailwind preset cohérents. |
| **Boundary** | Ne fait pas de feature business (ex : ne crée pas `KdsOrderCard` — c'est le feature `apps/pos/src/features/kds/`). Le steward CRÉE des primitives ; les features CONSUMENT. |

### 1.2 Pourquoi un sous-agent unique vs un humain

- **Sérialisation** : un sous-agent processe les tickets en série naturellement → pas de contention de merge.
- **Mémoire de patterns** : le ReasoningBank du sous-agent capitalise les conventions (token choices, ARIA patterns, focus management) entre tâches.
- **Atomicité PR** : un sous-agent ouvre 1 PR par batch ; les autres agents ouvrent leurs PRs feature qui **importent** depuis `@breakery/ui` mais ne modifient pas son code.

### 1.3 Communication protocol (SendMessage-first)

```
feature-agent  ──"propose change to packages/ui/src/components/X.tsx"──▶  ui-steward
                                                                              │
                                                                              ▼
ui-steward     ──"PR #N opened on packages/ui — please rebase your branch"──▶  feature-agent
                                                                              │
                                                                              ▼
feature-agent  ──"rebased, ready to merge feature PR"───────────────────────▶  lead (you)
```

Aucun feature-agent n'ouvre directement une PR qui touche `packages/ui/src/`. **Si une feature a besoin d'une modification UI, elle envoie un message au `ui-steward` avec :**
1. Le nouveau composant / la modification souhaitée.
2. Le contexte d'usage (quel feature, quelle phase).
3. Un test cas (ce que le composant doit afficher).

`ui-steward` répond avec :
- Soit "OK, opened PR #N on packages/ui — merge happens after this; rebase your branch."
- Soit "Use existing `<X>` instead, here's an example."
- Soit "This belongs in `apps/*/features/Y/components/`, not in `packages/ui/`. Rationale: too feature-specific."

---

## 2. Branching rule

### 2.1 Règle générale

**Toute phase touchant `packages/ui/` doit rebase sur la dernière branche `ui-steward` (`swarm/session-13-ui-batch-N`) avant merge.** Si Phase 4.A (POS UX) ouvre une PR qui touche `packages/ui/src/components/Numpad.tsx`, elle doit :

1. Attendre que `ui-steward` ait mergé Phase 1.D batch 1 (22-001..005).
2. Rebase sa branche sur `swarm/session-13` à jour.
3. Idéalement : déléguer la modif Numpad à `ui-steward` plutôt que la faire dans la PR feature.

### 2.2 Mécanisme concret

| Fenêtre | Branche `ui-steward` | Phases features bloquées tant que pas mergé |
|---|---|---|
| Batch 1 | `swarm/session-13-ui-batch-1` (Phase 1.D — tokens + 22-001..005 + 24 modals POS) | Phase 4 POS, Phase 4 KDS (qui touchent les primitives) |
| Batch 2 | `swarm/session-13-ui-batch-2` (Phase 4 mid — BO modals shadcn refactor) | Phase 4 Display, Phase 5 Settings UI |
| Batch 3 | `swarm/session-13-ui-batch-3` (Phase 6 — tablet + display modals polish) | Phase 6 polish cascade |

Le lead trace ces branches via `git log --oneline --first-parent` et confirme que chaque PR feature est **basée sur le merge le plus récent de la branche batch correspondante**.

### 2.3 Exception : single-file primitive add

Si une feature a besoin d'**un seul nouveau primitive** (ex : `EmptyState.tsx` Phase 2 reports), `ui-steward` peut faire une **micro-PR scoped** (`swarm/session-13-ui-micro-emptystate`) hors batching, mergée rapidement (sans toucher au token system). Les batches restent la voie principale pour les refactors larges.

---

## 3. 22-006 batch plan — verified modal inventory

### 3.1 Audit Session 13 (verified via Glob + Grep on `apps/{pos,backoffice}/src/` and `packages/ui/src/`)

Le backlog mentionnait "72+ modals custom" — ce chiffre était V2-era. **V3 actuel a 34 modales/dialogs / drawers** (verified, see counts below). Inventory complet :

#### `packages/ui/src/components/` — 9 reusable modals

| # | Component | Underlying | Notes |
|---|---|---|---|
| 1 | `FullScreenModal.tsx` | Radix `Dialog.Root` + `Portal` + `Content` | Already Radix-based. Used 10× across apps. Charter target: keep, harden focus trap test. |
| 2 | `PinVerificationModal.tsx` | Wraps `FullScreenModal` | Already Radix via wrapper. |
| 3 | `DiscountModal.tsx` | Wraps `FullScreenModal` + Numpad | Already Radix via wrapper. |
| 4 | `CustomerSearchModal.tsx` | Wraps `FullScreenModal` | Already Radix via wrapper. |
| 5 | `HeldOrdersModal.tsx` | Wraps `FullScreenModal` | Already Radix via wrapper. |
| 6 | `ModifierModal.tsx` | Wraps `FullScreenModal` | Already Radix via wrapper. |
| 7 | `RedeemPointsModal.tsx` | Wraps `FullScreenModal` | Already Radix via wrapper. |
| 8 | `TableSelectorModal.tsx` | Wraps `FullScreenModal` | Already Radix via wrapper. |
| 9 | `RefundReceiptModal.tsx` | Wraps `FullScreenModal` | Already Radix via wrapper. |

**Verdict**: All 9 `packages/ui` modals are already Radix-Dialog-based via `FullScreenModal`. **No 22-006 work needed here** — the audit's "Dialog shadcn inutilisé" was V2-era.

#### `apps/pos/` — 10 modal/dialog/drawer sites

| # | File | Pattern | Status |
|---|---|---|---|
| 1 | `apps/pos/src/pages/Login.tsx` | `FullScreenModal` | Radix-based ✓ |
| 2 | `apps/pos/src/features/payment/PaymentTerminal.tsx` | `FullScreenModal` | Radix-based ✓ |
| 3 | `apps/pos/src/features/payment/SuccessModal.tsx` | `FullScreenModal` | Radix-based ✓ |
| 4 | `apps/pos/src/features/cart/CancelItemModal.tsx` | `FullScreenModal` | Radix-based ✓ |
| 5 | `apps/pos/src/features/shift/OpenShiftModal.tsx` | `FullScreenModal` | Radix-based ✓ |
| 6 | `apps/pos/src/features/inbox/components/TabletInboxModal.tsx` | `FullScreenModal` | Radix-based ✓ |
| 7 | `apps/pos/src/features/order-history/OrderHistoryPanel.tsx` | `FullScreenModal` | Radix-based ✓ |
| 8 | `apps/pos/src/features/order-history/components/OrderDetailDrawer.tsx` | Custom (non-Radix Drawer?) | **VERIFY** — possible 22-006 candidate |
| 9 | `apps/pos/src/features/order-history/components/RefundOrderModal.tsx` | `FullScreenModal` | Radix-based ✓ |
| 10 | `apps/pos/src/features/order-history/components/VoidOrderModal.tsx` | `FullScreenModal` | Radix-based ✓ |

**Verdict POS**: 9 already Radix-based, 1 to verify (`OrderDetailDrawer`).

#### `apps/backoffice/` — 15 modal/dialog/drawer sites

| # | File | Pattern | Status |
|---|---|---|---|
| 1 | `apps/backoffice/src/pages/Login.tsx` | `FullScreenModal` | Radix-based ✓ |
| 2 | `apps/backoffice/src/features/inventory/components/AdjustModal.tsx` | `Dialog` (Radix primitive) | Radix-based ✓ |
| 3 | `apps/backoffice/src/features/inventory/components/ReceiveModal.tsx` | `Dialog` | Radix-based ✓ |
| 4 | `apps/backoffice/src/features/inventory/components/WasteModal.tsx` | `Dialog` | Radix-based ✓ |
| 5 | `apps/backoffice/src/features/inventory/components/MovementHistoryDrawer.tsx` | `Dialog` (used as drawer-ish) | Radix-based ✓ but could be a real `Sheet` (Radix Sheet not yet in ui package) |
| 6 | `apps/backoffice/src/features/inventory-transfers/components/TransferReceiveModal.tsx` | `Dialog` | Radix-based ✓ |
| 7 | `apps/backoffice/src/features/inventory-transfers/components/TransferCancelConfirm.tsx` | `Dialog` | Radix-based ✓ |
| 8 | `apps/backoffice/src/features/loyalty/components/LoyaltyAdjustModal.tsx` | `Dialog` | Radix-based ✓ |
| 9 | `apps/backoffice/src/features/loyalty/components/CustomerFormModal.tsx` | `Dialog` | Radix-based ✓ |
| 10 | `apps/backoffice/src/features/loyalty/components/CustomerDeleteConfirm.tsx` | `Dialog` | Radix-based ✓ |
| 11 | `apps/backoffice/src/features/loyalty/components/LoyaltyHistoryDrawer.tsx` | `Dialog` (used as drawer-ish) | Radix-based ✓ ; same Sheet candidate |
| 12 | `apps/backoffice/src/features/suppliers/components/SupplierFormModal.tsx` | `Dialog` | Radix-based ✓ |
| 13 | `apps/backoffice/src/features/suppliers/components/SupplierDeleteConfirm.tsx` | `Dialog` | Radix-based ✓ |
| 14 | `apps/backoffice/src/features/promotions/components/PromotionFormModal.tsx` | `Dialog` | Radix-based ✓ |
| 15 | `apps/backoffice/src/features/promotions/components/PromotionDeleteConfirm.tsx` | `Dialog` | Radix-based ✓ |

**Verdict BO**: 15/15 already Radix-Dialog-based.

#### Aggregate count

- **34 modal/dialog/drawer sites in V3** (9 ui + 10 pos + 15 bo).
- **33/34 already use Radix Dialog primitive** (focus trap, Escape, aria-* handled automatically).
- **1 needs verification** : `OrderDetailDrawer.tsx`.

### 3.2 Re-scoped 22-006 plan

L'audit V2 (72+ modals à migrer) ne s'applique pas — la migration Radix est **déjà faite dans V3**. Le spec D9 (Session 13) demande des batches de ~24 modals chacun, mais le terrain montre 34 totaux dont 33 déjà conformes.

**Re-scope proposé** : 22-006 devient **"Dialog/Drawer audit + harmonization"** plutôt que "migration mass". Trois batches re-formulés :

#### Batch 1 — Phase 1.D : Foundations + audit (≈ 1.5 sprint days)

Objectifs :
- Vérifier le pattern unique `OrderDetailDrawer.tsx` (audit 5 min) ; migrer vers `Dialog` ou créer un primitive `Sheet` côté drawer.
- Ajouter un primitive `Sheet` (Radix-based, side-mounted) à `packages/ui/src/primitives/` pour les drawers (MovementHistoryDrawer + LoyaltyHistoryDrawer + OrderDetailDrawer) → migrer ces 3.
- Harmoniser tous les `Dialog` BO : enforce `data-testid` sur `<DialogContent>`, `<DialogTitle>`, primary action button.
- Token enforcement : interdire `<Dialog>` direct → forcer `<Dialog>` via re-export du primitive `@breakery/ui`.
- Audit motion-reduce sur tous les dialogs (verified : 0 occurrences de `motion-reduce` dans `packages/ui/src/` aujourd'hui — TASK-22-009 P2 fix les wrappers).

Files touched :
1. `packages/ui/src/primitives/Sheet.tsx` (new primitive)
2. `packages/ui/src/primitives/Dialog.tsx` (add `motion-reduce:` variants)
3. `packages/ui/src/components/FullScreenModal.tsx` (add `motion-reduce:`)
4. `packages/ui/src/index.ts` (export Sheet)
5. `apps/pos/src/features/order-history/components/OrderDetailDrawer.tsx` (migrate to Sheet)
6. `apps/backoffice/src/features/inventory/components/MovementHistoryDrawer.tsx` (migrate to Sheet)
7. `apps/backoffice/src/features/loyalty/components/LoyaltyHistoryDrawer.tsx` (migrate to Sheet)
8. Tests for all the above (1 unit test per file, focus-trap + Escape + motion-reduce assertion)

**~10 files in batch 1** (much smaller than the 24 estimated in spec D9 — V3 is in better shape than V2 audit suggested).

#### Batch 2 — Phase 4 mid-cycle : POS UX cross-cutting (≈ 2 sprint days)

Triggered when Phase 4 POS UX hardening lands (02-001/002/006/020) and needs `packages/ui` extensions.

Probable scope (depends on Phase 4 specs) :
- Add primitives consumed by Phase 4: `Toggle`, `Tooltip`, `DropdownMenu` (Radix-based).
- `Numpad` and `NumpadPin` motion-reduce + aria-live improvements.
- `OrderTypeTabs` enhancement for tabletop / takeaway / delivery split.
- `ModifierModal` UX (drag handle on mobile, sticky footer).
- A11y sweep on all 10 POS modals : `aria-describedby` properly wired, `<DialogTitle>` not visually hidden in critical flows.

Estimated file count : 10-15 files. Decision deferred to phase-4 kickoff.

#### Batch 3 — Phase 6 polish : Display + Tablet + reports (≈ 1.5 sprint days)

Triggered when Phase 4 Display (build-from-scratch) and Phase 6 tablet polish land.

Probable scope :
- `KPICard` primitive (TASK-22-008) — needed by Phase 6 reports.
- `ProgressBar` primitive (TASK-22-008) — needed by display queue ticker + payment progress.
- `EmptyState` primitive (TASK-22-002) — needed everywhere Phase 6 polishes empty data states.
- Tablet-specific component polish (`TabletOrderCard`, `TabletInboxRow`).
- Display-specific primitive : `QueueTicker` (if reusable across stores).
- 22-013 illustrations (if approved budget).

Estimated file count : 10-12 files.

### 3.3 Total estimate

| Batch | Files | Estimated effort | Phase |
|---|---|---|---|
| 1 | ~10 | 1.5 days | Phase 1.D |
| 2 | ~12 | 2 days | Phase 4 |
| 3 | ~10 | 1.5 days | Phase 6 |
| **Total** | **~32 files** | **~5 days** | Phases 1.D / 4 / 6 |

Verified count: V3 has 34 modal sites, of which 33 are already Radix-based. The "72+" V2 figure has no V3 equivalent. The spec's "≈ 24 modals per batch" was overstated — actual scope is ≈10-12 files per batch.

---

## 4. Component conventions (enforced by ui-steward)

Toute composante exposée depuis `@breakery/ui` doit respecter ces conventions. Le `ui-steward` rejette toute PR (sienne ou externe) qui les viole.

### 4.1 Typed props exhaustivement

```typescript
// packages/ui/src/components/X.tsx
export interface XProps {
  /** Document each prop. */
  variant: 'a' | 'b' | 'c';        // No `string` ; union of literals or `keyof` lookup
  disabled?: boolean;
  onAction?: () => void;
  children?: ReactNode;
  className?: string;               // ALWAYS allow class override via cn()
  'data-testid'?: string;           // ALWAYS allow test ID injection
}

export function X({ variant, disabled, onAction, children, className, 'data-testid': testId }: XProps): JSX.Element {
  return (
    <div data-testid={testId} className={cn('...', variant === 'a' && '...', className)}>
      {children}
    </div>
  );
}
```

**Forbidden**:
- `props: any`, `props: object`, `props: Record<string, unknown>`.
- Untyped event handlers (`onClick: Function`).
- Mixing `forwardRef` and direct function components without justification.

### 4.2 `data-testid` support

**ALL exposed components must accept `data-testid` and propagate to the outer DOM element**, for E2E test stability.

Verified current state : `Grep "data-testid" packages/ui/src/` → 9 occurrences across 7 files. **Many missing.** Phase 1.D batch 1 sweep: add `data-testid` to all primitives that don't have it (Button, Input, Badge, Card, Tabs, ScrollArea, Separator, Toast, all Dialog parts).

Forbidden:
- Hardcoded `data-testid="..."` inside a component (must come from prop).
- Multiple `data-testid` on a component (use one root testid + child queries by role/text).

### 4.3 `motion-reduce` respect

Verified current state : `Grep "motion-reduce" packages/ui/src/` → **0 occurrences**. This is TASK-22-009 P2 — ui-steward owns rollout.

Pattern :

```tsx
<DialogPrimitive.Content
  className={cn(
    'transition-all duration-200',
    'motion-reduce:transition-none motion-reduce:duration-0',
    'data-[state=open]:animate-in',
    'motion-reduce:data-[state=open]:animate-none',
    className,
  )}
/>
```

CSS keyframes in `apps/pos/src/index.css` and `apps/backoffice/src/index.css` must be wrapped in `@media (prefers-reduced-motion: no-preference)`. ui-steward audits these in batch 1.

### 4.4 Radix Dialog usage for ALL modals/dialogs/drawers

Confirmed pattern (`packages/ui/src/primitives/Dialog.tsx`) :

- `Dialog.Root` from `@radix-ui/react-dialog`.
- `Dialog.Portal` mandatory (no in-place rendering).
- `Dialog.Overlay` with backdrop + blur + motion-reduce variants.
- `Dialog.Content` with focus trap (handled by Radix natively), `aria-describedby` wiring, focus return-to-trigger.
- `Dialog.Title` and `Dialog.Description` ALWAYS present (Radix requirement for a11y — issues `aria-labelledby` and `aria-describedby`). If hidden visually, use `SR_ONLY` className (`absolute -m-px h-px w-px overflow-hidden whitespace-nowrap border-0 p-0` — already present in DiscountModal / PinVerificationModal as a constant).

Forbidden:
- `<div role="dialog">` without Radix.
- `useEffect` to add Escape listener manually.
- `inert` attribute or other manual focus management.

### 4.5 Token-only color usage

Verified V3 state : the token system already exists at `packages/ui/src/tokens/luxe-dark.css` (CSS vars) + `packages/ui/tailwind-preset.ts` (Tailwind aliases). Apps reference tokens via `bg-bg-base`, `text-text-primary`, `border-border-subtle`, `bg-gold`, etc.

Audit grep results :
- `Grep "(text|bg)-(slate|gray|zinc|emerald|violet|amber)-" apps/` → **5 occurrences in 3 files** (OrderHistoryPanel.tsx, IncomingStockForm.tsx, TransferStatusBadge.tsx).
- `Grep "#[0-9a-fA-F]{6}" apps/` (non-test files) → **0 occurrences**.

**V3 already largely token-clean.** The audit's "354 hardcoded Tailwind color classes" figure was V2-era. Phase 1.D batch 1 sweep: fix the 5 remaining occurrences. ESLint rule `no-tailwind-color-utilities` (TASK-22-001 nice-to-have) can be deferred to Phase 6 polish if the count is < 10.

### 4.6 Accessibility baseline

Each primitive/component must :
- Be keyboard-navigable (Tab, Enter, Escape, arrow keys where applicable).
- Have visible focus rings (token : `focus:outline focus:outline-2 focus:outline-gold focus:outline-offset-2`).
- Support `aria-label` or wrap a labelled child.
- Avoid `role="..."` if Radix or native HTML already provides it (don't double up).

### 4.7 Naming

- **Primitives** : `Button.tsx`, `Input.tsx`, `Dialog.tsx`, `Sheet.tsx` (new), `Tabs.tsx`, etc. PascalCase, single noun.
- **Domain components** : `CustomerSearchModal.tsx`, `LoyaltyBadge.tsx`. PascalCase, descriptive.
- **Tests** : co-located in `__tests__/` subfolder, mirror file basename + `.test.tsx`.
- **NO** : `XComponent.tsx`, `MyButton.tsx`, generic names.

---

## 5. Token system bootstrap (TASK-22-001 sketch)

Verified V3 state of token files :

```
packages/ui/src/tokens/luxe-dark.css         (62 lines — Surfaces/Borders/Text/Accents/Typography/Radii/Touch/Elevations/Backdrop)
packages/ui/tailwind-preset.ts                (74 lines — maps CSS vars → Tailwind aliases)
```

The token system is **already operational** :
- Apps import the preset (`apps/{pos,backoffice}/tailwind.config.ts` extends `tailwindPreset`).
- Apps import the CSS (`apps/{pos,backoffice}/src/index.css` imports `@breakery/ui/tokens/luxe-dark.css`).
- 26 utility classes available (`bg-bg-base`, `text-text-primary`, `text-gold`, `bg-green`, `bg-red`, etc.).

### 5.1 What's missing (Phase 1.D batch 1)

1. **Payment-specific tokens** — apps use `bg-emerald-600`, `bg-violet-500`, `bg-amber-500` for cash/card/QR. Charter target: add `--payment-cash`, `--payment-card`, `--payment-qris` tokens, expose as `bg-payment-cash` etc., migrate the 5 hardcoded occurrences.

2. **Light theme (Back-Office)** — the audit notes `theme-backoffice` is "less attention to colors". Verified V3 has `.dark` (the only branch in `luxe-dark.css`). Phase 1.D scope: add a `:root` light variant or document that BO inherits dark mode entirely (decision needed — see §7 Q3).

3. **Semantic tokens vs base tokens** — currently `--green-base` is both used as "success" semantic and "available stock" semantic. Phase 1.D recommendation: add semantic aliases `--success`, `--warning`, `--danger`, `--info` pointing to base palette (no new colors, just clearer intent).

4. **Motion tokens** — duration / easing / motion-reduce-aware. Phase 1.D : add `--motion-fast`, `--motion-base`, `--motion-slow` CSS variables + `motion-reduce` overrides at the CSS variable level (allows components to consume `transition-duration: var(--motion-base)`).

### 5.2 File structure (target Phase 1.D)

```
packages/ui/src/tokens/
├── luxe-dark.css        # existing — base palette + surfaces (UNCHANGED in batch 1)
├── semantic.css         # NEW — success/warning/danger/info aliases
├── motion.css           # NEW — duration/easing + motion-reduce safe variants
└── payment.css          # NEW — payment-method colors
packages/ui/src/index.css   # NEW — imports all four ; apps import this single file
```

apps would change one line :

```diff
- @import '@breakery/ui/src/tokens/luxe-dark.css';
+ @import '@breakery/ui/src/index.css';
```

### 5.3 Forbidden patterns going forward

- ❌ `style={{ color: '#c9a557' }}` — use `text-gold` className.
- ❌ `className="text-slate-400"` — use `text-text-secondary`.
- ❌ Hardcoded duration : `transition-all duration-200` → keep className but ensure `motion-reduce:duration-0` follows.
- ✅ `cn('text-text-primary', isError && 'text-red', className)` — composition with token classes.

### 5.4 Migration cadence

22-001 (purge hardcoded literals) becomes mostly a **no-op verification + 5-file sweep** in V3, not an "L" XL refactor. Re-prioritize: P1 → P2 since the count is small. ui-steward owns the sweep in batch 1.

---

## 6. Workflow for non-steward agents

### 6.1 When a feature agent needs to change `packages/ui/`

**Step 1** — Identify the change scope:
- Pure feature-scoped UI (e.g. `KdsOrderCardSpecificFooter` only used by KDS) → **stays in `apps/pos/src/features/kds/components/`**. Don't touch `packages/ui`.
- Reusable across 2+ features (e.g. `KPICard` used by Dashboard + Reports + Display) → **belongs in `packages/ui/src/components/`**. Send a request to ui-steward.

**Step 2** — Send a SendMessage to `ui-steward` with this template:

```markdown
**Request**: Add / modify / remove `<ComponentName>` in `packages/ui/src/components/`.

**Why**: Phase X, task Y-NNN, requires <reason>.

**Scope**: Add prop `xyz`, change behaviour `abc`, OR new component with shape `<below>`.

**Usage example**:
```tsx
<ComponentName variant="..." onAction={...} data-testid="..." />
```

**Tests needed**: focus-trap, escape, aria-describedby, data-testid prop wiring.

**Phase deadline**: end of phase X.Y.
```

**Step 3** — Wait for `ui-steward` response. Possible outcomes:
- **(a) Approved + scheduled**: "Opened PR #N on `swarm/session-13-ui-batch-2`. Rebase your branch after merge."
- **(b) Rejected — use existing**: "Use `<ExistingComponent>` with props `xyz`. Example: …"
- **(c) Rejected — feature-scope**: "This belongs in `apps/.../features/Y/components/`. Don't add to `packages/ui`."
- **(d) Deferred**: "Will land in batch 3 Phase 6 alongside other display work. In the meantime, inline the component in your feature."

**Step 4** — Once approved + merged, the feature agent rebases its branch on the latest `swarm/session-13` and proceeds with the feature PR (which now imports from `@breakery/ui`).

### 6.2 Anti-patterns (rejected by ui-steward)

- **"Just add one prop to Button"** — even single-prop PRs go through the steward. Rationale: discoverability + consistency.
- **"I'll fix the data-testid in `packages/ui` while I'm at it"** — opportunistic edits to `packages/ui` from feature PRs are rejected. Open a separate request.
- **"This is urgent, I'll merge directly"** — never. Block on `ui-steward` review. If genuine emergency, ping the lead, not the steward queue.

### 6.3 Bypass authority

The lead can bypass the steward in one situation only : **a security-blocking issue in `packages/ui` that can't wait** (e.g. a CVE in `@radix-ui/react-dialog`). Document the bypass post-hoc in `docs/workplan/refs/`.

---

## 7. Open questions for the lead

1. **Q1 — Steward identity stability** : the spec says `ui-steward` is a sub-agent name maintained across the session. Confirm we use the SAME agent identity (re-spawned at each phase) rather than a fresh subagent per phase ? Reasoning: pattern memory in ReasoningBank is preserved if it's the same name. **Recommendation**: same name across all phases.

2. **Q2 — Batch granularity** : the spec D9 says "3 windows ≈ 24 modals each". Verified count says 34 sites total, of which only ~10 need substantive work (Sheet primitive migration + motion-reduce + data-testid sweep). Re-batch as **10 / 12 / 10 files**, not 24. **Confirm OK to re-scope.**

3. **Q3 — Light-mode for Back-Office** : the design system has `.dark` (`luxe-dark.css`) but no light theme defined. Three options :
   - **a)** BO inherits dark mode entirely (one theme to maintain) — cheapest.
   - **b)** Add a light theme variant — TASK-22-011 (P3 in backlog) acceptable for Phase 6.
   - **c)** BO uses a "high-contrast light" variant only on reports / data-dense pages.
   **Recommendation**: a) for Session 13 (defer b) to Phase 7).

4. **Q4 — Storybook** : the backlog mentions a `/_dev/components` page or Storybook. V3 has neither. Verified by `Glob "**/storybook/**"` (no results). Build storybook in Phase 1.D batch 1 or defer ? **Recommendation**: defer to a future session — `/_dev/components` route is cheaper and sufficient for ui-steward demos.

5. **Q5 — ESLint rule `no-tailwind-color-utilities`** : the backlog (TASK-22-001) lists it as an option. Without it, hardcoded Tailwind color classes can creep back. **Recommendation**: implement in Phase 6 (after batch 3 has cleaned the state). Acceptable to defer.

6. **Q6 — Tablet steward responsibility split** : module 17 (Tablet) Phase 4 polish touches `TabletOrderCard.tsx` and `TabletInboxRow.tsx` in `packages/ui`. Does the ui-steward own these PRs, or does the tablet feature agent own them and the steward reviews ? **Recommendation**: steward owns ANY change to a file in `packages/ui/src/` ; tablet agent proposes via SendMessage. (Strict interpretation = no contention.)

7. **Q7 — Visual regression testing** : TASK-22-001 mentions Percy / screenshots. V3 has no Percy. Phase 1.D investment ? **Recommendation**: defer to Phase 6 alongside 23-001 CI workflow. Visual diffs are nice but not blocking.

8. **Q8 — `data-testid` retro-application** : adding `data-testid` to all `packages/ui` primitives is a breaking-change-shaped event for downstream consumers (they must pass it in tests). Phase 1.D batch 1 scope or defer ? **Recommendation**: Phase 1.D batch 1 — costless because TypeScript only suggests, doesn't break.

9. **Q9 — Migration of drawers (OrderDetailDrawer, MovementHistoryDrawer, LoyaltyHistoryDrawer) to a new `Sheet` primitive** : net-new primitive in `packages/ui` + 3 file migrations. Time estimate 3-4 h. Phase 1.D batch 1 confirmed scope ? **Yes** (per re-scope in §3.2).

10. **Q10 — Steward agent type** : the audit mentions `ui-steward` as a custom agent type. Confirm we spawn it via standard Agent({ subagent_type: "ui-steward", name: "ui-steward" }) — i.e. it's a custom string, not a built-in agent ? **Yes** per CLAUDE.md "Any string works as a custom agent type."

---

## 8. Wave 1+ readiness checklist (ui-steward kick-off)

When Phase 1.D opens, ui-steward should:

- [ ] Re-read this charter + spec D9 + audit R10 + the relevant 22-NNN tasks in `docs/workplan/backlog-by-module/22-design-system.md`.
- [ ] Open `swarm/session-13-ui-batch-1` branch.
- [ ] Tackle in order :
  1. Add `Sheet` primitive (`packages/ui/src/primitives/Sheet.tsx`) + 3 migrations.
  2. Add motion-reduce variants to all `Dialog*` and `FullScreenModal` (motion.css token file + className additions).
  3. Add semantic tokens (success/warning/danger/info aliases) + `packages/ui/src/index.css` consolidator.
  4. Sweep `data-testid` props onto all primitives + components (no test changes mandatory ; just optional prop).
  5. Fix 5 hardcoded color occurrences in `apps/` (OrderHistoryPanel.tsx, IncomingStockForm.tsx, TransferStatusBadge.tsx).
  6. Run `pnpm typecheck` + `pnpm test --filter @breakery/ui` + manual `pnpm dev` smoke.
- [ ] Open PR titled `feat(ui): session 13 — batch 1 — Sheet + motion-reduce + semantic tokens + data-testid sweep`.
- [ ] Wait for lead review + merge.
- [ ] SendMessage to relevant feature agents: "Batch 1 merged. You may rebase Phase 4 branches now."

Resume same flow at Phase 4 (batch 2) and Phase 6 (batch 3).

---

*End of charter. Sister doc : `2026-05-13-kiosk-auth-design.md` covers D18 (kiosk auth) — same Phase 0.3 deliverable.*
