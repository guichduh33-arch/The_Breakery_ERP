# Audit de conformité breakery-ui-kit — 2026-08-31

## Synthèse

Périmètre balayé : les 1 209 fichiers `.ts/.tsx` trackés de `apps/**` et `packages/**`
(hors tests), plus les 12 `.css` du dépôt. Les six contrôles ont été rejoués
mécaniquement, et les DIX gardes de `scripts/ci/` ont été exécutées d'abord pour
séparer la dette connue du finding neuf : **les dix rendent vert**, la baseline
totale tolérée est de 2 classes mortes, 2 hex, 4 aplats d'or, 19 `rounded-full`,
4 `TOOLBAR_BTN_*`, 1 formule de ligne.

**Aucun P0.** Les trois anti-patterns qui cassent (import d'un primitif absent,
alpha sur un token `var()` nu, import par chemin interne) sont à **zéro** hors
baseline — la garde 3 tient réellement son invariant, et le barrel n'est jamais
contourné. Le seul anti-pattern encore massivement enfreint est le `<select>`
re-stylé à la main : **49 occurrences**, dont **aucune garde ne compte une seule**,
alors que `Select` et `selectClassName` existent depuis le 2026-07-07 et sont
déjà adoptés par 42 + 18 call-sites. Les deux P1 sont deux de ces `<select>` posés
dans le POS, hors du périmètre de la garde 5 (back-office seulement) : ils n'ont
**aucun anneau de focus**, dont un sur l'approbation manager d'un écart de caisse.

Compte : **P0 · 0** — **P1 · 2** — **P2 · 5** — **P3 · 3**.

## Tableau de couverture

| Contrôle | Total trouvé | Déjà en baseline CI | Findings neufs |
|---|---|---|---|
| (a) import d'un primitif absent du barrel | 0 / 186 exports, 411 sites d'import | — (aucune garde) | **0** |
| (b) couleur hardcodée (`#hex`, `bg-white`, palette brute) | 4 sites (0 palette Tailwind brute) | 2 occ. (garde 4, `index.css`) | **2** |
| (c) alpha sur un token `var()` nu | 2 occ. | 2 occ. (garde 3) | **0** |
| (d) import par chemin interne au lieu du barrel | 3 (tous `tailwind.config.ts`) | — | **0** |
| (e) `<select>` re-stylé à la main | **49** | 0 — invisible pour les 10 gardes | **49** (46 hors cas documentés) |
| (f) `useIdleTimeout` mal appelé / `IdleWarningToast` non monté | 2 appels, 2 montages | — | **0** |

Détail (c), le contrôle le plus important : les **146** modificateurs alpha du
dépôt portent **tous** sur la famille `cat-*`, la seule déclarée
`rgb(var(--x) / <alpha-value>)` (`packages/ui/tailwind-preset.ts:135-148`). Les
angles morts que j'ai sondés en plus de la garde sont vides eux aussi : alpha
**arbitraire** (`/[0.15]`, `/[15%]`) = 0 ; famille **inventée** hors liste noire
shadcn = 0 (les 2 candidats sont `slide-out-to-left-1/2` de `tailwindcss-animate`,
artefacts de ma regex) ; `@apply` dans un `.css` = 0 ; classe de couleur
**construite dynamiquement** (`` `bg-${x}/15` ``) = 0.

## Findings

