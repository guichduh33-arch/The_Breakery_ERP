---
name: breakery-ui-kit
description: '@breakery/ui conventions — which primitives exist vs not (no Select/SelectItem/RadioGroup exports → native fallbacks), semantic design tokens (luxe-dark + theme-backoffice), Dialog/Sheet/Badge/Card patterns, useIdleTimeout. Use when building any BO/POS component.'
pathPatterns:
  - 'packages/ui/**'
  - 'apps/*/src/**/components/**'
promptSignals:
  phrases:
    - '@breakery/ui'
    - 'Select'
    - 'RadioGroup'
    - 'SelectItem'
    - 'design token'
    - 'Dialog'
    - 'Sheet'
    - 'Badge'
    - 'component primitive'
    - 'useIdleTimeout'
    - 'shadcn'
---

# Breakery UI Kit — `@breakery/ui`

**`CLAUDE.md` est la source de vérité** pour les patterns globaux du projet. Ce skill ajoute la surface map réelle du kit UI, les tokens de design, et les fallbacks à utiliser quand un primitif n'existe pas — CLAUDE.md ne documente pas ça.

> Toute assertion sur les exports a été vérifiée contre `packages/ui/src/index.ts` (barrel unique) — 2026-05-31.

---

## Exported primitives (verified — `packages/ui/src/index.ts`)

### Primitives Radix/Tailwind

