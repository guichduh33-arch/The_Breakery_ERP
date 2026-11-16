---
target: critique et audit du BO
total_score: 27
max_score: 40
na_heuristics: 
p0_count: 3
p1_count: 3
timestamp: 2026-08-21T08-10-14Z
slug: apps-backoffice
---
# Critique + audit du back-office — 2026-08-21

Method: dual-agent (A: revue design · B: détecteur + navigateur). Cible : `apps/backoffice`
au commit `3e6c8ee5`, dev server local, session authentifiée en E2E Owner / Admin (perms 149).

## Effet de bord assumé sur la base dev

Le sous-agent A a cliqué `Record payment` pour tester la garde. Elle n'existe pas.
L'écriture est réelle et conservée (arbitrage de Mamat, 2026-08-21) parce qu'elle est
la preuve du P0-2 et que le ledger est append-only par conception :

- `PO-20260821-2089`, statut `cancelled` depuis 03:37
- paiement `804c6a55-…`, Rp 6.660, `transfer`, 15:33
- écriture `JE-20260821-0057`, `posted`, débit = crédit = Rp 6.660

## Score design — 27/40

| # | Heuristique | Note | Problème principal |
|---|---|---|---|
| 1 | Visibilité de l'état | 3 | Une écriture d'argent irréversible se termine sans aucun message. |
| 2 | Langage du métier | 3 | Vocabulaire métier excellent, mais `D-7` / `yest` / `prev` + 4 formats de date. |
| 3 | Contrôle et liberté | 2 | Sur un PO annulé, `Edit` est bloqué et `Record payment` ne l'est pas. |
| 4 | Cohérence | 2 | 5 hauteurs de champ, 3 hauteurs de bouton en modale, 2 séparateurs décimaux, 2 couleurs de lien. |
| 5 | Prévention d'erreur | 2 | `Void` fait 24×24 px, à 2 px de `Details`, même gris. |
| 6 | Reconnaître > se souvenir | 3 | La légende de la Matrix est à y = 7003 px, sous les 755 cases qu'elle explique. |
| 7 | Souplesse | 3 | Ctrl+K et l'état de liste dans l'URL sont réels ; 46 rapports sans favoris ni récents. |
| 8 | Esthétique | 4 | Meilleur axe. Zéro défaut de contraste texte sur Products et Today. |
| 9 | Récupération d'erreur | 2 | Un mauvais PIN affiche « Login failed. » et rien d'autre. |
| 10 | Aide | 3 | Textes explicatifs excellents, mais aucune note là où 3 « Total » se contredisent. |

## Verdict de spécificité — 8/10 authentique

L'identité tient et se mesure dans le nœud rendu : fond gradué `22px 22px`, gouttière de
page 22 px, un seul aplat d'encre par écran vérifié sur trois pages, plaque monogramme en
Playfair 26×26 rayon 3 px, bande de KPI qui calcule `297,75px ×4` sans qu'aucune valeur ne
coupe. Le produit lit encore comme un seul objet après un refacto de ~200 fichiers.

Les contrôles, eux, sont génériques : hauteur de champ documentée 44 px, rendue en
44 / 36 / 34 / 32 / 28. Liens or sur Daily sales, `#2b6c9c` (= `chart-1`) sur Orders — donc
le bleu veut dire « série de données » ici et « clique ici » là.

## Ce qui marche

1. **La loi de design est appliquée dans le nœud rendu, pas seulement écrite.** Tokens
   d'ombre exacts au chiffre près (Flottant, Modale), nav 52 px fermée par un filet or.
   Ça marche parce que la direction est écrite en mesures, pas en adjectifs.
2. **« Toute donnée en mono » est réel.** Une seule violation sur tout le dashboard
   (`Last sync 15:23`, `Dashboard.tsx:185`).
3. **Les réserves sont dites à côté de la mesure**, pas en note de bas de page. La Matrix
   dit même qu'on ne peut pas éditer les permissions depuis le back-office.

## Problèmes prioritaires

### [P0-1] Daily sales publie deux « Totaux » pour la même période
`NET REVENUE` / `BY CASHIER` / `DAY BY DAY` = Rp 3,26 jt (3.257.500).
`REVENUE BY CATEGORY` / `TOP PRODUCTS` / `PAYMENTS` = Rp 2,26 jt. Écart Rp 1.000.000 (30 %).
KPI `ORDERS` = 40 contre « 26 payments across 26 orders ». La seule réserve de la page
(« figures net of refunds ») n'explique ni l'un ni l'autre. Cause probable non confirmée :
les panneaux à ×,26 excluent le B2B (le dashboard montre `B2B 47,5%` de part). La page ne
le dit nulle part. Correctif : chaque panneau nomme son périmètre dans son sous-titre, plus
une ligne de rapprochement sous `PAYMENTS`.

