---
name: The Breakery Backoffice
description: Un plan de travail gradué — encre, or de sens et données en mono, pour piloter une boulangerie-café.
colors:
  ink: "#201d19"
  ink-hover: "#2e2925"
  ink-raised: "#3a342c"
  ink-border: "#453e35"
  ink-fg: "#fffdf9"
  ink-fg-muted: "#e8e1d5"
  ink-fg-dim: "#c4bcae"
  ink-fg-sub: "#a09789"
  ink-gold: "#d3ab5c"
  gold: "#7a5c1c"
  gold-hover: "#684d18"
  gold-strong: "#574112"
  gold-soft: "rgba(122, 92, 28, 0.12)"
  paper: "#f0efec"
  sheet: "#ffffff"
  paper-pressed: "#e9e7e2"
  paper-inert: "#fafaf8"
  grid-dot: "#dfddd6"
  border-subtle: "#e3e1db"
  border-strong: "#86827a"
  border-row: "#f3f1ec"
  text-primary: "#1a1917"
  text-secondary: "#55524c"
  text-muted: "#6b6861"
  text-subtle: "#88847c"
  text-inert: "#c2beb5"
  text-disabled: "#b3afa7"
  success: "#187a52"
  danger: "#b4342c"
  warning: "#8a5a10"
  info: "#2b6c9c"
  chart-1: "#2b6c9c"
  chart-2: "#4f93bf"
  chart-3: "#8cc3e0"
  chart-4: "#c9dcea"
typography:
  # La RAMPE du code — `--type-*` dans packages/ui/src/tokens/typography.css.
  # C'est elle qui fait loi ; les rôles ci-dessous s'y rattachent, sauf les deux
  # marqués `offRamp` qui sont écrits en valeurs arbitraires faute de cran.
  scale: [12, 14, 16, 19, 24, 30, 34, 56]
  display:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "26px"
    offRamp: true
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Instrument Sans Variable, Instrument Sans, Inter Variable, system-ui, sans-serif"
    fontSize: "23px"
    offRamp: true
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.14em"
  body:
    fontFamily: "Instrument Sans Variable, Instrument Sans, Inter Variable, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "12px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.14em"
  data:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "tabular-nums"
  brand:
    fontFamily: "Playfair Display, Times New Roman, Georgia, serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1
rounded:
  sm: "3px"
  md: "4px"
  lg: "4px"
  xl: "6px"
  "2xl": "8px"
spacing:
  compact: "12px"
  card: "20px"
  page: "28px"
  section: "48px"
components:
  toolbar-button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-fg}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  toolbar-button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
  toolbar-button-secondary:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "32px"
  toolbar-button-secondary-hover:
    backgroundColor: "{colors.paper-pressed}"
  card:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
  kpi-tile-hero:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-fg}"
    typography: "{typography.display}"
    rounded: "{rounded.lg}"
    padding: "13px 15px"
  input:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "44px"
  # Le second cran de l'échelle des champs — voir § Components / Champs.
  # Barre de filtres, cellule éditable, sélecteur de période.
  input-inline:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "6px 10px"
    height: "36px"
  table-header:
    backgroundColor: "{colors.paper-inert}"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    padding: "10px 14px"
  nav-tab:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.ink-fg-dim}"
    padding: "0 13px"
    height: "52px"
  nav-tab-active:
    textColor: "{colors.ink-fg}"
  nav-panel:
    backgroundColor: "{colors.sheet}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.xl}"
    padding: "18px 20px"
---

# Design System: The Breakery Backoffice

## Overview

**Creative North Star: "The Measuring Instrument"**

Le back-office n'est pas la vitrine de la boulangerie, c'est l'instrument avec
lequel on la mesure. La page se présente comme un plan de travail gradué : un
point de 1 px tous les 22 px sur un papier gris chaud, et rien d'autre en fond —
pas de dégradé, pas de texture, pas d'aplat coloré. Cette graduation n'est pas
un ornement, c'est la déclaration d'intention du système : ici on relève des
valeurs, on ne raconte pas une histoire de croissants.

L'identité tient dans trois matières et une discipline. L'**encre**, presque
noire et légèrement chaude, occupe la barre de navigation, un seul bouton par
écran et une seule tuile de KPI — c'est le poids qui dit ce qui compte. L'**or**,
descendu en version encre pour tenir le contraste sur le papier, ne remplit plus
rien : il souligne l'onglet actif, il porte les liens, il marque les prix. Le
**papier** et la **feuille blanche** portent tout le reste, séparés non par des
ombres mais par des bordures fermes. La discipline, c'est que toute donnée — une
valeur monétaire, un SKU, un horodatage, un libellé de section — rend en
JetBrains Mono tabulaire, tandis qu'Instrument Sans ne porte que la prose de
l'interface. On sait au premier regard ce qui est un fait relevé et ce qui est
une explication.

Ce que le système a délibérément écarté est aussi net que ce qu'il a retenu.
L'ivoire chaud et Playfair Display sur les titres de page ont été retirés le
2026-08-05 : ils étaient le signal « boulangerie artisanale » le plus fort dans
un outil de gestion, et ils faisaient lire la page comme un site vitrine.
Playfair survit à la seule **marque** — le monogramme de la barre de navigation
et la marque du splash de démarrage, qui lisent tous deux `--font-brand`. Les
coins arrondis sont tombés de 12 px à 4 px pour la même raison — la rondeur
lisait « application grand public », la serre lit « instrument ».

**Key Characteristics:**

- Fond gradué à 22 px, le seul relief du système
- Encre comme poids, jamais comme décor : une seule surface encrée par écran
- Or réduit au rôle d'encre de sens — nav active, liens, prix
- Mono pour toute donnée, sans-serif pour toute prose, jamais l'inverse
- Coins serrés (3-4 px), 6 px réservés à ce qui flotte
- Bordure avant ombre : l'ombre n'existe que pour ce qui se détache de la page

## Colors

Une seule famille de teinte traverse le système — l'axe chaud à ~40° — partagée
avec le thème sombre de la caisse. Seule la lumière change d'un thème à l'autre :
même accent, même vocabulaire d'état, même échelle.

### Primary

- **Encre de fer** (`#201d19`) : la barre de navigation sur toute sa largeur, le
  remplissage du bouton qui crée quelque chose, et la tuile de KPI héroïque. Ce
  n'est pas un cran de la rampe de surfaces — c'est un fond sombre dans un thème
  clair, avec sa propre famille de premiers plans (`ink-fg`, `ink-fg-muted`,
  `ink-fg-dim`, `ink-fg-sub`) parce que le contraste s'y inverse.
- **Or d'encre** (`#7a5c1c`) : 6,22:1 sur la feuille blanche, et AA clos sur les
  quatre fonds du thème — papier 5,41:1, en-tête inerte 5,95:1, état pressé
  5,03:1. La valeur a été assombrie le 2026-08-13 : l'ancien `#8a6820` tombait à
  4,47:1 sur le papier de page, sous le seuil. Liens, prix retail,
  liseré de focus, état actif dans les panneaux de navigation. Jamais un
  remplissage de bouton.
- **Or éclairci** (`#d3ab5c`) : la même couleur remontée en luminosité, valable
  uniquement **sur l'encre** — soulignement de l'onglet actif, anneau de focus
  dans la barre. Sur le papier, elle tombe sous le seuil de lecture.

### Neutral

