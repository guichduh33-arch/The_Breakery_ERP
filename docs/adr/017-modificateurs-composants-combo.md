# ADR-017 — Un composant de combo se configure comme s'il était vendu seul

> **Date :** 2026-07-30 · **Statut : ACTÉ** (décision propriétaire)

## Décision

Lorsqu'un composant retenu dans un combo porte des groupes de modificateurs, le
caissier les renseigne, le client les paie et le stock en tient compte —
**exactement comme si ce composant était vendu à l'unité**. Le combo cesse d'être
une zone où les modificateurs n'existent pas.

Quatre points, indissociables :

1. **Choix.** Les groupes de modificateurs d'une option retenue s'ouvrent
   **dans la modale de configuration du combo**, sous cette option. Un seul
   écran, une seule validation, le prix final visible avant de confirmer.
2. **Obligation.** Un groupe **requis** laissé sans réponse **interdit la
   validation** du combo. Même règle que la vente à l'unité : un café sans
   chaud-ou-glacé n'est pas une commande.
3. **Prix.** Le prix d'un combo devient `combo_base_price` + Σ surcharges des
   options + Σ ajustements des modificateurs de leurs composants. Ces trois
   termes sont **résolus par le serveur** ; aucun montant envoyé par le client
   n'est retenu.
4. **Stock.** Les ingrédients rattachés à un modificateur de composant sont
   **déduits à la vente** et **restitués à l'annulation et au remboursement**.

## Contexte

État vérifié le 2026-07-30 sur les corps de fonctions en base et les données du
projet V3 de développement.

Le parcours combo du POS court-circuite le pipeline des modificateurs depuis son
origine : un produit de type combo ouvre sa modale de configuration et n'entre
jamais dans la résolution des modificateurs. Le choix d'une option s'arrête donc
au composant, sans jamais descendre à ses propres options. Côté serveur, le
chemin de paiement **désactive explicitement** la résolution des ingrédients de
modificateurs sur une ligne de combo, et le résolveur de prix de ligne ignore
leurs ajustements.

Trois couples combo × composant sont concernés à cette date :

| Combo | Composant | Groupes requis jamais proposés |
|---|---|---|
| French Plater | Americano | HOT/ICED |
| French Plater | Capuccino | HOT/ICED + Milk |
| test | Capuccino | HOT/ICED + Milk |

Trois conséquences, dont deux chiffrables sur le seul Capuccino :

1. Le barista ne sait pas s'il prépare un chaud ou un glacé — l'information
   n'est jamais saisie, donc jamais transmise.
2. Le supplément de lait d'avoine, facturé quand le café est vendu seul, n'est
   **pas facturé** dans un combo.
3. Les 200 ml de lait rattachés à l'option choisie ne sont **pas déduits** :
   la matière sort sans trace et l'écart n'apparaît qu'à l'inventaire.

Le même jour, un blocage distinct a été corrigé : les options d'un combo
voyageant parmi les modificateurs de la ligne, le résolveur de prix les cherchait
parmi les modificateurs du produit et refusait la vente, rendant **tout combo
configuré inencaissable**. Le lookup est désormais sauté sur une ligne de combo,
les libellés étant conservés sans ajustement de prix. Cet ADR s'installe sur ce
correctif : il rouvre la porte au prix, mais par un terme résolu serveur et
identifié comme tel, jamais par le montant que le client aurait joint.

Trois propriétés de l'existant rendent la décision peu coûteuse :

- La composition d'un combo est stockée en JSON **sans schéma contraint** :
  l'enrichir ne demande aucun changement de structure de table.
- **Huit fonctions SQL** lisent cette composition, et toutes n'y lisent que
  l'identifiant du produit et la quantité. Y ajouter les modificateurs d'un
  composant est **additif** : ces huit lecteurs l'ignorent sans rien casser.
- Le mécanisme de **restitution** existe déjà : les ingrédients déduits au titre
  des modificateurs sont mémorisés sur la ligne de commande et relus par
  l'annulation, le remboursement et le paiement différé. Y verser les ingrédients
  des modificateurs de composants suffit à ce que le retour de stock suive, sans
  code neuf.

## Conséquences

1. **La composition d'une ligne de combo porte, par composant, les modificateurs
   retenus.** Ajout additif : les lecteurs existants restent valides sans
   modification.
2. **Le résolveur de prix de combo intègre un troisième terme.** Il résout les
   ajustements des modificateurs de chaque composant contre la définition
   serveur de ce composant — jamais contre le produit combo, qui ne porte pas
   ces options. Un ajustement introuvable côté serveur est un refus, comme pour
   la vente à l'unité.
3. **La déduction des ingrédients est appelée par composant**, avec l'identifiant
   de ce composant, et non plus désactivée sur les lignes de combo. Les résultats
   sont agrégés sur la ligne de commande, d'où l'annulation et le remboursement
   les relisent.
4. **La modale de configuration devient bloquante** : la validation reste
   indisponible tant qu'un groupe requis d'un composant retenu est sans réponse.
   Il suit qu'un groupe requis de composant **ne se pré-coche pas** : une réponse
   posée d'office ne serait jamais absente, et le blocage ne se déclencherait
   jamais. Le caissier doit poser le geste. Le pré-cochage des options du combo
   lui-même, qui existe déjà, n'est pas remis en cause.
5. **L'écran de cuisine doit afficher les modificateurs des composants.** Il lit
   aujourd'hui les modificateurs de la ligne et ignore sa composition ; un choix
   rangé par composant ne l'atteindrait pas sans cette lecture. C'est la seule
   conséquence qui ajoute du code là où il n'y en avait pas.
6. **Les formats de file d'attente hors ligne restent compatibles.** L'ajout est
   additif : un poste non encore mis à jour n'émet simplement pas la nouvelle
   clé, et son intent en attente reste rejouable. Aucun format publié n'est
   retiré ni redéfini.
7. **Un combo devient refusable pour une raison nouvelle** — modificateur requis
   non renseigné, ou ajustement inconnu du serveur. Ces refus doivent être
   distingués des refus de composition existants, afin que le caissier sache
   quoi corriger.
8. **Le catalogue gagne une responsabilité implicite.** Placer dans un combo un
   composant à modificateurs requis allonge la saisie au comptoir. Le constat est
   posé ; aucune restriction n'est décidée ici.

## Ce que cet ADR ne tranche pas

- **Le coût de revient d'un combo.** La déduction porte sur le stock ; la
  valorisation du combo et de sa marge n'est pas modifiée ici.
- **La réouverture d'une commande.** Une commande de combo rouverte perd
  aujourd'hui sa nature de combo et sa composition. Le défaut est antérieur et
  reste entier ; il se traitera séparément.
- **Les combos imbriqués.** Un composant ne peut pas être lui-même un combo ;
  cet ADR ne change pas cette règle.

## Réversibilité

Les trois termes du prix sont distincts et le terme ajouté est identifiable :
cesser de facturer les modificateurs de composants revient à ne plus l'ajouter,
sans toucher aux deux autres. La composition enrichie étant additive, un retour
en arrière laisse des lignes de commande porteuses d'une clé que plus personne ne
lit — inerte, pas contradictoire. En revanche, revenir sur la déduction de stock
après des ventes exigerait un nouvel ADR : les mouvements émis sont dans un
journal en ajout seul et ne se rétractent pas.