| Export | Remarque |
|--------|----------|
| `Button`, `buttonVariants`, `ButtonProps` | variantes via `buttonVariants` |
| `Input`, `InputProps` | |
| `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogTrigger`, `DialogClose`, `DialogOverlay`, `DialogPortal` | stepper multi-step : plusieurs `Dialog` imbriqués ou state machine |
| `Sheet`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetTrigger`, `SheetClose`, `SheetOverlay`, `SheetPortal`, `SheetContentProps` | side-drawer, drill-down |
| `Tabs`, `TabsContent`, `TabsList`, `TabsTrigger` | |
| `Badge`, `badgeVariants`, `BadgeProps` | color-coded status via `variant` prop |
| `Card`, `CardContent`, `CardHeader`, `CardFooter`, `CardTitle`, `CardDescription`, `cardVariants`, `CardProps` | |
| `ScrollArea`, `ScrollBar` | |
| `Separator` | |
| `Toaster` | sonner-based toast overlay |
| `EmptyState`, `EmptyStateProps`, `EmptyStateAction`, `EmptyStateSize` | |

### Components domaine

| Export | Remarque |
|--------|----------|
| `DataTable`, `DataTableProps`, `DataTableColumn`, `DataTableSort`, `SortDirection` | tri/colonnes |
| `KpiTile`, `KpiTileProps`, `KpiDelta`, `KpiDeltaDirection`, `KpiValueFormat` | indicateurs hub |
| `Stat`, `StatProps`, `StatDirection` | variation signée |
| `Currency`, `CurrencyProps` | IDR formatting |
| `Numpad`, `NumpadPin`, `NumpadVirtual` | saisie caisse |
| `QuantityStepper` | |
| `OrderTypeTabs` | |
| `FullScreenModal`, `FullScreenModalClose` | plein-écran tablet |
| `CenterModal` | modal centré générique |
| `ModifierModal` | |
| `DiscountModal` | |
| `PinVerificationModal`, `VerifyResult` | consomme `auth-verify-pin` EF |
| `CustomerSearchModal`, `CustomerForm`, `LoyaltyAdjustForm`, `CustomerCategoryBadge`, `LoyaltyBadge`, `RedeemPointsModal` | module customers |
| `TableSelectorModal` | |
| `HeldOrdersModal` | |
| `TabletInboxRow`, `TabletOrderCard` | tablet flow |
| `PromotionTypeBadge`, `PromotionForm`, `PromotionLineRow` | |
| `ComboLineRow` | |
| `TenderRow`, `TenderListBuilder` | paiements |
| `RefundLineRow`, `RefundTenderSplitter`, `RefundReceiptModal` | remboursements |
| `IngredientPicker`, `IngredientSearchResult`, `IngredientSearchFn`, `IngredientKind` | recettes |
| `AllergenBadge`, `ALLERGEN_TYPES`, `ALLERGEN_LABELS` | (infra S15, wontfix sur receipt) |
| `BrandLogo`, `BrandMark` | assets SVG |
| `SectionLabel` | groupage visuel |
| `SkipToContent` | a11y |
| `IdleWarningToast` | overlay session timeout (S21) |

### Hook

| Export | Remarque |
|--------|----------|
| `useIdleTimeout`, `UseIdleTimeoutArgs`, `IDLE_WARNING_LEAD_MS` | monté dans POS + BO ; déclenche `signOut()` après `session_timeout_minutes` (S19). Pas de warning toast natif — `IdleWarningToast` à ajouter séparément. |

### Lib utilitaire

| Export | Remarque |
|--------|----------|
| `cn` | wrapper `clsx` + `tailwind-merge` |

---

## ❌ Ce qui N'EST PAS exporté (fallbacks requis)

| Absent | Fallback à utiliser | Contexte |
|--------|--------------------|---------:|
| `Select` / `SelectItem` | `<select>` HTML natif | S26b ThresholdFormDialog, S28 |
| `RadioGroup` / `RadioGroupItem` | 3-`<button>` group ou `<input type="radio">` natif | S27c ConvertToParentDialog (axis fallback) |
| `Checkbox` | `<input type="checkbox">` natif | |
| `Popover` | Radix `@radix-ui/react-popover` direct si besoin | |
| `Tooltip` | Radix direct ou title attr | |

> Règle : **ne jamais importer un primitif qui n'est pas dans la liste ci-dessus**. TypeScript lèvera une erreur, mais la vraie perte de temps c'est le debug runtime. Vérifier la liste avant d'écrire un import.

---

## Design tokens — `@breakery/ui/tokens.css`

Import unique : `@breakery/ui/tokens.css` (barrel `packages/ui/src/tokens/index.css`). Cascade en 8 couches :

1. `luxe-dark.css` — palette de base (POS dark, sert de `:root` par défaut)
2. `typography.css` — 4 font tokens + type scale
3. `spacing.css` — grille 4 px + gutters sémantiques
4. `elevation.css` — shadows
5. `semantic.css` — `--success`, `--warning`, `--danger`, `--info` (+ variantes `*-soft`)
6. `motion.css` — durées + easing (respecte `prefers-reduced-motion`)
7. `payment.css` — couleurs méthodes (`cash`/`card`/`qris`/`voucher`)
8. `colors.css` — surfaces 0-4, gold scale, `.theme-backoffice` overrides

### Deux thèmes coexistants

| Classe | Contexte | Surfaces |
|--------|----------|----------|
| `:root` / `.dark` / `.theme-pos` | POS, KDS, Customer Display, Tablet | `--surface-0..4` noirs/charcoal |
| `.theme-backoffice` | Backoffice | `--surface-0..4` crème/ivoire `#f7f3ec..#fff` |

Tokens clés à utiliser (jamais de couleurs hardcodées) :

```css
/* Surfaces */
var(--bg-base)          /* panel principal */
var(--bg-elevated)      /* cartes */
var(--bg-overlay)       /* popovers */

/* Texte */
var(--text-primary)
var(--text-secondary)
var(--text-muted)

/* Bordures */
var(--border-subtle)
var(--border-strong)

/* Sémantique */
var(--success) / var(--success-soft)
var(--warning) / var(--warning-soft)
var(--danger)  / var(--danger-soft)

/* Gold (marque) */
var(--gold-base) / var(--gold-soft) / var(--gold-fg)
```

---

## Patterns et checklists

### Dialog stepper multi-step (S26b, S28, S29)