- **Papier de travail** (`#f0efec`) : le fond de page et les panneaux de premier
  niveau, qui partagent délibérément la même valeur. Ils ne se distinguent plus
  par le remplissage mais par la bordure des cartes qui s'y posent.
- **Feuille blanche** (`#ffffff`) : les cartes, les popovers, les panneaux
  flottants.
- **Papier pressé** (`#e9e7e2`) : survol, état pressé, squelettes de chargement.
  Plus *sombre* que la feuille blanche — au-dessus du blanc pur, la seule façon
  de marquer un pas « plus près de l'œil » est d'ajouter de la teinte.
- **Papier inerte** (`#fafaf8`) : en-tête et pied de tableau, champ non éditable.
  Hors rampe : ce n'est pas une distance à l'œil, c'est un fond qui dit « ce bloc
  ne se lit pas ».
- **Bordures** : filet de carte (`#e3e1db`), bordure de contrôle (`#86827a`),
  séparateur de ligne de tableau (`#f3f1ec`).
  La bordure de contrôle est le **seul** trait qui délimite un bouton
  secondaire : elle porte donc le seuil de **3:1 des objets graphiques**
  (WCAG 1.4.11), pas celui du texte. Elle a été assombrie le 2026-08-18 pour
  cette raison — l'ancien `#cdcac2` ne valait que 1,42:1 contre le papier de
  page, et un bouton secondaire y était une limite invisible. `#86827a` clôt le
  seuil sur les quatre fonds du thème : 3,83:1 feuille blanche, 3,33:1 papier,
  3,66:1 en-tête inerte, 3,10:1 état pressé.
  **Le champ borde en `--border-strong` depuis le 2026-08-19** — même arbitrage
  que le bouton secondaire, pris par le propriétaire pour les deux apps : la
  bordure d'un champ est la limite d'un contrôle, elle tient les 3:1 de 1.4.11
  (3,33:1 mesuré sur le papier de page). Réserve honnête : dans le thème sombre
  de la caisse, `--border-strong` (`#413a33` sur `#1f1c18`) vaut 1,52:1 — mieux
  que les 1,13:1 d'avant, toujours sous le seuil. Monter le token du thème
  sombre est un arbitrage POS distinct, non pris à ce jour.
- **Textes** : primaire (`#1a1917`, 17,6:1), secondaire (`#55524c`, 7,8:1), muet
  (`#6b6861`, 5,5:1). Les ratios se mesurent sur le fond le plus clair **et** le
  plus sombre que le token peut avoir sous lui : le muet vit sur la feuille
  blanche, sur le papier de page, sur l'en-tête de tableau et sur l'état pressé,
  où il vaut encore 4,50:1. Un ratio annoncé contre le seul blanc surestime de
  ~0,6 point et laisse passer un token sous AA.
- **Discret** (`#88847c`, 3,72:1) : **non-texte uniquement** — icône, tiret de
  cellule vide, glyphe d'un bouton d'action de ligne. Il tient le seuil des
  objets graphiques (WCAG 1.4.11), pas celui du texte. Un libellé, un
  placeholder, un pourcentage ou une note de bas de tuile prennent le muet : le
  discret ne peut pas valoir 4,5:1 sans devenir indiscernable de lui.
- **Inerte** (`#c2beb5`) : le gris des séparateurs de fil d'Ariane, des chevrons
  éteints et des icônes qui n'appellent aucune action. Il est délibérément plus
  clair que le texte discret et plus soutenu que le désactivé — un chevron de fil
  d'Ariane n'est ni un texte à lire ni un contrôle hors service.

### Data-viz

Une seule rampe, monochrome bleue, en quatre pas du plus soutenu au plus clair :
`#2b6c9c` → `#4f93bf` → `#8cc3e0` → `#c9dcea`. Elle sert les barres, les parts et
les aires. Les douze teintes catégorielles (`cat-*`) restent réservées à
l'identité d'une catégorie de produit, jamais à une série de graphique — sans
quoi la même couleur signifierait « Viennoiserie » ici et « troisième trimestre »
là.

### Named Rules

**The Ink-Not-Gold Rule.** L'or ne remplit jamais une surface dans le
back-office. Il souligne, il colore un texte, il marque un focus. Un bouton doré
appartient à la caisse, pas ici. Test : si vous retirez tous les aplats d'or de
l'écran, rien ne doit disparaître — seul le sens de lecture s'appauvrit.

*Exception — la piste d'interrupteur et le point d'état.* Ces deux-là remplissent
en or à l'état allumé, et c'est le test de la règle elle-même qui les en excuse :
retirez le remplissage d'une piste d'interrupteur et ce n'est pas le sens de
lecture qui s'appauvrit, c'est **l'information d'état qui disparaît**. Le
remplissage n'y est donc pas un décor, c'est le signal — la règle ne le vise pas.
L'exception est **bornée à ces deux objets** : une piste d'interrupteur et un
point d'état. Elle ne s'étend pas aux badges, aux pastilles, aux puces de
sélection ni à « les petits éléments » — tous ceux-là portent leur état par le
liseré et par le texte, où le retrait de l'or laisse la forme intacte. Elle ne
s'obtient pas non plus en repliant sur l'encre : essayée en encre, la piste
posait cinq aplats `#201d19` sur le seul onglet General de la fiche produit, en
plus du bouton du bandeau, ce qui enfreint **The One Ink Fill Rule** (arbitré le
2026-08-18). Contrainte de mesure : le curseur doit tenir 3:1 sur la piste dans
**les deux** états — 6,22:1 sur l'or, 3,83:1 sur la piste éteinte.

*Troisième aplat — la plaque du monogramme, et ce n'est PAS le test de la règle
qui l'excuse.* Le carré de 26 px qui porte le « B » dans la barre de navigation
est rempli en `bg-gold`. Il échoue au test énoncé plus haut : retirez le
remplissage et le monogramme reste lisible, seule la marque perd sa plaque —
c'est donc bien un décor, pas un signal. Il est **maintenu par arbitrage du
propriétaire**, et nommé ici pour qu'on ne le prenne ni pour un oubli ni pour
une extension de l'exception précédente : la liste des aplats d'or du
back-office est *piste d'interrupteur, point d'état, plaque du monogramme*, et
elle ne s'allonge pas d'elle-même (relevé du 2026-08-18).

**The One Ink Fill Rule.** Un seul bloc encré par écran en plus de la barre de
navigation : soit le bouton qui crée, soit la tuile qui répond à la question
qu'on pose en ouvrant la page. Un second détruit la hiérarchie que le premier
installe.

**The Ink Semantics Rule.** Le vert et le rouge du thème sont taillés pour un
fond blanc. Sur l'encre, on utilise `ink-success` / `ink-danger`, les mêmes
teintes remontées en luminosité — et nulle part ailleurs.

## Typography

**Body Font:** Instrument Sans Variable (repli Inter Variable, puis system-ui)
**Data Font:** JetBrains Mono Variable (repli ui-monospace)
**Brand Font:** Playfair Display — **marque uniquement**, et le seul utilitaire
qui la sorte sous ce thème est `font-brand` (`--font-brand`). `font-display` et
`font-serif` **ne rendent pas de serif ici** : le thème remappe `--font-display`
sur la pile du corps, et `--font-serif` n'en est qu'un alias.

**Character:** Instrument Sans a un œil étroit et une allure technique sans
raideur ; il porte tout ce qui s'explique. JetBrains Mono, tabulaire, porte tout
ce qui se mesure. L'interlettrage des capitales mono est poussé à 0,14 em dans ce
thème — à interlettrage égal avec Inter, elles paraissaient tassées contre le
corps.

