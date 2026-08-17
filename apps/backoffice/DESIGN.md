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
  gold-hover: "#745719"
  gold-strong: "#5e4614"
  gold-soft: "rgba(138, 104, 32, 0.12)"
  paper: "#f0efec"
  sheet: "#ffffff"
  paper-pressed: "#e9e7e2"
  paper-inert: "#fafaf8"
  grid-dot: "#dfddd6"
  border-subtle: "#e3e1db"
  border-strong: "#cdcac2"
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
  display:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "26px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Instrument Sans Variable, Instrument Sans, Inter Variable, system-ui, sans-serif"
    fontSize: "23px"
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
Playfair survit au seul monogramme de marque. Les coins arrondis sont tombés de
12 px à 4 px pour la même raison — la rondeur lisait « application grand
public », la serre lit « instrument ».

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
- **Bordures** : filet de carte (`#e3e1db`), bordure de contrôle (`#cdcac2`),
  séparateur de ligne de tableau (`#f3f1ec`).
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
**Brand Font:** Playfair Display — **monogramme de marque uniquement**

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
  réécrivant le nombre.

La graisse, elle, se lit sur l'appelant et non ici : `SectionLabel` pose 700 par
défaut, les constantes de tuile (`KPI_LABEL`) redescendent à 600. C'est un écart
réel, pas une tolérance.

### Named Rules

**The Mono-Carries-Data Rule.** Tout chiffre qu'on lit pour décider rend en mono
tabulaire. Un montant, un compteur, un pourcentage ou un horodatage en
sans-serif est un défaut, pas une variante.

**The Playfair-Is-Brand-Only Rule.** Playfair Display ne rend que le monogramme
de la barre de navigation. Un titre de page en serif fait relire la boulangerie
au lieu de l'outil — c'est le geste que la refonte a explicitement défait.

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
écran, 4 en medium, 7 en extra-large pour la bande de KPI. Les tableaux ont deux
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
ordre alphabétique ; la dernière colonne porte l'action de ligne ; la sélection
alimente une action groupée annoncée dans le bandeau.
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
courtes, cellules réduites à un signe. Le filtre « différences seulement » est un
contrôle de premier plan, pas une option enfouie ; la légende est obligatoire et
distingue l'accordé de l'accordé-par-héritage. Lecture seule assumée, avec le
renvoi explicite vers l'endroit où l'on édite.
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
- **Focus** (`0 0 0 3px rgba(138,104,32,0.32)`) : halo, dérivé de l'accent — le
  liseré et le halo sont toujours de la même couleur.

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
  12,5 px semi-gras. Le primaire est **encre** sur `#201d19`, un seul par
  bandeau, celui qui crée. Le secondaire est une feuille blanche bordée de
  `#cdcac2` qui vire au papier pressé au survol. L'icône d'un bouton secondaire
  est grise : elle ne concurrence pas le libellé.
- **Bouton primitif partagé** (`@breakery/ui`) : hauteur 56 px, rayon 4 px,
  capitales interlettrées. Son variant `primary` est **vert** — couleur réservée
  au chemin de l'argent — et son variant `gold` remplit en or. C'est le bouton
  des modales et des formulaires.
- **Désactivé** : les variants remplis neutralisent leur couleur au lieu de la
  faner. Un vert ou un or à 50 % d'opacité lit encore comme un bouton vivant.
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

- Hauteur 44 px, rayon 4 px, bordure `#e3e1db`, fond feuille blanche.
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
  label mono, liens en 13 px qui virent à l'or au survol et à l'état actif.
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
  rend vert et en capitales. Deux occurrences, dans `SettingsFloorPlanPage`.
- **Playfair Display survit hors du monogramme, mais dans vingt-et-un fichiers**,
  pour vingt-huit occurrences de `font-serif` / `font-display` — pas dans les
  quatre-vingt-dix annoncés. Réserve à ne pas confondre avec une victoire : sous
  ce thème `--font-display` est remappé sur le corps, donc la plupart de ces
  classes ne rendent **pas** de serif ; elles nomment le contraire de ce qu'elles
  font. La règle du monogramme unique reste la cible.
- **Les deux tokens annoncés manquants existent.** Le gris inerte est
  `--text-inert` (`#c2beb5`) et la rampe de data-viz est `--chart-1..4`
  (`#2b6c9c` → `#c9dcea`), tous deux dans `packages/ui/src/tokens/colors.css` et
  exposés par le preset Tailwind. Reliquat réel : `features/reports/utils/chartColors.ts`
  redéclare ces mêmes valeurs en dur au lieu de consommer les tokens.

**Écarts ouverts, relevés le 2026-08-18.** Ceux-là sont des constats, pas des
règles :

- **Les primitives partagées portent le contraire de trois règles de ce
  document.** `Card` rend `shadow-sm` par défaut, à rebours de
  **Border-Before-Shadow** ; `Button` rend vert par défaut, à rebours de la
  doctrine encre ; les quatre paliers d'espacement sémantique exposés par le
  preset n'ont aucun appelant dans le back-office. Conséquence structurelle : la
  conformité s'obtient par un opt-out que chaque auteur doit connaître, donc un
  fichier neuf naît non conforme en silence.
- **Six classes de couleur ne peignent rien.** `bg-warn` / `text-warn` désignent
  une famille qui n'existe pas dans le preset — la déclaration est supprimée sans
  bruit. Elles vivent dans `features/marketing` (`SegmentList`, `BirthdayList`).
  La garde CI `tailwind-dead-classes.mjs` ne les attrape pas : elle sait détecter
  une classe morte d'une famille connue, pas une famille inventée.
- **The Value-Width Rule est enfreinte sur une tuile de la liste B2B.** Mesuré à
  1280 px, la largeur cible du produit : une valeur monétaire de dix caractères
  rend sur deux lignes. C'est précisément la coupure que la règle nomme.

**État du corpus.** La planche de référence couvre quinze écrans pour neuf
archétypes. Trois sont construits — Today (shell + landing), Products (List) et
B2B orders (List). Les douze autres sont dessinés et validés, non implémentés :
Stock alerts (List), Daily sales et Trial balance (Report), Purchase order
(Document), New expense (Form), Settings (Hub), Stock count (Bulk entry), Roles
& permissions (Matrix), Recipe (Cascade), Production log (Append-only log),
Z-reports (List) et Login (hors shell).