| # | Sév. | Zone | Constat (fichier:ligne + classe/symbole exact) | Grep exécuté | Correctif proposé |
|---|---|---|---|---|---|
| **F1** | **P1** | POS / Reports | `apps/pos/src/features/reports/components/ActivityJournal.tsx:237` et `:248` — deux `<select>` (filtre appareil, filtre opérateur) en `className="h-8 rounded-md bg-bg-elevated border border-border-subtle text-xs text-text-primary px-2"`. **Aucun** `focus-visible:` : le contrôle retombe sur l'anneau du navigateur, mesuré à 2,398:1 par l'équipe de la garde 5 (< 3:1, WCAG 1.4.11). Trois écarts de plus au primitif : `h-8` (32 px) sur un terminal **tactile** contre `h-touch-min` (44 px), `border-border-subtle` contre le `border-border-strong` arbitré le 2026-08-19 (`packages/ui/src/primitives/Select.tsx:21-24`), `bg-bg-elevated` contre `bg-bg-input`. | scan `readOpenTag` + `expandConstants` sur les 49 `<select>` nus, bucket `noRing` | `<Select>` du barrel, ou `cn(selectClassName, 'h-8 text-xs')` si la densité du bandeau POS est un arbitrage tenu. |
| **F2** | **P1** | POS / Shift — **money-path** | `apps/pos/src/features/shift/components/CloseShiftModal.tsx:359` — `<select id="approver_select">` en `"… border border-border-subtle … focus:outline-none focus:border-gold"`. L'anneau est **explicitement supprimé** et remplacé par un simple changement de couleur de bordure, keyé sur `:focus` et non `:focus-visible` — exactement le motif que la garde 5 a **retiré de ses alternatives conformes le 2026-08-21**. C'est le sélecteur du manager qui approuve un écart de caisse au-dessus du seuil (`close_shift_v4`) : le champ le plus contrôlé de la fermeture de session n'a pas d'indicateur de focus valide. La garde ne le voit pas — son périmètre est `apps/backoffice/src/` seulement (en-tête de `scripts/ci/focus-ring-controls.mjs`). | idem F1, bucket `noRing` + `subtleBorder` | `<Select id="approver_select" className="min-h-[44px]">` — le primitif porte déjà l'anneau or `focus-visible` et `border-border-strong`. |
| **F3** | **P2** | BO + POS + kit | **49 `<select>` re-stylés à la main** alors que `Select` (`packages/ui/src/index.ts:7`) et `selectClassName` existent — l'anti-pattern nommé par la skill (« c'est la dette que le primitif a résorbée »). Divergences prouvées : **12** sans hauteur déclarée (`px-2 py-1`, `p-2`, `px-3 py-2` — la « hauteur OBTENUE » que `apps/backoffice/DESIGN.md:813` nomme comme un défaut), **13** hors `bg-bg-input`, **10** en rayon `rounded` nu (0,25 rem Tailwind, hors rampe `--radius-*`), **5** en `border-border-subtle`. Les plus nets : `features/accounting/components/CreateManualJEModal.tsx:187`, `features/accounting/pages/ChartOfAccountsPage.tsx:94`, `features/accounting/pages/GeneralLedgerPage.tsx:109`, `features/orders/components/RefundOrderModalBo.tsx:264`, `features/products/components/OptionIngredientPicker.tsx:87` et `:122`. | `git ls-files` + masque de commentaires + `readOpenTag` ; comparaison avec les 42 `<Select>` et les 18 `<select className={selectClassName}>` | Passage à `<Select>` par lots, en priorité les 12 sans hauteur (défaut nommé par DESIGN.md). Une **garde 11** sur le modèle de la 5, périmètre élargi à `apps/pos/` et `packages/ui/`, est le seul filet qui empêche la dette de regrandir. |
| **F4** | **P2** | `packages/ui` — le kit se contredit | `packages/ui/src/components/promotion-form/fields.tsx:61` (`MultiSelect`) et `:94` (`SingleSelect`) — deux `<select>` du kit lui-même en `border border-border-subtle`, alors que `packages/ui/src/primitives/Select.tsx:21-24` porte `border-border-strong` avec le commentaire d'arbitrage : « `border-subtle` ne délimitait rien », 3:1 de WCAG 1.4.11. Vivants : importés par `promotion-form/ConditionsTab.tsx:9` et `GeneralTab.tsx:11`. Le composant partagé rend sous les **deux** thèmes. | `grep -rn "SingleSelect\|MultiSelect"` → 2 importeurs vivants | `selectClassName` pour `SingleSelect` ; `cn(selectClassName, 'min-h-[7rem] py-2')` pour `MultiSelect` (l'attribut `multiple` passe au primitif). |
| **F5** | **P2** | BO — commentaires faux | Trois commentaires affirment que le kit n'exporte pas `Select`, ce que `packages/ui/src/index.ts:7` dément : `features/settings/roles/components/CreateRoleDialog.tsx:12` (« @breakery/ui n'exporte pas de Select. ») ; `features/settings/roles/components/UserOverridesPanel.tsx:12-13` (« n'exporte ni Select ni RadioGroup » — moitié fausse) ; `pages/reports/PurchaseItemsPage.tsx:167` (« @breakery/ui n'exporte pas de composant Select »), **contredit trois lignes plus bas** par `className={cn(selectClassName, 'h-9 w-auto')}` ligne 170. C'est précisément le mythe que la skill dit avoir coûté ~75 call-sites divergents. | `grep -rniE "n'exporte pas de (composant )?Select\|has no Select"` sur `apps packages docs .claude` (worktrees non trackés écartés) | Retirer les trois lignes lors du prochain passage sur ces fichiers. `ChoiceGroupCard.tsx:5` (« no RadioGroup ») reste **vrai**, ne pas y toucher. |
| **F6** | **P2** | BO / Products | `features/products/components/UnitsPanel.tsx:207` et `:441` — la chaîne `h-touch-min rounded-md border border-border-strong bg-bg-input px-3 text-sm … focus-visible:outline …` est une **recopie littérale** de `selectClassName`, à `font-mono` près. Aucune divergence visuelle, donc invisible à toute garde — mais la valeur ne suivra pas le prochain arbitrage du primitif (comme celui du 2026-08-19 qui a fait passer la bordure à `strong`). | bucket complet des 49, comparaison chaîne à chaîne avec `Select.tsx:24` | `<Select className="font-mono">`. |
| **F7** | **P2** | `packages/ui` | `packages/ui/src/components/CustomerCategoryBadge.tsx:13` — `const FALLBACK_COLOR = '#64748B'` (slate-500), injecté ligne 43 en `style={{ backgroundColor: color+'33', color }}`. La garde 4 ne le voit pas **par construction** : elle attrape le doublon d'un token, jamais la couleur inconnue (en-tête de `hardcoded-theme-colors.mjs`). Le composant rend sous les deux thèmes ; sur `luxe-dark` un texte `#64748B` sur son propre aplat à 20 % est en dessous de tout seuil lisible. | `grep -rnE "['\"]#[0-9a-fA-F]{3,8}['\"]" --include=*.ts --include=*.tsx apps packages/ui/src` | Le repli appartient au thème : `var(--text-muted)` / `bg-bg-overlay`, comme la branche `category === null` juste au-dessus (ligne 24) le fait déjà correctement. |
| **F8** | **P3** | BO / Purchasing | `features/purchasing/components/POPrintView.tsx:27` — `className="bg-white text-black p-6 print:p-0 …"`, seul emploi de `bg-white`/`text-black` du dépôt hors commentaires. Vivant (`pages/purchasing/PurchaseOrderDetailPage.tsx:62,337`). Aucune garde ne surveille ces deux classes. Surface d'**impression** : le blanc y est peut-être délibéré. | `grep -rnE "\b(bg\|text\|…)-(white\|black)(\/[0-9]+)?\b"` sur `apps packages/ui/src` | **Arbitrage Mamat** — soit un token d'impression dédié dans `colors.css`, soit une exception gravée dans DESIGN.md. Le fichier figure déjà dans les arbitrages en attente du re-audit du 2026-08-27. |
| **F9** | **P3** | POS / kit | `packages/ui/src/components/IdleWarningToast.tsx:105` — le bouton dit « Stay signed in », mais côté POS l'issue de l'inactivité n'est plus une déconnexion : `apps/pos/src/components/IdleTimeoutMount.tsx:24` appelle `useAuthStore.getState().lock()` (renversement ratifié S36 / DEV-S36-C-01). Le libellé promet une chose, le système en fait une autre. Anglais correct, donc invisible à toute relecture de langue. | `grep -rn "useIdleTimeout\|IdleWarningToast"` | Libellé neutre (« Stay active ») ou prop de copie côté appelant, puisque le BO, lui, se déconnecte bien. |
| **F10** | **P3** | Outillage CI | Aucune des dix gardes ne compte un `<select>` fait main, et la garde 5 (anneau de focus) s'arrête à `apps/backoffice/src/` — c'est pourquoi F1 et F2 vivent dans le POS. La leçon du dépôt (« un helper ne tue pas une classe de bug, une garde oui », campagne du 2026-08-29) s'applique mot pour mot ici. | lecture des 10 scripts de `scripts/ci/` | Étendre le périmètre de la garde 5 à `apps/pos/src/` et `packages/ui/src/` (baseline amorcée sur l'existant), et ajouter au même script un compteur `<select>`-sans-`selectClassName` plafonné à 49. |

## Dérives de la skill

1. **`useIdleTimeout` — « déclenche `signOut()` »** (tableau *Hooks*, ligne
   `useIdleTimeout` : « monté dans POS + BO ; déclenche `signOut()` après
   `session_timeout_minutes` du rôle »). Vrai pour le back-office
   (`apps/backoffice/src/App.tsx:23` → `logout()`), **faux pour le POS** depuis
   S36 : `apps/pos/src/components/IdleTimeoutMount.tsx:24` appelle `lock()`, qui
   préserve la session, le shift ouvert et le panier. Le renversement est
   documenté dans l'en-tête du fichier (lignes 8-13). La skill décrit le
   comportement d'avant.

2. **Chemin de référence erroné.** *Sources de vérité* cite
   `apps/backoffice/src/features/accounting/components/CreateManualJeModal.tsx`
   (« Je » minuscule). Le fichier réel est **`CreateManualJEModal.tsx`**. La
   casse passe inaperçue sur Windows et casserait sur la CI Linux — c'est un
   énoncé factuel, il se corrige contre le code.

3. **« Ne jamais importer un primitif absent du barrel » — la skill a raison, et
   son propre exemple est périmé.** Le tableau ❌ propose pour `Popover` :
   « Radix `@radix-ui/react-popover` direct si besoin ». Aucun `package.json` du
   dépôt ne déclare cette dépendance (ni `react-tooltip`, ni
   `react-radio-group`, ni `react-checkbox`) : suivre ce conseil revient à
   ajouter une dépendance, pas à « utiliser direct ». Le fallback réel est un
   `<div>` positionné ou l'attribut `title`.

4. **Ce que la skill dit et que le code CONFIRME**, à ne pas re-signaler : les
   13 primitives listées correspondent exactement aux 13 fichiers de
   `packages/ui/src/primitives/` et sont toutes exportées ; `Select` est bien un
   `<select>` natif stylé dont `selectClassName` s'exporte seul (18 call-sites
   l'utilisent ainsi) ; `RadioGroup`, `Checkbox`, `Popover`, `Tooltip`,
   `SelectItem` sont bien absents ; `IdleWarningToast` n'est bien pas monté par
   le hook et est ajouté séparément dans les deux shells
   (`apps/pos/src/App.tsx:96`, `apps/backoffice/src/App.tsx:85`).

## Faux positifs écartés

- **Les 2 entrées de la baseline de la garde 3** —
  `apps/pos/src/features/payment/split/SplitPaymentFlow.tsx` (`to-payment`) et
  `packages/ui/src/components/TableSelectorModal.tsx` (`bg-green-soft`). Dette
  connue, gelée, plafond jamais relevé. Rien de neuf.
- **Les 2 `#fff` de `apps/backoffice/src/index.css:152,186`** — baseline de la
  garde 4, même régime.