### [P0-2] Un bon de commande annulé accepte un paiement
`PurchaseOrderDetailPage.tsx:218` — `canRecordPay = canPay && paymentStatus !== 'paid' && totalDue > 0`.
`PurchaseOrderDetailPage.tsx:222` — `editable = canEdit && status === 'pending' && !hasGrn && !hasPayments`.
`canRecordPay` ne regarde jamais `cancelled`. Deux écritures sur le même document mort,
gardées différemment. La fenêtre ne mentionne jamais l'annulation. L'écriture comptable part.

### [P0-3] Un menu clavier sans indicateur de focus — sur un `Delete`
`/backoffice/loyalty`, menu d'action de ligne. Mesuré vivant : panneau `#ffffff`, entrée
focus `#ffffff`, ratio 1,000:1 ; `outline: rgba(0,0,0,0)` ; `box-shadow: none`.
Classe : `hover:bg-bg-overlay focus:bg-bg-overlay focus:outline-none`.
Cause racine `packages/ui/src/tokens/colors.css:206-210` : sous `.theme-backoffice`,
`--surface-2` (= `--bg-elevated`) et `--surface-3` (= `--bg-overlay`) valent tous deux
`#ffffff`. Tout état `bg-bg-overlay` sur une carte blanche est mort. 12 emplacements, dont
`CustomerListRow.tsx:154` qui est le `Delete` rouge. Le dépôt connaît le piège
(`ProductTypeahead.tsx:122` le nomme en commentaire et utilise `bg-surface-4`) : le
correctif a été fait là et jamais propagé. Aucune garde CI ne peut le voir —
`tailwind-dead-classes` détecte un nom de classe mort, pas une classe vivante qui résout à
la couleur de son fond.

### [P1-1] Cinq hauteurs de champ, trois hauteurs de bouton en modale
44 (New expense, Trial balance) / 36 (Record payment, en-tête PO) / 34 (**champ PIN manager
du dialogue Void**) / 32 (lignes PO) / 28 (quantité comptée opname). DESIGN.md en déclare
une : 44 px. Les 56 px des boutons sont le défaut de `size` obtenu par omission.

### [P1-2] Le bouton destructeur fait 24×24 px, à 2 px du bouton bénin
`RowActionButton.tsx:28` (`h-6 w-6`), aussi `ProductsTable.tsx:383` et
`CustomerCategoriesPage.tsx:168`. Plancher WCAG 2.5.8 atteint seulement parce que 2 px
comptent à peine comme espacement. Sauvé par la porte suivante (raison ≥10 car. + PIN).

### [P1-3] Deux conventions décimales, quatre formes de date, deux couleurs de lien
`.` est le séparateur de milliers dans `Rp 3.257.500` et le séparateur décimal dans
`-99.90%`, à deux clics d'écart. Six formes de date rendues, `dates.ts:30-34` n'en déclare
que deux. Les 50 liens de Orders rendent `text-info`. 46 liens / 7 groupes dans l'index des
rapports contre 39 / 5 dans le panneau de nav — `/backoffice/reports/perishable-turnover`
n'est atteignable depuis aucun panneau.

## Audit technique — 13/20

| # | Dimension | Note | Constat principal |
|---|---|---|---|
| 1 | Accessibilité | 2 | Menu clavier sans focus visible sur un `Delete` ; 4 contrôles retombent sur l'anneau Chrome à 2,09–2,40:1. |
| 2 | Performance | 4 | Premier chargement ≈ 258 kB gzip ; `charts` et `xlsx` hors chemin critique ; zéro erreur console sur 12 routes. |
| 3 | Responsive | 3 | Aucun débordement à 1280 ni 1024 px ; mais 24×24 px sur les actions de ligne et +57 px latents dans la nav à 1024. |
| 4 | Thème | 3 | Tokens partout, zéro `gray-400` du Preflight ; mais `--surface-2` = `--surface-3` rend une famille d'états morte. |
| 5 | Intégrité d'implémentation | 1 | 5 hauteurs de champ, 2 séparateurs décimaux, 6 formes de date, 2 couleurs de lien, 2 taxonomies de rapports. |

### Détecteur mécanique — silencieux, et son silence ne prouve rien
`detect.mjs --json apps/backoffice/src` → exit 2, 7 findings, tous la même règle
(`design-system-font-size`, *advisory*), tous dans `apps/backoffice/src/index.css`
(lignes 83, 100, 129, 156, 160, 200, 205). **Zéro trouvaille sur tous les `.tsx`.**
Test de mutation : le runner parse bien les `.tsx` (il lève `bounce-easing`) mais rate un
`color:"#999999"` à 2,85:1, une taille hors rampe dans un objet de style TSX, et un lien
« Click here ». La règle de taille ne voit que les fichiers CSS. Aucune des trouvailles de
ce rapport ne vient du détecteur ; toutes viennent de la mesure au navigateur.

