# design-sync — notes repo-spécifiques

- `@breakery/ui` est **source-only** : pas de script build, `main`/`exports` pointent sur `./src/index.ts`. Le convertisseur bundle directement depuis la source : `--entry ./packages/ui/src/index.ts` (chemin relatif à la **racine du repo**, pas au package).
- `--node-modules packages/ui/node_modules` (react + @types/react y résolvent via les symlinks pnpm).
- **CSS = Tailwind compilé pour le sync** : le package n'expédie aucune feuille compilée (chaque app compile la sienne). `buildCmd` compile `.design-sync/tailwind.entry.css` → `packages/ui/.ds-tailwind.css` (gitignoré) avec le preset du repo (`packages/ui/tailwind-preset.ts`) ; content = sources ui + `.design-sync/previews/`. **Toujours relancer `buildCmd` après avoir ajouté/modifié des aperçus** — sinon leurs classes utilitaires n'existent pas dans la feuille.
- **Tokens inlinés dans la feuille compilée** (import du barrel `src/tokens/index.css` en tête de `tailwind.entry.css`) : `copyTokens` exige un `tokensPkg` sous node_modules, or les tokens vivent dans le package. `ds-bundle/tokens/` reste vide — c'est voulu.
- **Thèmes** : `:root` = luxe-dark (POS). `.theme-backoffice` = thème ivoire BO. `.dark` = alias du défaut. Les aperçus posent le fond explicitement (les cartes rendent sinon sur fond blanc avec des tokens luxe-dark).
- **Fonts** : via `extraFonts` → fontsource des apps (Inter Variable, JetBrains Mono Variable, Playfair Display 400/400i/600/700, Instrument Sans Variable depuis apps/backoffice).
- **Playwright** : cache local chromium-1223 → `playwright@1.60.0` installé dans `.ds-sync/` (le repo épingle 1.62.1/chromium-1234, non caché — ne pas laisser npx télécharger 200 Mo sans demander).
- npm bloque les postinstall (`install-scripts`) : esbuild fonctionne quand même (binaire via dépendance optionnelle `@esbuild/win32-x64`).

## Known render warns (triagés légitimes)

- `[FONT_MISSING] "Instrument Sans", "Inter", "Inter Fallback", "JetBrains Mono"` — noms de REPLI dans les piles de tokens (`'Inter Variable', 'Inter', 'Inter Fallback', …`). Les familles Variable correspondantes SONT embarquées ; les apps n'expédient pas non plus ces statiques (repli métrique `local()` inline dans leurs index.html). Fidèle au repo.

## Pièges d'aperçus (consolidé des vagues de rédaction 2026-08-17)

- **`extraEntries: ["sonner"]` est requis** : le Toaster du kit et un aperçu qui importe
  `toast` de sonner bundlent sinon DEUX copies (singletons ToastState disjoints → Toaster
  rend `null`). `toast` n'est pas ré-exporté par `@breakery/ui`.
- **Règle d'import des aperçus (canon assoupli, assumé)** : `'@breakery/ui'` + `lucide-react`,
  et `useEffect`/`useRef` depuis `'react'` QUAND le composant n'a aucun état visible sans
  (VirtualKeypadProvider, IdleWarningToast, CustomerForm, LoyaltyAdjustForm, modales AutoKeys).
- **Changer `cfg.overrides`/`extraEntries` en cours de vague bloque les sous-agents** :
  `preview-rebuild` refuse (`[CONFIG_STALE]`) tant qu'un `package-build` complet n'a pas
  re-stampé — poser TOUTE la config avant de dispatcher, sinon un re-stamp orchestrateur
  au milieu. NB : `extraEntries` est dans le hash GLOBAL → le changer invalide les grades
  de tous les composants.
- Techniques d'états riches (validées) : setter natif `HTMLInputElement.prototype.value`
  + `dispatchEvent('input')` et `form.requestSubmit()` au mount (formulaires) ; dispatch
  d'événement custom au mount (IdleWarningToast) ; clics d'AutoKeys espacés de 60 ms
  (jamais synchrones — batch React) ; callback ref pour focus (IngredientPicker, 1 seul
  auto-focus par planche) ; wrappers scopés par ref, jamais `document.querySelector` nu.
- Overlays/portals : poser un sol `fixed inset-0 bg-bg-base` AVANT la modale (sinon
  backdrop-blur sur blanc) ; overlay VKP bottom-0 → padding bas ≈ hauteur overlay ;
  sonner fixed → wrapper `relative overflow-hidden` + `!absolute` en re-incluant
  `toaster group` (le `{...props}` de Toast.tsx REMPLACE la className par défaut).
- Quirks composants : Stat = `direction horizontal|vertical` + `emphasis` (PAS de
  up/down — c'est KpiTile.delta) ; NumpadPin ne prérempli pas (état partiel via
  NumpadVirtual `initialValue`) ; NumpadVirtual mode cash affiche la valeur brute
  (comportement source) ; ComboLineRow et le span de QuantityStepper héritent la couleur
  (poser `text-text-primary` sur le conteneur) ; PromotionForm scope `cart` (les autres
  scopes débordent la cellule) ; CenterModal n'injecte pas de croix ; ScrollArea
  `type="always"` pour une scrollbar visible ; zéro barré JetBrains Mono ≠ strikethrough.
- Largeurs d'aperçu calibrées : ComboLineRow 640px, TabletInboxRow 820px, Stat
  horizontale ≥ w-80.
- Toaster en capture : toasts persistants via `duration: Infinity` + `expand`, déclenchés
  en useEffect. DiscountModal : l'ouverture réelle montre 3 erreurs de validation —
  cliquer un chip preset (aria-label = nom) pose type+valeur+motif d'un coup (AutoPreset).
- DiscountModal 800x700 : l'aperçu Subtotal/Discount reste sous le pli de la ScrollArea
  interne (scroll réel du modal) — assumé, pas un défaut de la carte.

## Re-sync risks

- La feuille Tailwind compilée dépend du preset ET des content-globs : un nouveau répertoire de sources UI (hors `packages/ui/src` et `.design-sync/previews/`) n'y serait pas scanné.
- `playwright@1.60.0` dans `.ds-sync/` est lié au cache chromium-1223 de CE poste ; sur un autre poste, re-résoudre la version contre le cache local.
- Les fonts viennent des node_modules des apps (chemins `extraFonts`) : un bump fontsource ou un déplacement de dépendance casse silencieusement la copie (`[FONT_DANGLING]` le signalerait).