- **Les 14 hex de `features/reports/utils/chartColors.ts`** — l'en-tête de la
  baseline de la garde 4 les nomme explicitement : la garde attrape le
  **doublon** d'un token, ces valeurs n'égalent aucun token. Ce sont des rampes
  de data-viz, hors portée par construction, pas une tolérance.
- **Les 146 `bg-cat-*/N` et `border-cat-*/N`** — la famille `cat` est la seule
  déclarée en triplet RGB (`tailwind-preset.ts:135-148`), l'alpha y est légal.
- **`apps/backoffice/src/pages/Promotions.tsx:313`** — `<select>` en
  `bg-transparent focus-visible:outline-none`, mais posé dans un `<label>`
  portant `FOCUS_WITHIN_RING` (ligne 311). C'est le motif documenté et admis par
  la garde 5, qui rend vert dessus.
- **`features/inventory-production/components/ProductionEntryCard.tsx:435,467`** —
  `<select>` en `INK_FIELD_BOX_CELL` + `FOCUS_RING_INK` : le thème encre du mode
  boulanger, pour lequel le kit n'a pas de primitif. Écart assumé, pas une
  recopie sauvage.
- **`packages/ui/src/primitives/Select.tsx:31`** — le `<select>` nu détecté ici
  **est** la définition du primitif.
