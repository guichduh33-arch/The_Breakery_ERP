---
name: breakery-ui-kit
description: >-
  '@breakery/ui' conventions — which primitives exist vs not (Select exists as a styled
  native <select> ; no RadioGroup/Checkbox/Popover/Tooltip → fallbacks), semantic design
  tokens (luxe-dark + theme-backoffice), Dialog/Sheet/Badge/Card patterns, useIdleTimeout. Use
  this skill whenever you build or edit ANY React component in apps/pos, apps/backoffice,
  or packages/ui — forms / formulaires, modals / modales, tables, badges, buttons, selects,
  drawers, toasts — or when the task mentions @breakery/ui, Dialog, Sheet, Badge, Card,
  Select, RadioGroup, design token, shadcn, composant UI. Invoke it BEFORE writing JSX so
  you don't import primitives that don't exist or hardcode hex colors instead of tokens.
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

> Complémentarité : pour la **direction artistique/ergonomie** (quoi viser), voir `breakery-design` (transversal, 5 surfaces) et `pos-design-craft` (conception générative POS). Ce skill-ci répond à « avec quoi l'implémenter ».

> **Re-vérifié le 2026-08-31** contre `packages/ui/src/index.ts` (barrel unique), `packages/ui/src/tokens/colors.css` et les call-sites. Le barrel bouge à chaque campagne design : quand ce skill et le barrel divergent, **c'est le barrel qui a raison** — une ligne d'inventaire ici est une photo, `grep export packages/ui/src/index.ts` est la vérité.

---

## Exported primitives (relevé du 2026-08-31 — `packages/ui/src/index.ts`)

### Primitives Radix/Tailwind

| Export | Remarque |
|--------|----------|
| `Button`, `buttonVariants`, `ButtonProps` | variantes via `buttonVariants` ; le variant d'action par défaut est **vert** (`primary`), l'or est un variant distinct — cf. l'arbitrage « or MÈNE / vert ENGAGE » dans `breakery-design` |
| `Input`, `InputProps` | |
| `Select`, `selectClassName`, `SelectProps` | **`<select>` natif stylé** (design audit 2026-07-07) : même surface, hauteur et anneau de focus qu'`Input`. Ce n'est PAS un Radix Select — les enfants sont des `<option>`. `selectClassName` s'exporte seul pour un call-site qui garde son propre `<select>` |
| `FormField`, `FormFieldProps` | label + contrôle + message d'erreur |
| `Skeleton`, `SkeletonProps`, `SkeletonVariant` | états de chargement |
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
| `QwertyLayout` | clavier virtuel alphabétique |
| `VirtualKeypadProvider` | provider du clavier virtuel (tactile) |
| `BrandLogo`, `BrandMark` | assets SVG |
| `SectionLabel` | groupage visuel |
| `SkipToContent` | a11y |
| `IdleWarningToast` | overlay d'avertissement avant déconnexion pour inactivité |

### Hooks

| Export | Remarque |
|--------|----------|
| `useIdleTimeout`, `UseIdleTimeoutArgs`, `IDLE_WARNING_LEAD_MS` | monté dans POS + BO ; déclenche `signOut()` après `session_timeout_minutes` du rôle. Émet trois `CustomEvent` sur `window` : `idle:warning` (30 s avant, `IDLE_WARNING_LEAD_MS`), `idle:fired`, et écoute `idle:reset` pour relancer le minuteur. `IdleWarningToast` se branche sur ces événements — il n'est PAS monté par le hook, il s'ajoute séparément. |
| `useVirtualKeypad`, `VkpLayout` | consommation du clavier virtuel |
| `useDebouncedValue` | anti-rebond de saisie (recherche) |

### Lib utilitaire

| Export | Remarque |
|--------|----------|
| `cn` | wrapper `clsx` + `tailwind-merge` |

---

## ❌ Ce qui N'EST PAS exporté (fallbacks requis)