### Hierarchy

- **Display** (mono, 600, 26 px, `-0.03em`) : la valeur de la tuile héroïque, sur
  encre. Le plus grand texte réellement rendu dans le back-office.
- **Headline** (sans, 600, 23 px, `-0.015em`) : le titre de page, unique `<h1>`
  de la vue, servi par un seul composant partagé.
- **Title** (mono, 600, 12 px, `0.14em`, capitales) : le titre d'une carte de
  dashboard. Un titre de carte est un libellé, pas une phrase.
- **Body** (sans, 400, 16 px, interligne 1,5) : la prose de l'interface,
  descriptions, messages d'état.
- **Label** (mono, 600, 12 px, `0.14em`, capitales) : en-tête de colonne de
  tableau, en-tête de colonne de panneau de navigation, libellé de tuile.
- **Valeur KPI ordinaire** (mono, 600, 23 px, `-0.02em`, tabulaire).

**L'échelle du code fait loi (arbitré le 2026-08-18).** Ce document a longtemps
décrit une rampe relevée sur la planche de référence — {10, 11, 14, 16, 23,
26} px — qui ne partageait que deux valeurs avec celle que les tokens portent
réellement, `--type-*` dans `packages/ui/src/tokens/typography.css` : {12, 14,
16, 19, 24, 30, 34, 56} px. Deux conséquences opposables, à ne pas relire comme
des approximations :

- **Title et Label ne sont pas deux paliers, c'est un seul.** Tous deux rendent
  par `--type-xs`, à 12 px. Un écran ne peut pas s'appuyer sur un contraste de
  taille entre le titre d'une carte et un en-tête de colonne : la distinction
  passe par la graisse, la couleur et la position, jamais par le corps.
- **Display et Headline n'ont pas de token.** 26 px et 23 px sont exacts, mais
  ils sont écrits en valeurs arbitraires — `text-[26px]`, `text-[1.4375rem]` —
  parce qu'aucun cran de la rampe ne les porte. Les reprendre ailleurs se fait
  en recopiant la constante partagée (`KPI_VALUE_HERO`, `PageHeader`), jamais en
  réécrivant le nombre. Ils sont les **deux seuls** rôles hors rampe, et le
  front-matter les marque désormais `offRamp: true` : jusqu'au 2026-08-18 il
  n'énumérait que {12, 14, 16, 23, 26} et faisait donc de ces deux exceptions le
  contrat, pendant que le corps décrivait la rampe. Un `font-size: 19px` de
  `src/index.css` — la cellule de PIN de l'écran de connexion, `--type-lg` — se
  faisait signaler comme un écart alors qu'il est un cran officiel. Le
  front-matter porte maintenant la rampe entière sous `scale`.
- **Le cran de données courant est 19 px, pas 23.** `--type-lg` en mono tabulaire
  porte les montants des tiroirs et des panneaux (`AgingBucketsGrid`,
  `OrderDetailDrawer`, `CostingPanel` — quatorze fichiers) ; c'est lui que le
  front-matter déclare sous `data`. Les 23 px de la valeur de tuile sont, eux,
  le rôle `headline` hors rampe.

La graisse, elle, se lit sur l'appelant et non ici : `SectionLabel` pose 700 par
défaut, les constantes de tuile (`KPI_LABEL`) redescendent à 600. C'est un écart
réel, pas une tolérance.

### Named Rules

**The Mono-Carries-Data Rule.** Tout chiffre qu'on lit pour décider rend en mono
tabulaire. Un montant, un compteur, un pourcentage ou un horodatage en
sans-serif est un défaut, pas une variante.

**The Playfair-Is-Brand-Only Rule.** Playfair Display ne rend que la **marque** :
le monogramme de la barre de navigation et la marque du splash de démarrage. Un
titre de page en serif fait relire la boulangerie au lieu de l'outil — c'est le
geste que la refonte a explicitement défait.

*Ce que la règle exige en pratique, et ce qu'elle n'exige pas.* La règle porte
sur ce qui **rend**, pas sur ce qui est **écrit**. Deux corollaires opposables :

- **Une surface de marque prend `font-brand`, jamais `font-display`.** Jusqu'au
  2026-08-18 le monogramme portait `font-display` et rendait donc en Instrument
  Sans : le seul endroit où Playfair devait survivre était précisément le seul
  qui ne le rendait pas, pendant que ce document, la règle ci-dessus et un
  commentaire de `colors.css` affirmaient l'inverse. `--font-brand` existait,
  mais aucun utilitaire Tailwind ne l'exposait — il a été ajouté au preset ce
  jour-là.
- **Un `font-serif` / `font-display` restant n'est pas une violation de cette
  règle**, puisqu'il ne produit aucun serif sous ce thème ; c'est une classe qui
  nomme le contraire de ce qu'elle fait, et le défaut est là. Le relevé se fait
  par `grep -E '\bfont-(serif|display)\b'` sur `apps/backoffice/src`, commentaires
  et tests exclus — pas de compte gravé ici, il pourrit à chaque édition.

**The Value-Width Rule.** Le corps de la valeur KPI est tendu contre la largeur
de tuile : `Rp 4,850,000` doit tenir sur une ligne. Toute remontée du corps
au-dessus de 34 px sur une tuile de dashboard redonne le même défaut de coupure.

## Layout

Le shell est une barre de navigation de 52 px de haut suivie d'un conteneur
scrollant qui porte le fond gradué ; la largeur entière de la page revient aux
données, sans rail latéral. La navigation tient dans sept onglets de domaine,
chacun ouvrant un panneau déroulant à **largeur variable** — une colonne de
172 px par groupe déclaré, borné à la fenêtre, recalé vers la gauche s'il
déborderait à droite.

Le module est **22 px** : c'est le pas de la grille de fond, la gouttière de
page, l'espacement horizontal de la barre et la gouttière entre colonnes du
panneau. Le reste de l'échelle est en base 4 px, avec quatre paliers sémantiques
— compact (12 px, densité de rush), carte (20 px), page (28 px), section (48 px).

Les grilles de dashboard descendent en marches franches : 2 colonnes en petit
écran, 3 en medium, **4 en extra-large** pour la bande de KPI — donc deux
rangées pour ses sept tuiles. Le chiffre n'est pas un réglage de densité, il est
tenu par **The Value-Width Rule** : à sept colonnes la tuile n'offrait que
134 px de contenu, quand la valeur héro `Rp 8,42 jt` en demande 148,2 px à 26 px
de corps et une valeur ordinaire `-Rp 3,85 jt` 146,8 px à 23 px. Les deux
coupaient. Réduire les corps aurait fait tenir les chaînes en détruisant la
hiérarchie héro/ordinaire — or c'est elle qui porte l'information. À quatre
colonnes la tuile vaut ≈ 297 px pour ≈ 268 px de contenu, et toute la bande
tient sur une ligne chacune (arbitré le 2026-08-18). Deux rangées de tuiles
lisibles valent mieux que sept tuiles qui coupent. Les tableaux ont deux
densités, la compacte resserrant les cellules à 14/10 px pour les écrans de
travail où trois lignes de plus valent mieux que de l'air.

### Named Rules

**The 22px Module Rule.** La grille de fond, la marge de page et les gouttières
du panneau tombent toutes sur le même pas. Un espacement qui ne retombe pas sur
le module se voit contre les points du fond.