### Les 9 gardes CI, et leur angle mort
Toutes vertes. Dette : `tight-corner` 16, `tailwind-dead-classes` 7 (aucune dans le BO),
`gold-fills` 4, `toolbar-button-scope` 3, `hardcoded-theme-colors` 1,
`focus-ring-controls` 0, `lying-font-classes` 0.
Le zéro de `lying-font-classes` est un zéro pour `apps/backoffice/src/` : les 11
occurrences restantes y sont toutes des commentaires, et le vrai reliquat vit dans les
primitifs partagés qui rendent sous le thème BO — `Card.tsx:72` (`font-serif`),
`Dialog.tsx:97`, `Sheet.tsx:116`, `EmptyState.tsx:178` (`font-display italic`). La garde ne
peut pas les voir : le même fichier rend légitimement du serif sous le thème caisse.

### Défauts mesurés supplémentaires
- Contraste texte < 4,5:1 : badge `Paid` 3,96:1 (`#187a52` / `#d6e1da`), badge `Low stock`
  4,41:1 (`#b4342c` / `#e9d9d5`) — les couleurs sémantiques contre leurs propres teintes douces.
- Bordures < 3:1 : bouton `Search / Ctrl+K` 1,59:1 (sur toutes les pages), filtre de statut
  segmenté 1,20:1.
- `span.w-16` clippe `Rp 1,32 jt` sur Daily sales (scrollWidth 72 / clientWidth 64).
- Sauts de niveau de titre systémiques (KPI en `h3` sous `h1`) ; sur `/reports/profit-loss`
  six `h3` précèdent le premier `h2`.
- `aria-modal` absent sur les dialogues Radix inspectés ; `Void` devrait être `alertdialog`.
- Mouvement réduit : pas de tuerie globale `0.01ms` (bon), mais 51 `transition-colors` sans
  `duration-*` échappent à la media query, et 15 `animate-spin` non gardés.
- Français rendu : `163 h 07` (dashboard, `features/dashboard/utils/format.ts:53` l'écrit
  comme spec) ; `(Avoir client)` dans le sélecteur de compte du grand livre.
- Locale : `id-ID` ×63 + ×8 contre `en-US` ×1 + ×2 → virgules décimales et suffixes `rb`/`jt`.
- `"1 templates"` sur Settings.

### Ce qui est bon et doit être préservé
Zéro `<img>` sans `alt`, zéro bouton icône sans nom accessible, zéro `[object Object]` /
`NaN` / `Invalid Date` sur 12 routes, zéro avertissement React, zéro `gray-400` du Preflight
(placeholders à 5,56:1), un seul `<h1>` par page partout, squelettes gardés par
`motion-reduce:animate-none` (8 sites), 13 composants de graphique consommant
`usePrefersReducedMotion`.

## Alertes par persona

- **Manager de boutique** — cible `Void` 24×24 ; `STATUS = PAID` et `PAYMENT = Paid`
  adjacents ; la bande de comparaison du dashboard affiche `—` sur les 7 tuiles alors que
  DESIGN.md dit que la comparaison *est* l'information ; jargon `D-7` / `yest` / `prev`.
- **Comptable** — P0-1 disqualifie Daily sales comme pièce ; `main [title]` renvoie zéro sur
  cette page (aucune valeur exacte) alors que Today en met sur 21 de ses 25 montants, et le
  `title` est de toute façon souris-seulement ; Trial balance ne rappelle pas sa période ;
  pas de `<tfoot>` ; les trois panneaux qui se contredisent sont les trois sans drill-down.
- **Responsable stock/production** — `Submit Production` verrouillé sans dire pourquoi sur le
  bouton (ni `title` ni `aria-describedby`), alors que l'archétype l'exige ; sur l'opname
  l'encre est sur `Add` et `Validate & reveal variances` rend en transparent ; les montants
  `Rp` se tapent dans des `<input type="number">` sans séparateurs.

## Questions ouvertes

1. Daily sales rend `Rp 3,26 jt` sans aucun moyen de voir `Rp 3.257.500` ; Today met la
   valeur exacte en `title`. Quelle page est censée être la pièce ?
2. `SectionLabel` rend mono sur Products et sans-serif sur Settings parce que `DataTable`
   pense à ajouter `font-data` et `SettingsHubPage` non. Combien d'autres règles sont à un
   oubli d'appelant près ?
3. `Edit` bloqué et `Record payment` ouvert sur un PO annulé : décision, ou question jamais
   posée ?
4. La règle d'un seul aplat d'encre passe sur l'opname, où l'encre est sur `Add` et
   l'irréversible `Validate` est transparent. La règle doit-elle porter sur le *compte* ou
   sur la *conséquence* ?
5. `id-ID` avec un chrome anglais : position assumée, ou résidu du helper que chaque auteur
   avait sous la main ? PRODUCT.md et DESIGN.md écrivent `Rp 4,850,000`, une troisième
   convention qui n'apparaît nulle part à l'écran.
