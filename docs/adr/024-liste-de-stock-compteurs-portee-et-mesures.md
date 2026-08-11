# ADR-024 — La liste de stock : les compteurs quittent les lignes, et ce que la liste mesure

> **Date** : 2026-08-11
> **Statut** : ✅ Accepted (2026-08-11)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (ne modifie aucun ADR)
> **Complète** : ADR-014 (la valorisation `current_stock × cost_price` et sa
> divergence assumée avec le grand livre inventaire) — sans le modifier.
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cet ADR — on cite la
> **famille**. La version vivante se vérifie dans `supabase/migrations/` et au
> call-site.

## Contexte

La page d'atterrissage du domaine Stock du back-office liste les produits avec
leur stock à main, paginée, filtrable par recherche, par catégorie et par seuil
bas. Elle est ouverte par deux profils aux rythmes opposés : le responsable
stock, debout dans la réserve, qui vient répondre à « qu'est-ce qui manque »,
et le gérant en session longue, qui vient répondre à « combien d'argent dort
dans la réserve ».

Un audit mené le 2026-08-11 a établi trois faits qui, ensemble, motivent cette
décision.

**Le compte total ne survit pas à une liste vide.** La fonction de lecture
calcule le nombre total de produits filtrés dans un agrégat, puis le **recopie
sur chaque ligne renvoyée**. Zéro ligne renvoyée, zéro porteur : l'agrégat
n'existe plus. Le pied de liste ne peut donc pas dire « 0 sur 318 » au moment
précis où l'utilisateur a le plus besoin de savoir que son filtre est trop
étroit, et non que l'écran est cassé.

**Le seul chiffre d'alerte de l'écran est faux.** La bande de tuiles affiche un
compte de produits sous leur seuil calculé **côté client, sur la page
affichée**. Sur un catalogue paginé, il annonce ce que contient la page
courante en le présentant comme un état de la boutique. La réserve est reléguée
dans une note de bas de tuile. Un utilisateur qui découvre un produit à zéro
plusieurs pages plus loin cesse de faire confiance à tous les chiffres de
l'écran, et cette confiance ne revient pas.

**Le précédent interne ne s'applique pas.** Les listes du back-office qui
portaient déjà une bande de compteurs cliquables au 2026-08-11 — les commandes
B2B et les rapports de caisse — chargent l'intégralité de leur jeu de données et
comptent en mémoire. Ce sont des ensembles bornés. Le catalogue produit ne l'est
pas, et sa liste est paginée par construction. La liste de stock est donc la
première instance paginée de cet archétype : il n'y avait rien à imiter.

S'ajoute une absence, du côté de ce que la liste mesure. Les quantités y sont
rendues **sans unité** — la même colonne porte des grammes, des kilos et des
pièces sans le dire — et **sans valeur**, alors que le coût moyen pondéré est
maintenu en continu sur chaque produit. La liste ne peut donc répondre à aucune
des deux questions pour lesquelles elle est ouverte.

## 1. Décisions

### Décision 1 — Les compteurs d'une liste paginée ne voyagent pas avec ses lignes

Les agrégats d'une liste paginée — le total et les comptes par panier — sont
servis par une **fonction de lecture distincte** (famille `get_stock_counters`).
La fonction qui sert les lignes (famille `get_stock_levels`) ne renvoie plus que
des lignes : **le total quitte sa table de retour**.

**Pourquoi séparer.** Un agrégat recopié sur chaque ligne cesse d'exister quand
il n'y a pas de ligne. Ce n'est pas un défaut d'implémentation qu'on pourrait
corriger sans bouger le contrat : c'est une conséquence directe du fait de faire
porter une valeur globale par un jeu de lignes. Tant que le contrat est
celui-là, le défaut revient à chaque nouvel agrégat.

**Pourquoi retirer le total des lignes plutôt que le laisser aux deux
endroits.** Deux domiciles pour une même valeur, c'est deux valeurs qui peuvent
diverger. Le pied de liste lit désormais le compteur du panier actif.

**Bénéfice qui n'était pas le motif.** Les compteurs ne changent pas quand on
pagine. Séparés, ils ne sont plus rechargés par un changement de page ; fondus
dans les lignes, ils l'étaient à chaque « suivant ».

### Décision 2 — Les compteurs mesurent ce que l'écran montre, pas le catalogue entier

Les compteurs appliquent **la recherche et la catégorie** en cours. Ils
n'appliquent **pas** le panier actif — sinon la bande ne pourrait annoncer que
le panier déjà sélectionné, et cesserait d'être un moyen d'en changer.