**The Archetype-First Rule.** Avant de dessiner une page, on nomme son archétype
parmi les neuf. Si aucun ne convient, c'est presque toujours qu'on a mal nommé le
travail de la page — et si un dixième est réellement nécessaire, il s'ajoute ici
avant d'être dessiné, pas après.

### Page Archetypes

Toute page du back-office est une instance de l'un des **neuf archétypes**
ci-dessous. Ils ont été fixés sur une planche de quinze maquettes ; le reste du
back-office — commandes, clients, fournisseurs, utilisateurs, transferts,
promotions, les autres journaux et chaque panneau de réglages — est une instance,
et se construit depuis l'archétype plutôt que redessiné. Dessiner une seizième
page depuis rien n'achète rien.

**L'ossature commune** précède l'archétype : barre de navigation encre, puis un
conteneur scrollant gradué (padding 20/22 px, gouttière verticale de 13 px)
portant un fil d'Ariane de 12 px, un bandeau de titre — `h1` de 23 px, méta en
ligne à droite du titre, actions alignées à droite en boutons de 32 px — puis le
corps propre à l'archétype.

**1. List** — *ce qui presse d'abord.* Une bande de compteurs qui **sont** les
filtres, une table dense, un pied toujours rendu. Trié par urgence et non par
ordre alphabétique ; la dernière colonne porte l'action de ligne. L'état de liste
— filtre actif, recherche, tri, progression — vit dans l'**URL** : un lien vers
« les six produits sans prix de revient » doit pouvoir se coller dans une
conversation, et le retour arrière depuis une fiche doit rendre la liste qu'on
regardait.

*Pas de sélection multiple ni d'action groupée.* L'archétype les a promises
jusqu'au 2026-08-18 ; aucune instance ne les a jamais tenues, et le catalogue
produits les a retirées avec son motif : elles réclament des RPC de masse gatées
et auditées qui n'existent pas, et une case à cocher qui n'ouvre sur rien promet
une capacité que l'écran n'a pas. Un archétype qui décrit une capacité
inexistante fabrique de la fausse dette à chaque nouvelle instance. Elles
reviendront ici avec les RPC, pas avant.

**L'axe de variation : le régime de récupération.** Il ne fait pas deux
archétypes — l'ossature, la bande, la table et le pied sont les mêmes — mais il
décide du pied et du lieu du filtrage. Une instance nomme son régime avant d'être
dessinée.

| | **Borné** — chargé en entier | **Non borné** — fenêtré |
|---|---|---|
| Filtre, recherche, tri | en mémoire | **serveur** |
| Progression | pagination numérotée | curseur, « Load more » |
| Fenêtre temporelle | aucune | oui, quand le flux la porte |
| Compteurs | dérivés des lignes reçues | **comptés serveur** |
| Pied | « 1–15 of 373 » | *chargé* contre *existant* |
| Instances | Products, Customers | Orders, B2B orders |

Le critère n'est pas la taille du jour, c'est la **borne**. Un catalogue est borné
par le travail de celui qui le tient ; un registre de commandes croît tant que le
commerce tourne. « Page 7 » d'un flux qui bouge n'est pas une adresse stable, et
un pied qui compte les lignes reçues en les présentant comme le tout ment en
silence dès que le plafond de lecture est atteint.
*Instances : Stock alerts, B2B orders, Products.*

**2. Report** — *une question, une réponse, ses ventilations.* Contrôle de
période dans le bandeau, bande de KPI avec leurs deux comparaisons, **un seul**
graphique, puis N ventilations en part + valeur. L'assertion qui compte est le
titre, jamais une note de bas de page.
*Instances : Daily sales, Trial balance.*

