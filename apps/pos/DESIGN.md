---
name: The Breakery POS
description: Un plateau de service laqué — fond quasi-noir chaud, or rationné sur la valeur et l'action, gestes larges pris d'une seule main.
colors:
  surface-0: "#0b0a09"
  surface-1: "#12100e"
  surface-2: "#1a1815"
  surface-3: "#231f1b"
  surface-4: "#2e2924"
  surface-inert: "#1f1c19"
  bg-input: "#1f1c18"
  border-subtle: "#2a2622"
  border-strong: "#746b5f"
  border-muted: "#1f1c18"
  gold: "#d3ab5c"
  gold-hover: "#dfba72"
  gold-pressed: "#bf9748"
  gold-strong: "#bf9748"
  gold-soft: "rgba(211, 171, 92, 0.14)"
  gold-fg: "#1a1408"
  green: "#3fb583"
  green-hover: "#4ac48f"
  green-pressed: "#329b6f"
  green-fg: "#0a1610"
  red: "#e8695f"
  red-soft: "rgba(232, 105, 95, 0.14)"
  red-as-text: "#f0837b"
  red-on-fill: "#180e0c"
  amber-warn: "#d99a3a"
  blue-info: "#6fa8d8"
  text-primary: "#f7f3ec"
  text-secondary: "#b3aa9d"
  text-muted: "#968c7e"
  text-subtle: "#7d7364"
  text-disabled: "#5c5449"
  text-inert: "#4a443c"
  payment-card: "#8b5cf6"
  payment-qris: "#f59e0b"
  chart-1: "#8cc3e0"
  chart-2: "#6fa8d8"
  chart-3: "#558db8"
  chart-4: "#3f7096"
  backdrop: "rgba(11, 10, 9, 0.72)"
typography:
  display:
    fontFamily: "Playfair Display, Times New Roman, Georgia, serif"
    fontSize: "56px"
    fontWeight: 400
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  headline:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "30px"
    fontWeight: 600
    lineHeight: 1.15
    letterSpacing: "-0.01em"
  title:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "normal"
  body:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "Inter Variable, Inter, system-ui, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: "0.12em"
  data:
    fontFamily: "JetBrains Mono Variable, JetBrains Mono, ui-monospace, monospace"
    fontSize: "34px"
    fontWeight: 600
    lineHeight: 1.15
    fontFeature: "tabular-nums"
  brand:
    fontFamily: "Playfair Display, Times New Roman, Georgia, serif"
    fontSize: "40px"
    fontWeight: 400
    lineHeight: 1
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  xl: "16px"
  "2xl": "20px"
spacing:
  compact: "12px"
  card: "20px"
  page: "28px"
  section: "48px"
  touch-min: "44px"
  touch-comfy: "56px"
  touch-large: "80px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.green-fg}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "{spacing.touch-comfy}"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-primary-disabled:
    backgroundColor: "{colors.surface-4}"
    textColor: "{colors.text-muted}"
  button-gold:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.gold-fg}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "{spacing.touch-comfy}"
  button-gold-hover:
    backgroundColor: "{colors.gold-hover}"
  button-secondary:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "{spacing.touch-comfy}"
  button-secondary-hover:
    backgroundColor: "{colors.bg-input}"
  button-outline-gold:
    backgroundColor: "transparent"
    textColor: "{colors.gold}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "{spacing.touch-comfy}"
  button-ghost-destructive:
    backgroundColor: "transparent"
    textColor: "{colors.red-as-text}"
    rounded: "{rounded.md}"
    padding: "0 16px"
    height: "{spacing.touch-comfy}"
  card:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "24px"
  product-tile:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "8px 10px"
  product-tile-in-cart:
    backgroundColor: "{colors.surface-2}"
    textColor: "{colors.gold}"
    rounded: "{rounded.lg}"
  input:
    backgroundColor: "{colors.bg-input}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    padding: "8px 12px"
    height: "{spacing.touch-min}"
  badge-default:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.gold-fg}"
    rounded: "9999px"
    padding: "2px 10px"
  badge-destructive:
    backgroundColor: "{colors.red-soft}"
    textColor: "{colors.red-as-text}"
    rounded: "9999px"
    padding: "2px 10px"
  badge-success:
    backgroundColor: "rgba(16, 185, 129, 0.12)"
    textColor: "{colors.green}"
    rounded: "9999px"
    padding: "2px 10px"
  numpad-key:
    backgroundColor: "{colors.surface-3}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.md}"
    height: "{spacing.touch-large}"