Concrètement : une recherche qui ramène six produits, dont deux sous leur seuil,
affiche `All 6 · Low 2`, et non `Low 14` pour la boutique entière.

**Pourquoi.** Un compteur est une promesse : on clique dessus, on doit atterrir
exactement sur ce qu'il annonçait. Un compte global posé au-dessus d'une liste
filtrée annonce un nombre que la liste contredit — c'est-à-dire exactement le
défaut que cette décision corrige, déplacé d'un cran.

**Conséquence assumée.** En filtrant, on perd l'alerte globale de vue. Le
responsable stock qui cherche « farine » ne voit plus combien de produits sont
bas ailleurs dans la boutique. C'est un recul accepté au profit de la cohérence
entre ce qui est annoncé et ce qui est montré.

### Décision 3 — Le panier de filtre est un type de la base, pas une convention de chaîne

Les paniers de la liste sont un **type énuméré Postgres**. L'interface dérive ses
valeurs de la régénération de types ; elle ne les réécrit pas.

**Pourquoi.** Des valeurs nommées traversent la frontière entre l'interface et
la base. Écrites des deux côtés, elles finissent par ne plus coïncider, et
l'écart ne se voit sur aucun écran — c'est la classe de défaut que la règle
d'énumération du projet existe pour tuer. Le fait que ces paniers ne soient pas
une colonne mais des règles calculées ne change rien au risque : c'est le
franchissement de frontière qui le crée, pas l'origine de la valeur.

### Décision 4 — La parité entre les compteurs et les lignes est tenue par un test, pas par la vigilance

Pour **chaque** panier, un test de base vérifie que le compteur est égal au
nombre de lignes que la fonction de lignes renvoie pour ce même panier.

**Pourquoi.** La décision 1 fait vivre les règles de sélection du catalogue —
produit non supprimé, catégorie, recherche — dans deux fonctions. Une règle
ajoutée à l'une et oubliée dans l'autre donne un compteur qui annonce un nombre
et une liste qui en montre un autre. Les deux fonctions marchent, aucun test
existant ne rougit, et le chiffre ment de nouveau. Un commentaire croisé ne tient
que si le prochain lecteur le lit ; le test, lui, refuse la fusion.

**Pourquoi pas une source unique.** Un objet SQL partagé rendrait la divergence
impossible plutôt que détectable, ce qui est plus fort. Il ajoute en revanche un
objet à la base et ses droits à gérer, et il ne couvre que la divergence de
prédicat — pas les autres façons dont deux fonctions peuvent cesser de
s'accorder. Le test couvre les deux et ne coûte rien à l'exploitation. La source
unique reste ouverte si la duplication devient pénible.

### Décision 5 — La liste dit en quoi elle compte et ce que ça vaut

Chaque ligne porte **son unité de mesure** et **sa valorisation au coût**, cette
dernière étant le produit du stock à main par le coût du produit.

**Pourquoi l'unité.** Une même colonne qui porte des grammes, des kilos et des
pièces sans le dire oblige le lecteur à savoir de tête dans quoi se compte chaque
produit. C'est une charge de mémoire imposée à un utilisateur debout, les mains
occupées, et elle rend la colonne inexploitable pour qui ne connaît pas déjà le
catalogue par cœur.

**Pourquoi la valorisation, et sous quel nom.** C'est la question que le gérant
pose en premier au stock, et la donnée existe déjà. Elle s'affiche **au coût** et
se nomme comme telle. L'ADR-014 a acté que cette valorisation et le solde du
grand livre inventaire sont **deux mesures différentes qui peuvent diverger entre
deux inventaires physiques**, et que cette divergence est une règle et non un
défaut. La liste ne montre pas le grand livre et ne prétend donc rien
réconcilier ; en revanche, elle ne doit jamais présenter cette colonne comme un
solde comptable.

### Décision 6 — La liste se trie par urgence

L'ordre par défaut de la liste est l'urgence — l'écart au seuil d'abord — et non
l'ordre alphabétique.

**Pourquoi.** Un tri alphabétique place ce qui presse à la position que lui donne
son initiale. Sur un catalogue paginé, un produit à zéro peut se trouver
plusieurs pages plus loin, hors de vue de quelqu'un qui est venu précisément pour
le trouver. L'ordre d'une liste est une réponse à la question « par quoi
commencer » ; l'alphabet n'en est pas une.