- **Les 3 imports par chemin non-barrel** —
  `apps/{pos,backoffice}/tailwind.config.ts:2` (`@breakery/ui/tailwind-preset`)
  et `.design-sync/tailwind.config.ts:6` : sous-chemin déclaré dans
  `packages/ui/package.json` (`exports`), fichiers de configuration, aucun JSX.
- **`slide-out-to-left-1/2` / `slide-in-from-left-1/2`**
  (`packages/ui/src/primitives/Dialog.tsx:51`) — utilitaires de
  `tailwindcss-animate`, pas des couleurs ; artefact de ma propre regex.
- **Les commentaires qui CITENT un défaut** (`text-white`, `#ffffff`,
  `bg-danger/15`…) dans `CustomerAvatar.tsx`, `GeneralPanel.tsx`,
  `EditOrderItemsModal.tsx`, etc. : ils expliquent une correction, ils ne la
  commettent pas. Le masque `maskComments` du socle les neutralise, mon scan
  l'utilise.
- **`h-9` sur un `<select>` de barre de filtres** — `apps/backoffice/DESIGN.md`
  ligne 810 le sanctionne explicitement comme le cran « champ en ligne ». Seul
  `h-9` **dans un dialogue** contredit la ligne 809 ; je n'ai pas cherché à
  classer les 49 par contexte (voir ci-dessous).