**3. Document** — *un objet identifié, son argent à droite.* Deux colonnes : le
corps du document à gauche (paires libellé/valeur, puis la table de ses lignes),
un rail de synthèse à droite (totaux, paiement, frise d'états, notes). Plusieurs
statuts **indépendants** cohabitent dans l'en-tête quand la réalité les sépare —
une commande peut être payée sans être reçue. La frise montre les étapes à venir
en creux.
*Instance : Purchase order.*

**4. Form** — *la conséquence avant l'engagement.* Saisie à gauche, conséquence à
droite : totaux calculés, chaîne d'approbation qui s'appliquera, historique
comparable. Les champs dérivés sont en lecture seule et se disent tels. Le statut
du brouillon vit dans l'en-tête.
*Instance : New expense.*

**5. Hub** — *vingt surfaces lues sans en ouvrir une.* Grille de tuiles groupées
par famille, chaque groupe comptant ses surfaces. **Chaque tuile porte sa valeur
courante sous son libellé** — c'est ce qui distingue un hub d'un menu.
*Instance : Settings.*

**6. Bulk entry** — *une table qu'on remplit, pas qu'on lit.* Une seule colonne
éditable ; le dérivé se recalcule à la frappe ; l'action terminale reste
verrouillée tant qu'une ligne est vide **et dit pourquoi**. Deux paliers quand
l'écriture est irréversible — valider, puis poster — avec un encart qui décrit
l'irréversibilité juste avant le bouton.
*Instance : Stock count (opname).*

**7. Matrix** — *seul le motif de différence se lit.* Lignes décrites, colonnes
courtes, cellules réduites à un signe. La légende est obligatoire et nomme
**exactement les états que la grille calcule** — en annoncer un qu'elle ne
calcule pas (un « hérité » qu'aucune donnée ne porte) est un mensonge
d'interface. Lecture seule assumée, avec le renvoi explicite vers l'endroit où
l'on édite, et la réserve dite quand une source de vérité n'est pas reflétée
(les dérogations par personne).

*Pas de filtre « différences seulement ».* L'archétype l'a exigé jusqu'au
2026-08-19 ; mesuré en base ce jour-là, 143 permissions sur 151 sont
discriminantes — le filtre aurait masqué 8 lignes, un contrôle de premier plan
pour rien. Même motif que la sélection multiple retirée de List : un archétype
qui exige un contrôle que les données ne justifient pas fabrique de la fausse
dette à chaque instance. Il reviendra si la grille devient majoritairement
uniforme, pas avant.
*Instance : Roles & permissions.*

**8. Cascade** — *l'arbre aplati, les enfants somment au parent.* Profondeur
bornée et annoncée ; les enfants sont indentés sous leur sous-total et leur somme
l'égale ; une colonne de part nomme ce qui pèse. Un encart final nomme le
matériau dominant et son mouvement.
*Instance : Recipe.*

**9. Append-only log** — *un seul endroit où l'on écrit.* Le panneau de saisie
est la **seule surface encrée** de la page et annonce ce que l'enregistrement va
produire avant de le produire. Tout ce qui est en dessous porte `LOCKED` : déjà
en stock, corrigeable par contre-écriture seulement. Journal en ordre
antichronologique.
*Instance : Production log.*

**Hors shell.** Une page qui précède l'authentification n'a pas de barre de
navigation et n'est donc l'instance de rien : elle se partage en deux moitiés —
l'encre porte la marque et l'état du jour, la lumière porte le geste.

*La marque qu'elle porte est celle de l'enseigne, pas celle de l'instrument.*
Le login rend le logo complet — croissant illustré et « FAIT MAISON — FRENCH
BAKERY » —, c'est-à-dire le signal que le chrome interdit. Il échoue au test de
la règle : retirez-le, le geste de connexion reste entier. Il est **maintenu
par arbitrage du propriétaire** (2026-08-19), au même titre que la plaque or du
monogramme : avant l'authentification on entre dans la boulangerie, après on
prend l'instrument. L'exception est bornée à cette seule page ; le premier
écran authentifié reprend le monogramme sobre, et le contraste entre les deux
est assumé, pas un oubli.
*Instance : Login.*

## Elevation & Depth

Le système est **plat par défaut**. La profondeur se lit à la bordure et à la
valeur de surface, pas à l'ombre. Les cartes du dashboard sont explicitement
sans ombre ; ce qui les détache du papier, c'est leur blanc et leur filet. Les
ombres n'apparaissent que pour ce qui **flotte au-dessus de la page** : panneau
de navigation déroulant, menu utilisateur, modales.

Toutes les ombres sont réchauffées sur `rgba(45, 34, 15, ·)` — une base neutre
froide tirerait vers le bleu-gris et trahirait l'axe de teinte du système.

### Shadow Vocabulary

- **Filet** (`0 1px 2px rgba(45,34,15,0.07)`) : élément posé, à peine décollé.
- **Carte** (`0 2px 8px rgba(45,34,15,0.09)`) : carte en état survolé.
- **Flottant** (`0 18px 40px rgba(28,23,18,0.20)`) : panneau de navigation, menu.
- **Modale** (`0 20px 56px rgba(45,34,15,0.22)`) : dialogues.
- **Focus** (`0 0 0 3px color-mix(in srgb, var(--gold-base) 32%, transparent)`) :
  halo, dérivé de l'accent — le liseré et le halo sont toujours de la même
  couleur. La valeur est **calculée depuis le token, jamais recopiée** : c'est ce
  qui rend la règle tenable. Elle avait divergé deux fois d'un rgb figé, la
  seconde au moment de l'assombrissement de l'or du 2026-08-13 ; la forme dérivée
  ferme la classe de défaut au lieu de la corriger une fois de plus (2026-08-18).
  Un moteur sans `color-mix` perd le halo, pas l'anneau : les 2 px de focus sont
  portés par `outline`.

### Named Rules

**The Border-Before-Shadow Rule.** Si deux surfaces doivent se distinguer et
qu'elles sont toutes deux posées sur la page, on les sépare par une bordure. On
ne dépense une ombre que lorsqu'un élément quitte réellement le plan.

## Shapes

Coins **serrés**, sans exception cosmétique : 3 px pour les contrôles, boutons,
badges et cases à cocher ; 4 px pour les tuiles **et** les cartes — la direction
ne distingue plus les deux. Seules les surfaces qui flottent montent d'un cran, à
6 px, pour se détacher du fond.

Aucun élément entièrement circulaire hors pastille d'avatar et point d'état. Pas
de biseau, pas de contour décoratif, pas de forme portée par une image de fond.

### Named Rules

**The Tight-Corner Rule.** Au-delà de 6 px, un rayon dans le back-office est une
erreur. La rondeur appartient à la caisse, dont les cibles tactiles font 44 px et
plus.

## Components

### Boutons

Deux familles coexistent, et c'est délibéré — mais la frontière doit être tenue.

- **Bouton de bandeau de page** (`TOOLBAR_BTN_*`) : hauteur 32 px, rayon 3 px,
  14 px (`--type-sm`) en graisse 500. Le primaire est **encre** sur `#201d19`, un seul par
  bandeau, celui qui crée. Le secondaire est une feuille blanche bordée de
  `#86827a` qui vire au papier pressé au survol. L'icône d'un bouton secondaire
  est grise : elle ne concurrence pas le libellé.
  **Ces chaînes appartiennent au bandeau de page, et à lui seul.** Une action de
  panneau, de carte, de modale ou de formulaire prend le primitif partagé. La
  frontière a été franchie une fois dans les deux sens — des boutons de panneau
  en `TOOLBAR_BTN_*`, un bouton de bandeau en primitif — et les deux fois le
  résultat a été deux hauteurs de bouton sur le même écran (2026-08-18).
- **Bouton primitif partagé** (`@breakery/ui`) : rayon 4 px. C'est le bouton des
  modales, des formulaires, des panneaux et des pieds de table — tout ce qui
  n'est pas le bandeau de page. Son variant `primary` est **vert** — couleur
  réservée au chemin de l'argent — et son variant `gold` remplit en or. Les
  capitales interlettrées ne sont **pas** portées par le primitif : elles
  appartiennent aux trois variants `primary`, `gold` et `outlineGold`. Les six
  autres (`ink`, `secondary`, `ghost`, `ghostDestructive`, `link`) rendent en
  casse de phrase — c'est ce que le back-office emploie.
  **Quatre crans de hauteur, pas un** — ce document annonçait « 56 px » comme
  s'il n'y en avait qu'un. Relevé du 2026-08-18, parseur équilibrant les
  accolades (un `>` de `() =>` ne ferme pas une balise) :
  - `sm` — **36 px** (`h-9`). **113 emplois** dans 60 fichiers : les paires
    d'action des modales, et le « Load more » de tout pied de table.
  - `md` — **56 px** (`--touch-comfy`), le **défaut du primitif**. 2 emplois
    explicites, mais **180 implicites** dans 87 fichiers — un `<Button>` écrit
    sans `size` rend 56 px.
  - `lg` — 80 px : 1 emploi. `icon` — 56 × 56 : aucun.

  Autrement dit le back-office n'a pas un cran dominant mais **deux populations
  comparables**, 113 contre 182, et la plus grosse est obtenue par omission. Ce
  n'est pas un choix, c'est un défaut de primitif — le même que
  `defaultVariants: { variant: 'primary' }` déjà nommé plus bas : la conformité
  s'obtient par un opt-out que chaque auteur doit connaître.

  **Le secondaire est bordé `border-strong`, jamais `border-subtle`.** Son
  remplissage (`--bg-overlay`) vaut exactement la feuille blanche qui le porte :
  son trait est le seul objet qui le délimite, il tient donc les 3:1 de WCAG
  1.4.11 (3,827:1). Le `border-subtle` qu'il a porté un temps valait 1,308:1 — le
  bouton n'avait plus de limite visible (corrigé le 2026-08-18).
  **Et il vire au papier pressé au survol**, comme la chaîne de bandeau : son
  survol visait `--bg-input`, qui vaut lui aussi `#ffffff` sous ce thème — repos
  et survol étaient à 1,000:1, ΔL 0, le bouton ne réagissait pas à la souris.
  `--surface-4` donne 1,236:1, ΔL 0,20034 (corrigé le 2026-08-18, le même jour
  que le trait ; les deux vivaient sur la même déclaration).
- **Désactivé** : les variants remplis neutralisent leur couleur au lieu de la
  faner. Un vert ou un or à 50 % d'opacité lit encore comme un bouton vivant.
  **La chaîne de bandeau suit la même règle** depuis le 2026-08-18 : elle fanait
  à `opacity-50`, ce qui rendait l'aplat encre en un gris où le libellé ivoire
  tombait à 2,04:1. Elle neutralise désormais sur `--surface-4` / `--text-muted`,
  exactement comme le primitif.
- **Focus** : contour de 2 px décalé de 2 px, couleur `gold` sur le papier,
  `ink-gold` sur l'encre.

### Cartes

- **Coins** : 4 px. **Fond** : feuille blanche. **Bordure** : `#e3e1db`.
- **Ombre** : aucune sur un dashboard ; `shadow-sm` en usage général.
- **Padding interne** : 16 px sur les cartes de dashboard, 20 px (gouttière de
  carte) ailleurs.
- Une carte de dashboard porte quatre états qui ne sont pas cosmétiques :
  chargement (squelettes en papier pressé), **restreint** (cadenas et phrase
  explicite quand le rôle n'a pas le droit), erreur, contenu. La page dégrade
  carte par carte — un rôle sans droit trésorerie perd une carte, pas son
  dashboard.

### Champs

**DEUX hauteurs, et deux seulement** — arbitrage du 2026-08-21, après une mesure
qui en a relevé cinq à l'écran (44 / 36 / 34 / 32 / 28) quand cette section n'en
déclarait qu'une. Le cran se lit sur le RÔLE du champ, jamais sur la place
disponible :

| Hauteur | Classe | Rôle |
|---|---|---|
| **44 px** | `h-touch-min` | Champ de **formulaire** — dialogue, page de saisie. C'est aussi la hauteur des primitifs `Input` et `Select` de `@breakery/ui`, qui n'ont donc jamais à être surchargés dans ce rôle. |
| **36 px** | `h-9` | Champ **en ligne** — barre de filtres, cellule éditable de tableau, sélecteur de période. Le back-office est un outil de session longue sur ordinateur : imposer 44 px à une barre de dix filtres coûte une ligne de tableau à chaque écran. |

Les 34 px et 28 px relevés n'étaient pas un troisième cran : c'étaient des
hauteurs OBTENUES — un `p-2` sans hauteur déclarée, un champ de saisie d'opname
comprimé. Une hauteur qui tombe d'un calcul de remplissage n'est pas une
décision, et elle ne se reproduit jamais deux fois pareil.

- Rayon 4 px, **bordure de contrôle `#86827a`**, fond feuille blanche.
- **Focus** : contour or de 2 px décalé de 2 px, halo de la même teinte.
- **Désactivé** : curseur interdit et opacité réduite.

### Tableaux

- En-tête et pied sur papier inerte (`#fafaf8`), libellés en label mono capitales.
- Lignes séparées par un filet `#f3f1ec`, zébrures optionnelles sur le papier.
- Colonnes numériques alignées à droite en chiffres tabulaires.
- Tri : chevron neutre discret au repos, chevron or dans la direction active,
  `aria-sort` porté par la cellule d'en-tête.
- Le pied se rend **même quand la table est vide** : « 0 sur 318 » est une
  information, pas un vide.

### Navigation

- Barre de 52 px, fond encre, **fermée en bas par un filet or**. Sans ce filet,
  l'encre et le papier se touchent à cru et la barre paraît posée sur la page au
  lieu d'en être le bord.
- Onglet actif et onglet ouvert sont **deux états distincts qui se cumulent** :
  soulignement or interne de 2 px pour « vous êtes ici », fond relevé pour « ce
  menu est déployé ».
- Panneau déroulant : feuille blanche, coins bas à 6 px, colonnes coiffées d'un
  label mono, liens en 14 px (`--type-sm`) qui virent à l'or au survol et à
  l'état actif.
- Comportement de menubar : clic pour ouvrir, survol pour basculer une fois la
  barre ouverte, ←/→ entre onglets, ↓ pour entrer dans le panneau, Échap pour
  fermer et rendre le focus à l'onglet.

### Tuile de KPI (composant signature)

Sans icône — six pastilles d'icône côte à côte donnaient une frise décorative où
l'œil ne trouvait plus le chiffre. La place gagnée sert aux **comparaisons**, qui
portent l'information : « 8,42 jt » ne dit rien, « 8,42 jt ▲12,4 % » dit tout.
La première tuile de la bande est remplie d'encre et sa valeur monte à 26 px.
Quand une mesure porte une réserve (marge calculée au coût courant, trésorerie
dont le découpage est dérivé), la réserve s'affiche à côté de la valeur — taire
une réserve fait passer une estimation pour un relevé.

## Do's and Don'ts

### Do:

- **Do** faire rendre toute donnée chiffrée en JetBrains Mono tabulaire, y
  compris dans une cellule de tableau et dans une note de bas de tuile.
- **Do** séparer deux surfaces posées sur la page par une bordure, et réserver
  l'ombre à ce qui flotte au-dessus d'elle.
- **Do** faire tomber les espacements de page sur le module de 22 px, qui est
  aussi le pas de la grille de fond.
- **Do** passer par `PageHeader` pour tout titre de page et par les chaînes
  `TOOLBAR_BTN_*` pour ses actions : ce sont les sources uniques du bandeau.
- **Do** utiliser le papier pressé (`#e9e7e2`) pour les squelettes de chargement
  posés sur une carte blanche — un squelette en blanc y est invisible.
- **Do** afficher la réserve d'une mesure à côté de la mesure, pas dans une note
  de bas de page.
- **Do** faire dégrader une page carte par carte quand une permission manque, en
  disant « restricted » plutôt qu'en affichant une erreur rouge.
- **Do** nommer l'archétype d'une page avant de la dessiner, et en reprendre les
  invariants plutôt que réinventer sa structure.
- **Do** annoncer ce qu'une écriture irréversible va produire **avant** le bouton
  qui la produit, et verrouiller ce bouton tant que la saisie est incomplète en
  disant ce qui manque.

### Don't:

- **Don't** remplir quoi que ce soit en or. L'or est une encre de sens : nav
  active, lien, prix, focus.
- **Don't** poser une seconde surface encrée sur un écran qui en a déjà une.
- **Don't** utiliser Playfair Display ailleurs que sur le monogramme de marque.
- **Don't** monter un rayon au-dessus de 6 px, ni descendre les contrôles
  au-dessous de 3 px.
- **Don't** employer le vert ou le rouge du thème sur un fond encre : ils y
  tombent sous le seuil de lecture. Utiliser `ink-success` / `ink-danger`.
- **Don't** réintroduire l'ivoire chaud ni aucun signal de boulangerie
  artisanale dans le chrome — c'est l'anti-référence explicite du système.
  *Une seule surface y échappe, par arbitrage : la page de connexion
  (cf. § Hors shell).*
- **Don't** écrire une couleur en dur dans un composant. Toute la direction est
  scopée au thème pour rester commutable ; une valeur en dur dans un composant la
  fige.
- **Don't** employer une teinte catégorielle (`cat-*`) comme couleur de série
  dans un graphique : elle est réservée à l'identité d'une catégorie de produit.
  Les séries prennent la rampe `chart-1..4`.
- **Don't** offrir de modifier une écriture déjà enregistrée dans un journal.
  L'affordance est la contre-écriture ; un bouton « Éditer » sur une ligne
  verrouillée est un défaut de conception, pas un manque de fonctionnalité.

---

**État de propagation (relevé du 2026-08-18).** Ce document décrit la direction
telle qu'elle est **décidée** et telle que les tokens la portent. Les écarts
restants sont nommés ici pour qu'on ne prenne pas une règle pour un constat.

Les trois dettes déclarées au relevé précédent (2026-08-07) ont été mesurées à
nouveau et sont **soldées ou très largement résorbées**. On les nomme parce
qu'un chiffre périmé dans un document de direction est plus nuisible qu'un
chiffre absent :

- **Le bouton de bandeau encre est la norme, pas l'exception.** Les chaînes
  `TOOLBAR_BTN_*` sont employées dans quarante-quatre fichiers du back-office, et
  le bouton vert du primitif partagé n'a **aucun appelant explicite** —
  `variant="primary"` ne se rencontre nulle part. Le relevé du 2026-08-07 annonçait
  l'inverse (« deux écrans conformes, environ soixante en retard ») ; il est faux.
  L'écart qui subsiste est d'une autre nature : `Button` porte encore
  `defaultVariants: { variant: 'primary' }`, donc un `<Button>` écrit **sans prop**
  rendrait vert et en capitales. **Aucune surface d'interface n'est dans ce cas
  aujourd'hui** (relevé du 2026-08-18, parseur équilibrant les accolades) : le seul
  `<Button>` sans variant du back-office vit dans une fixture de test. Le risque est
  donc entièrement devant nous, porté par le défaut du primitif, pas derrière.
- **Playfair Display ne rend nulle part hors de la marque, mais des classes qui
  prétendent l'appeler subsistent.** Le relevé de 2026-08-07 en annonçait
  quatre-vingt-dix ; il en reste quelques dizaines de `font-serif` /
  `font-display`, et **aucune ne produit de serif** : sous ce thème
  `--font-display` est remappé sur la pile du corps. Elles nomment le contraire
  de ce qu'elles font, ce qui est le vrai défaut — un auteur qui les lit croit
  la règle enfreinte, un auteur qui les recopie propage un mensonge. Aucun compte
  n'est gravé ici : il serait faux au commit suivant, et
  `grep -E '\bfont-(serif|display)\b' apps/backoffice/src` le rend à jour. La
  cible est zéro. **Ce que ce paragraphe annonçait comme la cible — « la règle du
  monogramme unique » — était par ailleurs faux du côté du code jusqu'au
  2026-08-18** : le monogramme lui-même portait `font-display` et ne rendait donc
  pas Playfair (corrigé par `font-brand`, cf. § Typography).
- **Les deux tokens annoncés manquants existent.** Le gris inerte est
  `--text-inert` (`#c2beb5`) et la rampe de data-viz est `--chart-1..4`
  (`#2b6c9c` → `#c9dcea`), tous deux dans `packages/ui/src/tokens/colors.css` et
  exposés par le preset Tailwind. Le reliquat annoncé ici — `chartColors.ts` qui
  redéclarait ces mêmes valeurs en dur au lieu de consommer les tokens — est
  **soldé** (vérifié le 2026-08-18) : le fichier lit les `var()`, et plus une seule
  de ses valeurs ne double un token. Ce qu'il porte encore est d'une autre
  nature : deux rampes analytiques locales et une série catégorielle, arbitrées
  en tête de fichier et sans équivalent dans les tokens. La réserve qui reste
  n'est donc pas un doublon mais un contraste — cinq de leurs crans passent sous
  le plancher de 3:1, et ne se lisent que parce que chaque graphe porte des
  étiquettes directes et sa table. Rien ne surveille cette condition.

**Écarts ouverts, relevés le 2026-08-18.** Ceux-là sont des constats, pas des
règles :

- **Les primitives partagées portent le contraire de trois règles de ce
  document.** `Card` rend `shadow-sm` par défaut, à rebours de
  **Border-Before-Shadow** ; `Button` rend vert par défaut, à rebours de la
  doctrine encre ; les quatre paliers d'espacement sémantique exposés par le
  preset n'ont aucun appelant dans le back-office. Conséquence structurelle : la
  conformité s'obtient par un opt-out que chaque auteur doit connaître, donc un
  fichier neuf naît non conforme en silence.
  **Le défaut de `size` produit déjà le dégât que celui de `variant` menace
  seulement.** `defaultVariants: { size: 'md' }` vaut 56 px : 180 `<Button>` du
  back-office, dans 87 fichiers, rendent ce cran sans l'avoir demandé, contre 112
  qui demandent `sm` (relevé du 2026-08-18). Le risque n'est pas devant nous
  ici — il est réalisé. Changer le défaut est un arbitrage qui touche la caisse,
  il n'est pas pris dans ce relevé.
- **Les six classes `bg-warn` / `text-warn` qui ne peignaient rien sont
  résorbées** (le 2026-08-18 ; `grep -E '(bg|text|border)-warn([^i]|$)'` sur
  `apps/` et `packages/` rend zéro). L'angle mort qui les avait laissées passer,
  lui, reste ouvert et n'est *pas* un défaut résolu : `tailwind-dead-classes.mjs`
  sait détecter une clé morte d'une famille connue, pas une famille inventée. Il
  n'en ferme que le cas nommé — une liste noire du vocabulaire shadcn/ui.
- **La violation de The Value-Width Rule annoncée sur une tuile de la liste B2B
  n'existe pas.** Cette entrée affirmait qu'à 1280 px, la largeur cible du
  produit, une valeur monétaire de dix caractères rendait sur deux lignes.
  Repris au navigateur le 2026-08-18, sur le nœud réel : **infirmé.** La bande
  de tuiles est un `flex` sans retour à la ligne et la tuile n'a pas de largeur
  fixe ; cinq chaînes de dix à treize caractères injectées tour à tour
  l'élargissent jusqu'à environ 209 px et rendent toutes **sur une ligne**, sans
  induire de débordement de page. Les deux autres tuiles monétaires du domaine
  B2B tiennent aussi.
  Ce qui reste vrai est plus étroit, et ce n'est pas ce qui était écrit : la
  valeur ne porte pas `whitespace-nowrap`, donc la coupure redevient possible si
  la bande se remplit assez pour forcer la contraction. C'est un risque
  conditionnel, pas un défaut constaté. La leçon de méthode vaut le constat : une
  largeur de contenu comparée à une largeur de tuile **supposée fixe** ne dit
  rien d'une tuile qui s'élargit, et cette entrée a fait passer un calcul pour
  une mesure.
- **Le champ n'avait pas de limite qui tienne 1.4.11 — soldé le 2026-08-19.**
  `Input` et `selectClassName` bordent en `--border-strong` (arbitrage du
  propriétaire, les deux apps). Ce qui reste ouvert est plus étroit : le thème
  sombre de la caisse plafonne à 1,52:1 (arbitrage POS non pris), et les
  contrôles stylés à la main hors primitif se corrigent appelant par appelant.
  Le seul nommé ici, le champ « Receipt file » de la saisie de dépense à 1,08:1,
  est **soldé le 2026-08-21** : son bouton a pris la géométrie de contrôle du
  système (feuille blanche, `border-strong`, rayon 4 px), ce qui a réglé du même
  geste l'aplat d'or qu'il portait.
- **`--border-gold` n'est PAS une limite de contrôle** (mesuré le 2026-08-21).
  Sous `.theme-backoffice` il vaut `rgba(122, 92, 28, 0.35)`, soit **1,64:1** sur
  le papier de page — très en dessous des 3:1 que WCAG 1.4.11 exige d'un objet
  graphique. Le token qui tient est **`border-gold`** (`--gold-base` `#7a5c1c`,
  6,22:1 sur la feuille blanche, 5,41:1 sur le papier). La conséquence est
  opposable : **retirer un aplat d'or d'un encart bordé `border-border-gold` sans
  monter son liseré le laisse SANS limite visible.** Cinq encarts étaient dans ce
  cas au moment du retrait des aplats.
- **Une classe de défaut qui n'avait pas de nom : `tabular-nums` sans famille.**
  L'auteur a le bon réflexe — les chiffres tabulaires — et oublie
  `font-data`. Le montant rend alors en Instrument Sans, ce que
  **The Mono-Carries-Data Rule** interdit. Le piège est le relevé, pas le
  correctif : un `grep` de `tabular-nums` sans `font-data` rend des **centaines**
  de lignes, parce que la famille peut venir d'un parent. C'est un majorant
  inutilisable. **Seul le rendu tranche** — mesuré au navigateur le 2026-08-21,
  la population réelle valait une poignée de nœuds, presque tous sur le rail
  d'argent du bon de commande.
- **Les champs écrits à la main hors du primitif `Input` n'ont pas d'anneau de
  focus conforme — et ils étaient cinq fois plus nombreux que ce paragraphe ne
  l'annonçait.** Le relevé porté ici jusqu'au 2026-08-18 disait « trente-cinq
  champs, quinze fichiers ». Ce chiffre est **exact pour la signature de classe
  qu'il énonce** — `bg-bg-base` + `border border-border-subtle` + `rounded` — et
  reproductible au champ près ; il n'a jamais été un compte de population. Deux
  mesures indépendantes du 2026-08-18, parseurs équilibrant les accolades et
  résolvant les constantes locales, rendent **cent-soixante-dix-huit à
  cent-quatre-vingt-six contrôles dans quatre-vingt-un à quatre-vingt-dix
  fichiers** : il existait un **second dialecte**, `h-9 … bg-bg-input` en 36 px,
  qu'aucune recherche sur la première signature ne pouvait voir. Les deux plus
  gros formulaires du produit — le brouillon de bon de commande et la fiche
  fournisseur — n'étaient dans aucune des deux listes citées.
  Deux conséquences mesurées **au navigateur** : ces contrôles ne sont pas sans
  anneau, ils retombent sur celui du navigateur, `auto 1px` à **2,398:1** sur la
  feuille blanche, sous les 3:1 des objets graphiques (WCAG 1.4.11 / 2.4.11) ; et
  leur placeholder, non tokenisé, prend le `gray-400` du Preflight, à **2,208:1**
  sur le papier de page (WCAG 1.4.3). Les trois ratios annoncés par ce document
  sont, eux, exacts au millième.
  **Forme cible**, celle déjà posée sur les champs du chantier combos :
  `… bg-bg-base border border-border-subtle rounded placeholder:text-text-muted
  ${FOCUS_RING}`, ou le primitif `Input` quand la géométrie s'y prête ; une
  constante de classe se corrige à la source plutôt qu'à chacun de ses appels.
  Ce n'est pas un arbitrage, c'est du travail mécanique, et il est en cours de
  livraison (PR #415, ouverte le 2026-08-18).
  **La leçon de relevé survit au chantier**, elle : un compte obtenu en filtrant
  sur une signature de classe mesure cette signature, jamais la population. Gravé
  dans un document de direction, il fait lire un chantier à 80 % quand il est à
  20 %. Un relevé se cadre sur ce qu'on cherche — ici la balise et l'absence
  d'anneau — pas sur la forme du premier exemple rencontré.

- **`EmptyState` enfreint deux règles de ce document, et aucun relevé ne l'avait
  vu** (2026-08-18). Le primitif partagé rend son titre en `font-display italic` :
  sous ce thème `--font-display` est remappé sur la pile du corps, donc il ne
  produit pas de serif — mais **l'italique, lui, rend**, et ce n'est aucun des
  six rôles que § Typography déclare. Et son action-objet rend
  `<Button variant="gold">`, c'est-à-dire un **aplat d'or en capitales
  interlettrées**, que **The Ink-Not-Gold Rule** interdit et qui n'est aucune des
  trois exceptions nommées. Ce n'est pas un risque théorique : un appelant
  l'atteint aujourd'hui, l'état vide de l'index des rapports — et l'état vide est
  le premier écran que voit un utilisateur d'un module neuf.
  **À moitié soldé le 2026-08-21.** Le primitif a reçu une prop optionnelle pour
  le variant de son action, **à défaut inchangé** — donc le rendu de la caisse
  est prouvablement intact — et le seul appelant back-office qui rend une action
  passe désormais `ink` : **l'aplat d'or n'est plus atteignable depuis le
  back-office**. Ce qui reste ouvert est double et demande un arbitrage : le
  **défaut** du primitif est toujours `gold`, donc un appelant neuf naît non
  conforme en silence ; et **l'italique du titre n'a pas bougé**, parce qu'il
  touche trente-six surfaces du back-office ET le rendu du POS, où
  `font-display` sort vraiment Playfair. Même motif que `Card`, `Dialog` et
  `Sheet`, qui portent la même classe — `Dialog` atteignant à lui seul
  soixante-et-un fichiers du back-office, c'est le plus gros gain non pris.
  **L'angle mort de méthode est le même que celui des champs sans anneau** : le
  relevé du même jour concluait que le risque du défaut de variant était
  « entièrement devant nous » parce qu'il cherchait `variant="primary"`. Il ne
  cherchait pas `gold`. Chercher la valeur qu'on redoute ne dit rien des autres
  valeurs de la même prop.

**État du corpus.** La planche de référence couvre quinze écrans pour neuf
archétypes. **« Construit » veut dire refait depuis l'archétype, pas « la page
existe »** : la plupart des quinze ont une page en production depuis longtemps,
et lire cette liste comme un inventaire de routes manquantes la fait dire le
contraire de ce qu'elle dit. Le test est l'invariant propre à l'archétype, pas
la présence du fichier.

Six sont construits — Today (shell + landing), Products (List), B2B orders
(List), **Settings (Hub)**, **Production log (Append-only log)** et
**New expense (Form)**. Settings était rangé parmi les non-implémentés jusqu'au
2026-08-18 ; il l'est, et il tient l'invariant qui distingue un hub d'un menu :
chaque tuile porte sa valeur courante sous son libellé, avec un tiret honnête
quand la section est vide et le lien laissé intact.

**Les deux derniers sont passés « construits » le 2026-08-21**, et chacun tenait
zéro invariant avant :

- **Production log.** Le panneau de saisie est devenu la seule surface encrée de
  la page ; les lignes du journal portent `LOCKED` et disent l'issue ; la
  contre-écriture est atteignable. Elle ne l'était pas : la RPC existait, le
  dialogue existait, les messages de blocage étaient écrits, et le seul composant
  qui les montait **n'avait aucun importeur**. Un fichier peut être construit,
  testé, et ne rendre à personne — le test de l'archétype est bien l'invariant,
  pas la présence du fichier.
- **New expense.** L'écran demandait un engagement sans montrer ce qu'il
  déclenche, alors que les paliers d'approbation existent et sont configurés. Il
  a gagné sa colonne de conséquence : total dérivé en lecture seule, prévision de
  chaîne d'approbation résolue à la frappe, historique comparable, statut de
  brouillon dans le bandeau. Le rail **prévoit** et le dit — la résolution finale
  reste au serveur (Product Principle 1).

Les neuf autres sont dessinés et validés, non refaits depuis leur archétype :
Stock alerts (List), Daily sales et Trial balance (Report), Purchase order
(Document), Stock count (Bulk entry), Roles & permissions (Matrix), Recipe
(Cascade), Z-reports (List) et Login (hors shell).

**Recipe reste le plus loin de son archétype** : il annonce une cascade et rend
une table plate — aucune indentation, aucun sous-total de parent, aucun encart
nommant le matériau dominant.