---

# Design System: The Breakery POS

## Overview

**Creative North Star: "Le Plateau de Service"**

La caisse est un plateau laqué sombre sur lequel on pose des objets et qu'on
reprend d'une seule main. Le fond n'est pas noir : c'est un brun très sombre
réchauffé (#12100e), de la même famille de teinte que le papier du back-office —
seule la lumière change entre les deux surfaces du produit. Les objets qui
comptent — la tuile de produit, la ligne de panier, le pavé numérique, le ticket
de cuisine — se détachent en montant d'un cran sur une rampe de quatre valeurs,
pas en flottant sur une ombre.

Le geste prime sur la finesse. Les contrôles sont grands, francs et répondants :
ils s'enfoncent sous le doigt (compression à 0,97 à l'appui, remontée en 120 ms)
et redeviennent immobiles dès que le système d'exploitation demande moins de
mouvement. Rien n'est décoratif : chaque pixel doré, chaque bordure colorée et
chaque minuteur qui change de couleur porte une information que le caissier lit
en coup d'œil, debout, avec un client en face de lui.

L'or est la seule couleur d'identité, et il est rationné. Il ne dit qu'une chose
— *ceci est la valeur, ou l'action* : le prix, le montant, la sélection active,
l'anneau de focus, le monogramme de marque. Partout ailleurs, du neutre chaud.
Deux registres sont explicitement rejetés : le **tableau de bord d'analytics**
(cartes empilées, graphiques, tuiles de KPI — la caisse encaisse, elle ne
rapporte pas) et le **noir-et-or clinquant** (dorés saturés, dégradés, lueurs).
L'or est une encre, jamais un vernis.

**Key Characteristics:**

- Brun très sombre réchauffé sur l'axe ~40°, quatre crans de surface qui se
  lisent comme une distance à l'œil (0 = le plus loin, 4 = le plus près).
- Or unique et rationné ; le vert porte la validation, le rouge le danger, l'ambre
  l'attente.
- Trois familles typographiques seulement : Playfair (marque), Inter (tout le
  chrome et le texte), JetBrains Mono (tout ce qui est un nombre).
- Aucune ombre portée sous le cran modale : l'élévation se lit à la valeur de
  surface plus un filet clair de 1 px en haut.
- Cibles tactiles à 56 px par défaut, 44 px en secondaire, 80 px pour le pavé.
- Douze teintes catégorielles qui sont l'identité d'une famille de produits, et
  jamais une série de graphique.

## Colors

Une palette de neutres chauds sur laquelle trois signaux seulement ont le droit
de porter de la couleur : l'or pour la valeur et l'action, le vert pour ce qui
est acquis, le rouge pour ce qui est perdu ou dangereux.

### Primary

- **Or de Vitrine** (`#d3ab5c`) : la seule couleur d'identité. Prix d'un produit,
  montant d'une ligne, total, sélection de catégorie active, anneau d'un produit
  déjà au panier, liseré de focus, monogramme de marque, étoile de favori. En
  remplissage de bouton, la doctrine est celle du code, arbitrée le 2026-08-23 :
  **l'or MÈNE à l'argent, le vert l'ENGAGE.** L'or remplit le geste qui ouvre le
  chemin du paiement (Checkout) et l'action dorée (validation d'une saisie de
  montant, action de marque) ; l'engagement irréversible — payer, envoyer en
  cuisine — reste au vert. Les deux cohabitent sur un même écran parce qu'ils
  répondent à deux questions différentes ; deux CTA **verts**, eux, ne cohabitent
  jamais (quand le fast-path « Exact » est visible, le pied du terminal se
  rétrograde en secondaire). Ce paragraphe a longtemps interdit l'or sur « la
  confirmation d'une commande » pendant que le code gravait l'inverse — c'est le
  code qui fait loi.
- **Or Éclairci** (`#dfba72`) et **Or Enfoncé** (`#bf9748`) : survol et appui.
  L'or enfoncé sert aussi de variante « forte » sur les surfaces déjà claires.