| Absent | Fallback à utiliser | Contexte |
|--------|--------------------|---------:|
| `SelectItem` (Radix) | `Select` existe, mais c'est un `<select>` natif stylé : ses enfants sont des `<option>`, pas des `SelectItem` | |
| `RadioGroup` / `RadioGroupItem` | groupe de `<button>` ou `<input type="radio">` natif | `ConvertToParentDialog` (choix d'axe) |
| `Checkbox` | `<input type="checkbox">` natif | |
| `Popover` | Radix `@radix-ui/react-popover` direct si besoin | |
| `Tooltip` | Radix direct ou attribut `title` | |

> Règle : **ne jamais importer un primitif absent du barrel**. TypeScript lèvera une erreur, mais la vraie perte de temps c'est le debug runtime. Vérifier `packages/ui/src/index.ts` avant d'écrire un import — c'est plus rapide que de croire une liste.
>
> Le piège inverse coûte aussi cher : ce skill a longtemps affirmé que `Select` n'existait pas, ce qui a fait styler ~75 `<select>` à la main avec des hauteurs et des anneaux de focus divergents — la dette que le primitif a précisément résorbée. **Un « ça n'existe pas » se re-vérifie comme un « ça existe ».**

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
| `:root` / `.dark` / `.theme-pos` | POS, KDS, Customer Display, Tablet | `--surface-0..4` noirs/charcoal (`#0b0a09` → `#2e2924`) |
| `.theme-backoffice` | Backoffice | **gris chaud désaturé** (direction « Instrument », arbitrage 2026-08-06) : `--surface-0` et `--surface-1` = `#f0efec`, `--surface-2`/`-3` = `#ffffff`, `--surface-4` = `#e9e7e2` |

> Le thème BO ne remplace pas la palette de base : il est chargé APRÈS `luxe-dark.css` et l'étend. Il **re-scope aussi la typographie et les rayons** (`--font-body` en Instrument Sans, `--font-display` remappé sur le corps pour tenir la règle Playfair-Is-Brand-Only, rampe de rayons resserrée à 3-4 px). Toucher la direction du BO = éditer ce bloc de tokens, jamais les composants. Le POS n'hérite d'aucune de ces valeurs.

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

### Dialog stepper multi-step

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

`SheetContent` côté `"right"` pour détails inline (exemple : `JournalEntryDetailDrawer`). Ne pas l'utiliser pour des actions destructives — préférer un `Dialog`.

### Badge color-coded status

```tsx
<Badge variant="success">Approved</Badge>   // --success
<Badge variant="warning">Pending</Badge>    // --warning
<Badge variant="destructive">Voided</Badge> // --danger
<Badge variant="outline">Draft</Badge>
```

Les variants exacts dépendent de la définition dans `Badge.tsx` — vérifier avant d'utiliser un variant inconnu.

### useIdleTimeout

Monté une seule fois dans le shell POS et le shell BO. Le hook prend des **minutes**, pas des millisecondes :

```tsx
useIdleTimeout({
  timeoutMinutes: role.session_timeout_minutes,
  onTimeout: () => supabase.auth.signOut(),
  // events?: liste d'événements d'activité — défaut mousedown/keydown/touchstart/scroll
});
```

No-op si `timeoutMinutes <= 0` (rôle pas encore hydraté, ou déconnexion auto désactivée).

---

## Anti-patterns

- **Importer `RadioGroup`/`Checkbox`/`Popover`/`Tooltip` depuis `@breakery/ui`** → n'existent pas, build cassé.
- **Re-styler un `<select>` à la main** alors que `Select` (ou `selectClassName`) fait le travail → c'est la dette que le primitif a résorbée.
- **Hardcoder une couleur** (`#c9a557`, `bg-white`, etc.) → utiliser les tokens CSS.
- **Poser un alpha sur un token de couleur `var()` nu** (`bg-danger/15`, `bg-gold/5`) → Tailwind supprime la déclaration EN SILENCE. Seule la famille `cat-*` est déclarée avec `<alpha-value>`. La vérité est `packages/ui/tailwind-preset.ts`, et une garde CI (`tailwind-dead-classes.mjs`) le surveille.
- **Dupliquer un composant déjà dans @breakery/ui** dans une app — vérifier la liste d'abord.
- **Créer un composant POS-only dans @breakery/ui** alors qu'il n'a pas vocation partagée — co-localiser dans `apps/pos/src/components/`.
- **Faire un `import ... from '@breakery/ui/primitives/Dialog'`** (chemin interne) → toujours importer depuis `@breakery/ui` (barrel public).

---

## Verification

```bash
# Type check du package UI (NOTE : peut échouer sur env install incomplet
# @dnd-kit/*/recharts/sonner — reproduit sur master, pas une régression)
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

Hooks
  packages/ui/src/hooks/*.ts

Patterns de référence consommateurs
  apps/backoffice/src/features/settings/expense-thresholds/ThresholdFormDialog.tsx  (formulaire en Dialog)
  apps/backoffice/src/features/products/components/ConvertToParentDialog.tsx        (groupe de boutons, faute de RadioGroup)
  apps/backoffice/src/features/accounting/components/CreateManualJeModal.tsx        (Dialog stepper)
```

---

## When to escalate

- Besoin d'un nouveau primitif **partagé** entre POS et BO → l'ajouter dans `packages/ui/src/primitives/` + exporter dans `index.ts` + tests dans `__tests__/` + PR dédiée.
- Besoin de `RadioGroup`/`Checkbox` de façon répétée sur plusieurs features → valider avec Mamat si c'est le bon moment de les ajouter à `@breakery/ui`. Précédent utile : `Select` a été créé quand la duplication est devenue mesurable, et il a résorbé ~75 call-sites divergents.
- Nouveau token couleur qui n'existe pas dans les 8 layers → créer dans `colors.css` sous la bonne classe de thème, pas dans le composant.