Pattern canonique : un `Dialog` unique + state machine (`step: 1 | 2 | ...`) contrôle quel contenu est rendu dans `DialogContent`. Pas de nesting de Dialog.

```tsx
const [step, setStep] = useState<1 | 2>(1);
<Dialog open={open} onOpenChange={onClose}>
  <DialogContent>
    {step === 1 && <Step1 onNext={() => setStep(2)} />}
    {step === 2 && <Step2 onBack={() => setStep(1)} onSubmit={handleSubmit} />}
  </DialogContent>
</Dialog>
```

### Sheet drawer drill-down

`SheetContent` côté `"right"` pour détails inline (S26b `JournalEntryDrawer`). Ne pas l'utiliser pour des actions destructives — préférer un `Dialog`.

### Badge color-coded status

```tsx
<Badge variant="success">Approved</Badge>   // --success
<Badge variant="warning">Pending</Badge>    // --warning
<Badge variant="destructive">Voided</Badge> // --danger
<Badge variant="outline">Draft</Badge>
```

Les variants exacts dépendent de la définition dans `Badge.tsx` — vérifier avant d'utiliser un variant inconnu.

### useIdleTimeout

Monté une seule fois dans le shell POS et le shell BO (S19) :

```tsx
useIdleTimeout({
  timeoutMs: role.session_timeout_minutes * 60_000,
  onIdle: () => supabase.auth.signOut(),
});
```

---

## Anti-patterns

- **Importer `Select`/`RadioGroup` depuis `@breakery/ui`** → n'existe pas, build cassé.
- **Hardcoder une couleur** (`#c9a557`, `bg-white`, etc.) → utiliser les tokens CSS.
- **Dupliquer un composant déjà dans @breakery/ui** dans une app — vérifier la liste d'abord.
- **Créer un composant POS-only dans @breakery/ui** alors qu'il n'a pas vocation partagée — co-localiser dans `apps/pos/src/components/`.
- **Faire un `import ... from '@breakery/ui/primitives/Dialog'`** (chemin interne) → toujours importer depuis `@breakery/ui` (barrel public).

---

## Verification

```bash
# Type check du package UI (NOTE : peut échouer sur env install incomplet
# @dnd-kit/*/recharts/sonner — reproduit sur master, pas une régression S26b+)
pnpm --filter @breakery/ui typecheck

# Tests unitaires primitifs + composants
pnpm --filter @breakery/ui test

# Vérifier qu'un export existe réellement
grep "export" packages/ui/src/index.ts | grep "NomDuComposant"
```

---

## Sources de vérité

```
Barrel d'exports (unique point d'entrée)
  packages/ui/src/index.ts

Tokens cascade
  packages/ui/src/tokens/index.css  → 8 layers

Primitives (implémentations)
  packages/ui/src/primitives/*.tsx

Composants domaine
  packages/ui/src/components/*.tsx

Hook
  packages/ui/src/hooks/useIdleTimeout.ts

Patterns de référence consommateurs
  apps/backoffice/src/features/expenses/components/ThresholdFormDialog.tsx  (native select)
  apps/backoffice/src/features/products/components/variants/ConvertToParentDialog.tsx  (3-button axis)
  apps/backoffice/src/features/accounting/components/CreateManualJeModal.tsx  (Dialog stepper)
```

---

## When to escalate

- Besoin d'un nouveau primitif **partagé** entre POS et BO → l'ajouter dans `packages/ui/src/primitives/` + exporter dans `index.ts` + tests dans `__tests__/` + PR dédiée.
- Besoin de `Select`/`RadioGroup`/`Checkbox` de façon répétée sur plusieurs features → valider avec l'équipe si c'est le bon moment de les ajouter à `@breakery/ui` (dépendance `@radix-ui/react-select` à ajouter).
- Nouveau token couleur qui n'existe pas dans les 8 layers → créer dans `colors.css` sous la bonne classe de thème, pas dans le composant.