- **Or Voilé** (`rgba(211, 171, 92, 0.14)`) : le seul remplissage doré autorisé
  en aplat large — fond d'un badge promo, survol d'un bouton à contour doré.
- **Brun d'Encre** (`#1a1408`) : le texte à poser SUR un aplat doré. Jamais
  l'inverse.

### Secondary

- **Vert de Rendu** (`#3fb583`) : la confirmation et l'acquis. Remplissage de
  l'action principale (payer, valider, envoyer), état « prêt » en cuisine,
  étiquette du paiement en espèces. Son foncé (`#0a1610`) est le texte à poser
  dessus.
- **Braise** (`#e8695f`) : le danger et la perte. C'est un **remplissage**
  (bouton destructeur, bordure d'un ticket en retard critique) ; il ne s'écrit
  jamais en texte sur le fond sombre — voir la règle des deux rouges ci-dessous.

### Tertiary

- **Ambre d'Attente** (`#d99a3a`) : l'avertissement qui n'est pas encore une
  faute — stock bas, minuteur de cuisine entré dans la bande d'alerte.
- **Bleu d'Information** (`#6fa8d8`) : la note neutre, sans urgence.
- **Violet Carte** (`#8b5cf6`) et **Ambre QRIS** (`#f59e0b`) : deux teintes
  d'identité de moyen de paiement. Ce sont des **étiquettes**, jamais des boutons.
  Les autres moyens (espèces, avoir) dérivent des tokens de sens et suivent donc
  le thème.

### Neutral

- **Noir Torréfié** (`#0b0a09`) : le fond de page, le cran le plus loin de l'œil.
- **Brun Fournil** (`#12100e`) : les panneaux de premier niveau — le corps de la
  caisse.
- **Brun Relevé** (`#1a1815`) : les cartes, tuiles de produit, lignes de panier,
  barre supérieure.
- **Brun Flottant** (`#231f1b`) : ce qui se pose par-dessus — popovers, boutons
  secondaires, touches du pavé.
- **Brun Pressé** (`#2e2924`) : survol et appui. C'est aussi le fond des pastilles
  neutres, parce que c'est le seul cran visible dans les **deux** thèmes.
- **Filet** (`#2a2622`) et **Arête** (`#746b5f`) : bordure de repos, bordure de
  contrôle. L'Arête a été remontée de `#413a33` le 2026-08-24 (arbitrage du
  propriétaire) : elle valait 1,3 à 1,7:1 sur les quatre fonds — la limite d'un
  contrôle était invisible ; elle tient désormais les 3:1 de WCAG 1.4.11 partout
  (3,13 à 3,63:1). **Filet Sourd** (`#1f1c18`) : séparateur interne et fond de champ.
- **Ivoire Chaud** (`#f7f3ec`) : le texte principal. Puis quatre crans de retrait
  — secondaire (`#b3aa9d`), discret (`#968c7e`), sourd (`#7d7364`), désactivé
  (`#5c5449`) — et un cran sous le désactivé, **Inerte** (`#4a443c`), réservé à la
  ponctuation structurelle : séparateur de fil d'Ariane, chevron éteint, icône qui
  n'appelle aucune action. L'inerte n'est jamais du texte à lire.

### Named Rules

**La Règle de l'Encre Rare.** L'or n'apparaît que sur la valeur (un montant), la
sélection (ce qui est actif), le focus et la marque. S'il apparaît ailleurs, c'est
qu'un autre token manquait : on ajoute le token, on n'étend pas l'or.

**La Règle des Deux Rouges.** Le rouge a deux rôles qui ne se substituent jamais.
`red-as-text` (`#f0837b`) est le rouge *en* premier plan, à écrire sur la surface
sombre. `red-on-fill` (`#180e0c`) est le premier plan à poser *sur* un aplat
rouge. Les confondre a déjà produit un badge à 1,00:1, illisible. Même contrat
pour l'or et le vert : le suffixe `-fg` signifie toujours « sur remplissage ».

**La Règle des Teintes de Catégorie.** Les douze teintes catégorielles
(`--cat-amber` … `--cat-red`) sont l'**identité** d'une famille de produits. Elles
ne servent jamais de série de graphique : la même couleur dirait « Viennoiserie »
sur un écran et « troisième trimestre » sur l'autre. Les graphiques prennent la
rampe monochrome `chart-1..4`.