## Ce que je n'ai pas pu vérifier

- **Le contexte dialogue / bandeau de chaque `<select>` de F3.** DESIGN.md
  (809-810) fixe deux hauteurs selon le rôle du champ — 44 px en dialogue, 36 px
  en ligne. Trancher les 49 demanderait de remonter l'arbre JSX de chaque
  occurrence ; je n'ai plafonné que les divergences **mécaniquement prouvables**
  (hauteur absente, fond, rayon, bordure). Le sous-ensemble « `h-9` posé dans un
  dialogue » reste à relever fichier par fichier.
- **Le rendu réel.** Aucun sondage navigateur : la leçon du dépôt
  (2026-08-21/22) est qu'un grep de classe est un **majorant** que seul le
  navigateur tranche — et symétriquement qu'un token ajouté au preset ne génère
  rien avant redémarrage du serveur. Toutes mes affirmations de contrôle (c) sont
  donc adossées au **preset** (source de vérité désignée), pas à un pixel.
- **Le contraste chiffré** de F1, F2 et F7. Je reprends les mesures déjà faites
  par l'équipe des gardes (2,398:1 pour l'anneau navigateur sur feuille blanche,
  3:1 de WCAG 1.4.11) ; je n'ai mesuré aucune de ces valeurs moi-même sur le
  thème sombre du POS.
- **`pnpm --filter @breakery/ui typecheck`** — non lancé : aucun finding n'en
  dépendait (le contrôle (a) est à zéro, donc rien ne casse le build), et la
  skill signale elle-même que cette commande échoue sur un `node_modules`
  incomplet sans que ce soit une régression.
- **Les composants de `packages/ui/src/components/` non exportés par le barrel**
  (sous-modules de `promotion-form/`, etc.) — hors des six contrôles ; je n'ai
  vérifié leur vivacité que pour F4.
