# design-sync — notes repo-spécifiques

- `@breakery/ui` est consommé en SOURCE (`main: ./src/index.ts`, pas de build) — le
  converter tourne en mode synth-entry avec `--entry ./packages/ui/src/index.ts` et
  `--node-modules packages/ui/node_modules`.
- Styling = Tailwind v3 + preset (`packages/ui/tailwind-preset.ts`). La CSS des previews
  est compilée par `cfg.buildCmd` vers `packages/ui/dist/ds-preview.css` (cfg.cssEntry,
  borné à PKG_DIR). L'entrée `.design-sync/tw-preview.css` importe la cascade de tokens
  (`packages/ui/src/tokens/index.css`) AVANT les directives @tailwind pour que les
  définitions de tokens shippent dans la CSS compilée — `tokensGlob` seul ne fait rien
  sans `tokensPkg` (copyTokens exige tokensPkg).
- `--minify` dans buildCmd est OBLIGATOIRE : les commentaires des tokens contiennent des
  textes `@import '@fontsource-...'` que le scan de validate prend pour de vrais imports
  ([CSS_IMPORT_MISSING] faux positif sans minify).
- Fonts via Fontsource dans les node_modules des APPS (pas de packages/ui) :
  POS = Inter/Fraunces/JetBrains Mono Variable + Playfair 400-italic ;
  Backoffice = IBM Plex Sans Variable + IBM Plex Mono 400/500/600. Câblées par
  cfg.extraFonts. `Inter Fallback` = @font-face métrique inline dans les index.html des
  apps (jamais shippable) → suppressé via runtimeFontPrefixes.
- Playwright : cache chromium local = builds 1223/1226 ; le pin repo (1.62.0 → 1234) ne
  matche PAS. `.ds-sync` installe `playwright@1.60.0` (→ chromium 1223).

## Gotchas de composition des previews (vague 1)

- Radix ScrollArea : `type="always"` obligatoire en capture statique (défaut = hover-only,
  thumb jamais visible sans souris).
- Portals Dialog/Sheet : rendre un `<div aria-hidden className="fixed inset-0 bg-bg-base" />`
  AVANT le `<Dialog open>` — la cellule blanche transparaît sinon derrière l'overlay
  translucide. Overlays en `cfg.overrides.<Name> = {cardMode: single, viewport}`.
- Tout changement de `cfg.overrides` après un build → `[CONFIG_STALE]` sur preview-rebuild
  des composants visés : seul un full `package-build.mjs` re-stampe le cfgSlice.
- Separator vertical : le parent doit fixer la hauteur (`flex h-12 items-center`).
- EmptyState : composant Lucide NU (`icon={PackageOpen}`), pas d'instance ; `action`
  objet `{label, onClick}` = CTA gold canonique.
- Compositions larges (rangées, tables, layouts multi-colonnes) → `cardMode: column`
  ([GRID_OVERFLOW] sinon : Card, EmptyState, Separator, Tabs en portent déjà).

## Gotchas de composition (vague 2)

- Currency et QuantityStepper héritent leur couleur (`currentColor`, aucune classe
  couleur dans la source) → l'enveloppe de preview doit poser `text-text-primary`.
- NumpadVirtual : `initialValue` suffit (dots PIN, montant) — pas de simulation de taps.
- Variante claire (backoffice) d'un composant : enveloppe `theme-backoffice bg-bg-base`.
- Format IDR réel = `Rp 4,850,000` (virgules, `packages/utils/src/idr.ts`) — les previews
  suivent le code, pas le folklore `Rp 28.000`.
- Bug source BrandMark (fontSize px rendus dans un viewBox 100×100, glyphe ~19 % en sm)
  détecté par la vague 2, CORRIGÉ le 2026-08-01 sur la branche design avec accord Mamat
  (`fontSize = 60` en unités viewBox) ; tests BrandMark 4/4 verts, preview re-notée good.

## Gotchas de composition (vague 3)

- Badges à objet domaine (CustomerCategoryBadge) : petit builder local avec défauts
  pour satisfaire l'interface complète sans bruit.
- Composants à timer vivant (TabletOrderCard `useNow`) : ancrer les timestamps à
  `Date.now() - N` au chargement du module — âge plausible, pas de mock de timers.
- `Button variant="primary"` est VERT par design (money-path) ; l'or = accents.
- TenderRow couvre 9 méthodes (cash|card|qris|edc|transfer|store_credit|gopay|ovo|dana),
  pas seulement les 4 des tokens payment-*.

## Re-sync risks (à lire AVANT toute re-synchro)

- **La CSS shippée dépend d'un artefact régénérable** : `packages/ui/dist/ds-preview.css`
  (gitignoré) doit être recompilée via `cfg.buildCmd` AVANT le converter, sinon
  cssEntry pointe sur un fichier absent/périmé. La safelist vit dans
  `.design-sync/tw-preview.config.ts` — si le preset ou les tokens gagnent des familles,
  l'étendre, sinon les nouveaux utilitaires token n'existeront pas dans les designs.
- **Playwright épinglé à la main** : `.ds-sync` (régénéré à chaque sync) doit recevoir
  `npm i playwright@1.60.0` tant que le cache chromium local reste en 1223/1226 —
  revérifier `%LOCALAPPDATA%\ms-playwright` avant d'installer.
- **extraFonts pointe dans les node_modules des APPS** (apps/pos, apps/backoffice) :
  un bump fontsource ou un déplacement de dépendance casse silencieusement les chemins —
  vérifier les 8 entrées si [FONT_MISSING] réapparaît.
- **Données inline dans les previews** : timestamps ancrés à `Date.now()-N`
  (TabletOrderCard), montants et produits en dur — stables mais à rafraîchir si le
  format `formatIdr` ou les enums (TenderRowMethod, OrderStatus) évoluent ; le diff
  d'ancre les re-signalera via sourceKeys.
- **Partiellement vérifié** : 28/81 composants ont des previews notées ; les 53 autres
  sont des cartes plancher (offre permanente d'authoring incrémental). Les warns
  [FONT_MISSING] listés plus bas sont triés comme légitimes — un warn ABSENT de cette
  liste est nouveau.
- **Le build suppose** : node 24 (>=22.12), pnpm frozen lockfile déjà installé,
  tailwindcss v3 dans packages/ui/node_modules, aucun réseau requis.

## Known render warns

- `[FONT_MISSING] "IBM Plex Sans", "JetBrains Mono"` : noms de REPLI dans les stacks —
  les familles réellement utilisées (`IBM Plex Sans Variable`, `JetBrains Mono Variable`)
  shippent bien en @font-face. Aucun substitut : trié comme légitime.