## Typography

**Display Font:** Playfair Display (avec Times New Roman, Georgia en secours)
**Body Font:** Inter Variable (avec system-ui, -apple-system en secours)
**Label/Mono Font:** JetBrains Mono Variable (avec ui-monospace en secours)

**Character:** trois familles, trois métiers, aucune ambiguïté. Playfair ne sert
qu'à la marque et aux titres de composition — c'est la seule trace de la
boulangerie dans un outil de travail. Inter porte tout le reste du texte, y
compris les libellés en capitales. JetBrains Mono porte **tout ce qui est un
nombre** : montants, quantités, minuteurs, références, horodatages. Une quatrième
famille a été retirée du système le 2026-08-01 précisément parce qu'elle entrait
en concurrence avec Playfair sur les valeurs chiffrées.

### Hierarchy

- **Display** (Playfair, 400, 56px, 1.15) : le monogramme de marque et l'écran de
  connexion. Nulle part ailleurs dans le parcours d'encaissement.
- **Headline** (Inter, 600, 30px, 1.15) : titre d'écran plein — clôture de
  session, terminal de paiement.
- **Title** (Inter, 600, 24px, 1.3) : titre de carte. Les titres de **modales**
  du kit partagé rendent en Playfair (arbitré le 2026-08-23 — l'usage du code
  fait loi) : un titre de composition peut porter la serif, c'est la donnée et
  le libellé fonctionnel qui ne le peuvent jamais.
- **Body** (Inter, 400, 16px, 1.5) : le texte courant. Le cran au-dessus (19px)
  sert au corps emphatique — la ligne qu'on lit à un client.
- **Label** (Inter, 700, 12px, interlettrage 0.12em, CAPITALES) : la signature du
  système. Tout intitulé de section, de groupe et de tuile passe par là.
- **Data** (JetBrains Mono, 600, 34px, chasse tabulaire) : la valeur qu'on lit à
  voix haute — total à payer, monnaie à rendre, écart de caisse.

### Named Rules

**La Règle du Chiffre Immobile.** Tout nombre susceptible de changer sous l'œil —
minuteur, total en cours, quantité — est en mono avec `tabular-nums`. Un chiffre
qui saute d'un pixel pendant qu'on le lit est une erreur de lecture en puissance.

**La Règle de la Capitale Espacée.** Les libellés de section sont en capitales
Inter grasses à 0.12em. C'est le motif signature du système ; il ne se remplace
pas par un titre en casse normale, et il ne descend pas sous 12px — l'échelle
basse a été décompressée le 2026-08-01 parce que 11px était illisible pour une
caissière debout à 60 cm de l'écran.

**La Règle de la Serif Réservée.** Playfair ne touche jamais une donnée ni un
libellé fonctionnel. Si une serif apparaît sur un montant, le token est faux.
Corollaire arbitré le 2026-08-23 : **le numéro de commande est une donnée et n'a
qu'UNE graphie à l'écran — mono, la forme du KDS** (`font-mono tabular-nums`,
or sur la pièce maîtresse). Il rendait en serif sur l'écran client et en mono en
cuisine : le seul datum que le client doit apparier au retrait changeait de
forme entre les surfaces.

## Layout

L'écran de caisse est une **colonne unique verticale** (barre supérieure de
56 px, corps, barre d'actions globale) dont le corps se divise en **trois
colonnes** : rail de catégories, grille de produits, panneau de commande active.
Sous le point de rupture `md`, les trois colonnes s'empilent — bandeau de
catégories en haut, grille, puis panneau — sans jamais produire de défilement
horizontal, y compris à 390 px de large sur un téléphone tenu d'une main.

L'espacement suit une base de 4 px, avec quatre gouttières nommées par leur
intention plutôt que par leur taille : **compacte** (12px, densité du rush),
**carte** (20px, à l'intérieur d'une tuile), **page** (28px, marge extérieure),
**section** (48px, entre deux blocs). Nommer l'intention permet de resserrer une
densité sans réécrire les composants.

Les cibles tactiles ont trois crans : **44 px** minimum (contrôles secondaires,
champs de saisie), **56 px** confortable (défaut de tout bouton, ligne de
sélection, onglet), **80 px** large (touches de pavé numérique, action pleine
largeur). Le rail de catégories masque sa barre de défilement tout en restant
défilable — un doigt fait glisser, aucune gouttière ne mange l'espace.