### Décision 7 — Ce chantier est en partie correctif et en partie nouveau, et la part nouvelle est assumée

La part **corrective** — le total qui disparaît sur liste vide, le compte
d'alertes qui n'annonce que la page courante — répare des chiffres faux affichés
comme vrais. Elle ne concurrence aucun des trois chantiers que l'ADR-021 déc. 4
fait passer avant toute fonctionnalité nouvelle.

La part **nouvelle** — l'unité, la valorisation, les paniers cliquables — en est
une. **Le propriétaire l'ordonne malgré cet ordre**, en connaissance de
l'arbitrage. Cette décision est écrite pour que le hors-plan soit **daté et
visible**, et non découvert plus tard comme une dérive.

## 2. Conséquences

1. **Le contrat de lecture change** : la table de retour de la famille
   `get_stock_levels` perd son total et gagne l'unité et la valorisation, et son
   filtre de statut booléen devient le type énuméré de la décision 3. Le
   versionnement monotone s'applique — la version publiée ne s'édite pas, la
   suivante est créée et l'ancienne supprimée dans la même migration.
2. **Tous les appels positionnels existants cassent.** Les tests de base, le test
   de droits d'accès du module et les doublures de tests d'interface visent la
   signature actuelle. Ils se reprennent **dans le même lot** : un contrat changé
   sans ses appelants n'est pas un contrat livré.
3. **Le pied de liste lit un compteur, plus une ligne.** C'est ce qui lui permet
   d'afficher « 0 sur N » quand un filtre ne ramène rien, et c'est le seul moyen
   de le vérifier.
4. **Une garde ajoutée exige un test négatif** (ADR-021 déc. 6). La nouvelle
   fonction de compteurs porte la même exigence de permission que celle des
   lignes ; il faut donc prouver aussi qu'un rôle non autorisé se fait refuser,
   et pas seulement que le cas passant fonctionne.
5. **Preuves exigibles** (ADR-021 déc. 6) : un filtre qui ne ramène rien affiche
   un pied qui compte ; les compteurs de chaque panier égalent la liste
   correspondante ; un produit non suivi n'apparaît jamais dans le panier des
   stocks bas ; un produit sans coût connu vaut zéro sans casser le total ni la
   colonne ; régénération des types après le changement de schéma ; suite de
   tests du paquet d'interface concerné.
6. **Aucune reprise de données.** Aucune table n'est créée ni modifiée : le
   changement porte sur des fonctions de lecture et un type.
7. **Cet ADR n'exige pas de spec d'exécution** (règle documentaire 4) : le
   chantier tient dans des lots successifs dont aucun ne dépend du suivant.

## 3. Ce que cet ADR ne tranche pas

- **Laquelle des deux pages est la porte d'entrée du domaine Stock.** L'écran
  d'alertes de stock répond déjà, et mieux, à la question « qu'est-ce qui
  manque ». Savoir si la liste doit rester la page d'atterrissage, ou lui céder
  la place, reste ouvert — et ne se décide pas depuis cet ADR.
- **Si le panier des stocks à zéro inclut les quantités négatives.** Un stock
  négatif est un symptôme, pas un panier ; l'y ranger ou lui donner le sien est à
  décider avant l'implémentation, jamais par défaut.
- **Ce que devient le panier actif quand la recherche change.** Le conserver ou
  le remettre à « tous » sont deux comportements défendables ; aucun n'est acté.
- **L'existence d'un total valorisé de la réserve** présenté comme une valeur
  unique en haut de l'écran. La colonne est décidée, la synthèse ne l'est pas.
- **La forme de la pagination.** Le passage d'un décalage numérique à un curseur
  n'est ni exigé ni interdit ici.
- **La géométrie des contrôles du back-office.** L'audit du 2026-08-11 a relevé
  que les mesures de cible tactile du thème de la caisse gouvernent aussi les
  boutons du back-office, faute d'être redéfinies par son thème. C'est un
  chantier de système de design distinct, qui déborde largement cette liste.

## 4. Révision

Les décisions 1 à 7 ne se rouvrent que par un nouvel ADR. **Ajouter un panier**
n'en demande pas un : c'est une évolution du type de la décision 3 et de la
fonction de compteurs, tant que les décisions 1, 2 et 4 continuent de tenir.
Remplacer le test de parité de la décision 4 par une source unique de prédicat
n'en demande pas non plus — la décision fixe l'exigence de non-divergence, pas
son unique moyen.
