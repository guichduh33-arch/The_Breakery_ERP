# breakery-ui-kit — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Exported primitives (relevé du 2026-08-31 — `packages/ui/src/index.ts`)
- Design tokens — `@breakery/ui/tokens.css`

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
| `Dialog`, `DialogContent`, `DialogHeader`, `DialogFooter`, `DialogTitle`, `DialogDescription`, `DialogTrigger`, `DialogClose`, `DialogOverlay`, `DialogPortal` | stepper multi-step : un `Dialog` unique piloté par une state machine |
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