### Named Rules

**La Règle des 56.** Toute action du parcours d'argent — ajouter, envoyer,
encaisser, valider un montant — fait au moins 56 px de haut. Le 44 px est le
plancher des contrôles secondaires et des champs, pas celui des gestes qui
engagent une transaction.

**La Règle de la Barre Unique.** Les actions de commande vivent toutes dans la
barre inférieure pleine largeur, jamais dispersées dans le panier. Le caissier
sait où se trouve l'action suivante sans la chercher.

## Elevation & Depth

**Le thème sombre n'a pratiquement pas d'ombres portées, et c'est un choix.** Une
ombre noire à 50 % posée sur un fond à `#12100e` ne produit rien de visible : elle
coûte du rendu et ne dit rien. L'élévation se lit donc en deux temps — la
**valeur de surface** (monter d'un cran sur la rampe `surface-0 → surface-4`) et
un **filet clair de 1 px** en haut de l'élément, qui simule une arête prenant la
lumière. Les crans `xs`, `sm` et `md` de l'échelle d'ombres ne valent que ce
filet.

Les ombres portées ne réapparaissent qu'à partir du cran `lg`, c'est-à-dire pour
les surfaces réellement **détachées** du plan : modales, feuilles latérales,
popovers. Un voile de fond quasi-noir à 72 % avec un flou de 8 px les sépare du
reste.

Le thème clair du back-office fait exactement l'inverse (aucun filet, l'élévation
se lit à l'ombre). Le même token produit donc deux comportements corrects.

### Shadow Vocabulary

- **Filet d'élévation** (`inset 0 1px 0 rgba(255,255,255,0.06)`) : l'arête
  éclairée de toute carte, tuile, barre ou champ au repos. C'est la valeur des
  crans `xs` / `sm` / `md`.
- **Détachement** (`0 16px 40px rgba(0,0,0,0.55)`, cran `lg`) : ce qui survole le
  plan — popover, tuile de produit au survol.
- **Modale** (`0 28px 72px rgba(0,0,0,0.65)`) : le seul cran autorisé sur une
  surface qui prend le focus de l'écran entier.
- **Creux** (`inset 0 1px 2px rgba(0,0,0,0.35)`) : les surfaces en retrait —
  cartes en creux, champs enfoncés.
- **Halo de focus** (`0 0 0 3px rgba(211,171,92,0.40)`) : dérivé de l'or, comme
  la bordure de focus. Le liseré et le halo sont toujours de la même couleur.

### Named Rules

**La Règle du Filet.** En thème sombre, on ne cherche pas la profondeur dans une
ombre : on monte d'un cran de surface et on pose un filet. Ajouter une ombre
douce sous une carte ne la fait pas ressortir, cela la salit.

## Shapes

Des angles **franchement adoucis**, remontés d'un cran le 2026-08-01 parce que
l'échelle précédente (4/6/8/12/16) lisait « utilitaire » sur des cibles tactiles
de 44 px et plus. L'échelle vivante est 6 / 8 / 12 / 16 / 20 px : les contrôles et
badges à 6-8 px, les cartes, tuiles de produit et lignes de panier à 12 px, les
surfaces flottantes à 16-20 px, et l'écran client monte plus haut encore — ses
blocs sont vus de loin et arrondis en conséquence.

C'est le point où les deux thèmes du produit divergent volontairement : le
back-office a resserré ses rayons à 3-6 px pour lire « instrument ». La caisse
garde des angles généreux parce qu'un objet destiné au doigt doit avoir l'air
prenable. **Les pastilles sont des capsules complètes** (rayon plein) — badges de
statut, compteur d'articles au panier, pastille de favori.

Les bordures sont fines et permanentes : 1 px de `border-subtle` au repos sur
toute surface, qui passe à `border-strong` au survol et à l'or à la sélection. Un
seul objet porte une bordure de 2 px : le ticket de cuisine, dont l'épaisseur et
la couleur portent l'urgence.

## Components

### Buttons

- **Shape:** angles adoucis (8px), hauteur 56 px par défaut, 36 px en petit,
  80 px en grand, carré 56×56 en icône.
- **Primary:** aplat vert (`#3fb583`) sur texte vert foncé (`#0a1610`), capitales,
  interlettrage 0.025em. C'est l'action qui **fait avancer la transaction**.
- **Gold:** aplat doré sur brun d'encre, mêmes capitales. Réservé à l'action de
  marque et à la validation d'une saisie de montant — jamais en concurrence avec
  le vert sur un même écran.
- **Secondary:** surface flottante (`#231f1b`) bordée de filet, casse normale.
- **Outline Gold / Ghost / Ghost destructif / Link:** contour doré sur fond
  transparent ; fantôme neutre ; fantôme rouge en texte (`red-as-text`, sur fond
  `red-soft` au survol) ; lien doré souligné au survol.
- **Hover / Focus / Active:** transition de 120 ms sur la couleur, la bordure et
  l'ombre, avec une courbe de sortie très amortie (`cubic-bezier(0.16,1,0.3,1)`).
  À l'appui, compression à 0,97. Focus visible : contour doré de 2 px décalé de
  2 px. Tout cela s'annule intégralement sous `prefers-reduced-motion`.
- **Disabled:** les variantes pleines et contourées **neutralisent** leur couleur
  (fond `surface-4`, texte discret) au lieu de simplement la faner — un vert
  saturé à 50 % d'opacité continue de se lire comme un bouton vivant.

### Chips

- **Style:** capsule pleine, texte 12px gras. La forme tonale est la règle :
  fond de la couleur à 12-14 % d'opacité, texte à pleine force. Le remplissage
  saturé est réservé au badge doré par défaut.
- **State:** succès, avertissement, information et destructif partagent ce contrat
  tonal. Le badge neutre prend `surface-4` — le seul cran visible sous les deux
  thèmes ; sur une carte blanche du back-office, un fond « flottant » deviendrait
  blanc sur blanc.

### Cards / Containers

- **Corner Style:** 12px.
- **Background:** `surface-2` au repos ; `surface-3` pour la variante élevée ;
  `bg-base` pour la variante en creux.
- **Shadow Strategy:** filet d'élévation seul au repos (voir Elevation & Depth).
  La variante élevée monte d'un cran de surface **plutôt** que d'ajouter une ombre.
- **Border:** 1 px `border-subtle` ; `border-muted` en creux.
- **Internal Padding:** 16 / 24 / 32 px selon la densité ; la gouttière de carte
  nommée vaut 20 px.

### Inputs / Fields

- **Style:** fond en creux (`#1f1c18`), bordure de filet, angles à 8px, hauteur
  44 px, texte 14px, indication en texte discret.
- **Focus:** contour doré de 2 px décalé de 2 px, doublé du halo doré. Liseré et
  halo dérivent tous deux de l'accent : jamais une couleur de bordure dans un halo
  d'une autre.
- **Disabled:** curseur interdit et opacité réduite.
- **Saisie tactile:** dans la caisse, tout champ ouvre le pavé virtuel plutôt que
  le clavier système. Le champ est une cible, pas un point d'insertion.

### Navigation

Il n'y a pas de navigation permanente au sens d'un back-office. Une **barre
supérieure de 56 px** porte, à gauche, l'ouverture du tiroir de menu, le
monogramme et le mot POS en capitales espacées ; à droite, le nom du caissier en
service et l'accès à l'historique. Tout le reste — rapports, ardoises, clients,
sessions, réglages, verrouillage, déconnexion — vit dans un **tiroir latéral**
ouvert par une seule poignée. Un point d'entrée unique, jamais deux icônes qui
font la même chose.

Le **rail de catégories** est la seule navigation permanente du corps : libellés
en capitales, une teinte d'identité par catégorie, et un glyphe — ou, faute de
correspondance, le **monogramme** de la catégorie dans sa propre couleur, jamais
une icône générique répétée.

### Product Tile (composant signature)

La tuile de produit est l'objet le plus manipulé du produit et concentre toutes
les règles du système :

- Image en 4:3, agrandie de 6 % au survol ; en son absence, le monogramme de
  marque à demi-opacité — jamais une icône d'image cassée.
- Nom sur deux lignes maximum à hauteur réservée, pour que la grille ne saute pas
  quand un nom est long.
- **Prix en mono doré, au moins aussi gros que le nom et plus gras.** C'est la
  valeur lue à voix haute et vérifiée par le client sur l'écran d'en face.
- **Déjà au panier** : bordure dorée et anneau doré à 50 %, plus une pastille
  dorée en haut à gauche portant la quantité. C'est ce qui coupe le double-ajout
  pendant le rush.
- **Épuisé** : voile sombre à 72 %, image désaturée, et une étiquette CAPITALES
  rouge inclinée à −8°, bordée, posée au centre. Le prix disparaît — un produit
  non vendable n'a pas de prix affiché. La tuile est désactivée, pas seulement
  fanée.
- **Promo** et **stock bas** : badge doré voilé en haut à gauche, ruban ambre en
  bas de l'image. Deux informations distinctes, deux emplacements distincts.

### Ticket de cuisine (composant signature)

Le ticket du KDS est le seul objet du système dont **la couleur encode le temps**.
Bordure de 2 px qui escalade avec l'âge de la commande : filet neutre en dessous
du seuil d'alerte, ambre au-delà, rouge avec pulsation au-delà du seuil critique.
Le minuteur suit exactement la même bande, en mono tabulaire MM:SS, et passe en
gras à l'urgence. Les deux seuils sont configurés côté back-office, jamais codés
en dur ; un minuteur non démarré affiche `--:--` plutôt que zéro. Le numéro de
commande est en mono doré préfixé d'un `#`.

Le son double toujours la couleur, jamais l'inverse : un atelier bruyant perd le
signal sonore, un boulanger qui a le dos tourné perd le signal visuel.

### Pavé numérique (composant signature)

Le pavé virtuel enveloppe tout l'arbre de la caisse et s'ouvre sur n'importe quel
champ. Deux dispositions — numérique pour les montants, alphabétique pour la
recherche. Touches à 80 px sur surface flottante. C'est ce composant qui rend
vraie la promesse « un seul écran tactile suffit » : aucun clavier physique sur le
plan de travail.

## Do's and Don'ts

### Do:

- **Do** faire passer toute couleur par un token. Le KDS impose déjà zéro hex en
  dur et aucun `style` en ligne ; c'est la règle du système entier.
- **Do** monter d'un cran de surface pour créer de la profondeur, et poser le
  filet d'élévation. C'est la seule technique correcte en thème sombre.
- **Do** écrire tout nombre en mono avec `tabular-nums`, y compris les quantités
  et les minuteurs.
- **Do** dimensionner à 56 px toute action du parcours d'argent, et à 80 px les
  touches de pavé.
- **Do** utiliser le suffixe `-fg` uniquement pour un premier plan **sur un
  aplat**, et `-as-text` pour une couleur écrite sur la surface sombre.
- **Do** doubler tout signal sonore par un signal visuel, et réciproquement.
- **Do** neutraliser la couleur d'un contrôle désactivé plutôt que de la faner.
- **Do** vérifier qu'un changement de primitif tient dans les **deux** thèmes :
  `@breakery/ui` est partagé avec le back-office, et un fond « flottant » qui
  devient blanc sur blanc là-bas est une régression ici.

### Don't:

- **Don't** ajouter une ombre portée sous une carte, une tuile ou une barre en
  thème sombre. Sous le cran `lg`, elle ne se voit pas — elle ternit.
- **Don't** étendre l'or au-delà de la valeur, de la sélection, du focus et de la
  marque. S'il en faut ailleurs, c'est qu'un token manque.
- **Don't** transformer la caisse en tableau de bord : pas de tuiles de KPI, pas
  de graphiques, pas de cartes empilées dans le parcours d'encaissement.
- **Don't** verser dans le noir-et-or clinquant : aucun dégradé doré, aucune
  lueur, aucun doré saturé en grand aplat.
- **Don't** utiliser les teintes catégorielles comme série de graphique, ni la
  rampe de graphique comme identité de catégorie.
- **Don't** écrire du texte dans le cran « inerte » : il est sous le désactivé et
  ne sert qu'à la ponctuation structurelle.
- **Don't** descendre un libellé sous 12px, ni remplacer les capitales espacées
  par un titre en casse normale.
- **Don't** poser Playfair sur une donnée, un montant ou un libellé fonctionnel.
- **Don't** ouvrir le clavier système sur un champ de la caisse : le pavé virtuel
  est le seul chemin de saisie.
