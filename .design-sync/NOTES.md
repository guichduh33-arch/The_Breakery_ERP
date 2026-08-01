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
- Fonts via Fontsource dans les node_modules des APPS (pas de packages/ui). Depuis
  l'audit cohérence du 2026-08-01 les deux thèmes partagent la MÊME pile, donc
  `cfg.extraFonts` ne pointe plus que dans `apps/pos/node_modules` : Inter et JetBrains
  Mono Variable, Playfair 400-italic **et les romaines 400/600/700**. Fraunces et
  IBM Plex Sans/Mono sont sortis du système. Les romaines sont indispensables :
  `font-display` est majoritairement utilisé SANS `italic`, et une famille dont seule
  l'italique est déclarée ne matche pas une demande `font-style: normal` — le navigateur
  retombait sur Times New Roman. `Inter Fallback` = @font-face métrique inline dans les
  index.html des apps (jamais shippable) → suppressé via runtimeFontPrefixes.
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

## Audit cohérence 2026-08-01 (jeu de tokens unifié)

- Le handoff « cohérence POS sombre / Backoffice clair » a réécrit les cinq fichiers de
  `packages/ui/src/tokens/` : neutres des deux thèmes sur un axe de teinte unique, or
  accent dans les DEUX thèmes, pile typo commune, rampes de surfaces monotones,
  élévation sombre par filet clair. Conséquence pour la synchro : **toute planche
  re-capturée après ce lot est à relire, pas seulement les composants touchés** — la
  valeur de chaque token a bougé.
- **Une échelle typo qui change casse les cartes `single`.** La décompression du bas
  d'échelle (corps 15 → 16 px, sm 13 → 14 px) a allongé le contenu des modales :
  la carte de DiscountModal coupait sa dernière ligne d'erreur et son pied. Viewport
  remonté à 720x1010. Réflexe : après tout mouvement de `--type-*`, revérifier les
  overrides `cardMode: single`, dont la hauteur est figée à la main.
- **`--type-3xl` vaut 34 px, et c'est un arbitrage, pas un arrondi.** La première
  version du jeu de tokens le posait à 38 px ; à ce corps, une valeur monétaire
  complète (`Rp 4,850,000`) ne tenait plus sur une ligne dans une tuile de dashboard,
  JetBrains Mono étant plus large que l'ancien Fraunces à corps égal. Mamat a tranché
  le 2026-08-01 : on baisse le corps plutôt que d'élargir les tuiles. Le couple
  « corps de la valeur KPI × largeur de tuile » est donc tendu — le rebumper redonne
  le même défaut.
- Les sous-parties de composés Radix rendues hors de leur parent (`DialogClose` sans
  `Dialog`, `TabsList` sans `Tabs`, `ScrollBar` sans `ScrollArea`…) produisent des
  erreurs de console dans leurs cartes plancher. Constaté sur une vingtaine d'entre
  elles le 2026-08-01 : inhérent au rendu isolé, aucune n'est dans le lot noté.

## Re-sync risks (à lire AVANT toute re-synchro)

- **La CSS shippée dépend d'un artefact régénérable** : `packages/ui/dist/ds-preview.css`
  (gitignoré) doit être recompilée via `cfg.buildCmd` AVANT le converter, sinon
  cssEntry pointe sur un fichier absent/périmé. La safelist vit dans
  `.design-sync/tw-preview.config.ts` — si le preset ou les tokens gagnent des familles,
  l'étendre, sinon les nouveaux utilitaires token n'existeront pas dans les designs.
  Le piège s'est refermé le 2026-08-01 : le preset avait gagné `shadow-hairline` et
  `p/px/py/gap-gutter-compact`, les deux motifs de la safelist ne les couvraient pas,
  et les classes ne compilaient tout simplement pas. C'est le mode d'échec le plus
  discret du dispositif — rien ne casse, rien ne warn, l'utilitaire est juste absent.
  Vérifier la classe dans la CSS compilée (`.shadow-hairline`, point compris), pas la
  définition du token : la variable CSS y est de toute façon, elle ne prouve rien.
- **Playwright épinglé à la main** : `.ds-sync` (régénéré à chaque sync) doit recevoir
  `npm i playwright@1.60.0` tant que le cache chromium local reste en 1223/1226 —
  revérifier `%LOCALAPPDATA%\ms-playwright` avant d'installer.
- **extraFonts pointe dans les node_modules d'une APP** (`apps/pos` seule depuis le
  2026-08-01, le Backoffice ne remappant plus rien) : un bump fontsource ou un
  déplacement de dépendance casse silencieusement les chemins — vérifier les 6 entrées
  si [FONT_MISSING] réapparaît sur autre chose que les noms de repli listés plus bas.
- **Données inline dans les previews** : timestamps ancrés à `Date.now()-N`
  (TabletOrderCard), montants et produits en dur — stables mais à rafraîchir si le
  format `formatIdr` ou les enums (TenderRowMethod, OrderStatus) évoluent ; le diff
  d'ancre les re-signalera via sourceKeys.
- **Partiellement vérifié** : 28/81 composants ont des previews notées — toutes en
  `good` au 2026-08-01, relues sur planche après le lot de tokens ; les 53 autres
  sont des cartes plancher (offre permanente d'authoring incrémental). Les warns
  [FONT_MISSING] listés plus bas sont triés comme légitimes — un warn ABSENT de cette
  liste est nouveau.
- **Le build suppose** : node 24 (>=22.12), pnpm frozen lockfile déjà installé,
  tailwindcss v3 dans packages/ui/node_modules, aucun réseau requis.

## Known render warns

- `[FONT_MISSING] "Inter", "JetBrains Mono"` : noms de REPLI dans les stacks — les
  familles réellement utilisées (`Inter Variable`, `JetBrains Mono Variable`) shippent
  bien en @font-face, vérifiable dans `ds-bundle/fonts/fonts.css`. Aucun substitut :
  trié comme légitime. Avant le 2026-08-01 la liste disait `"IBM Plex Sans",
  "JetBrains Mono"` : même phénomène, l'entrée a seulement changé de membre quand le
  Backoffice a cessé de remapper ses polices.
