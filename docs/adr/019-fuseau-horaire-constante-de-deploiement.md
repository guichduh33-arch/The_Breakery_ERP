# ADR-019 — Le fuseau horaire métier est une constante de déploiement

> **Date :** 2026-08-02 · **Statut : ACTÉ** (décision propriétaire, séance 2026-08-02)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Complète** : ADR-006, décision 1 (socle unique de configuration métier —
>   cet ADR opère le geste inverse de celui qu'elle décrit : retirer une clé de
>   la surface de réglage, de sa branche de validation et du dictionnaire typé,
>   dans la même migration)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cet ADR — on cite la
> famille. La version vivante se vérifie dans `supabase/migrations/` et au
> call-site. Les comptages portent la date du relevé : ils décrivent un état
> constaté, pas une propriété permanente.

## Décisions

1. **D1 — Le fuseau métier a une autorité unique : le paramètre de session
   PostgreSQL.** Il est posé au niveau de la base, pour tous les rôles, par la
   migration d'initialisation `20260503000000_init_extensions_enums.sql`. Toute
   fonction qui déduit une date métier d'un horodatage — par conversion explicite
   ou par simple cast — lit donc la même heure locale, par construction et sans
   avoir à le demander.

2. **D2 — La colonne `timezone` de la configuration métier est conservée, comme
   miroir.** Elle reste lisible et reste lue par les fonctions qui la lisent
   aujourd'hui : cet ADR **n'impose aucune conversion de masse**. Sa valeur est
   égale au paramètre de session par construction, non par coïncidence — c'est
   l'objet de D3 et D4.

3. **D3 — Le fuseau sort de la surface de réglage.** Il est retiré de l'écran des
   réglages généraux, du dictionnaire typé des clés, et la famille de RPC
   d'écriture des réglages refuse la clé avec un motif explicite — les trois dans
   le même lot, par symétrie avec la règle d'ajout posée par l'ADR-006. Un
   changement de fuseau devient un **geste de déploiement** — migration et
   redéploiement — au même titre que le choix du projet cloud.

4. **D4 — L'invariant est vérifié, pas seulement écrit.** Un test exécuté avec la
   suite assert que la colonne miroir est égale au paramètre de session. Une
   divergence est un échec de test, pas une découverte d'audit.

5. **D5 — Une seule constante côté client.** Les applications ne dérivent le
   fuseau que d'une constante unique, réexportée là où elle est nécessaire. Le
   client ne lit pas la configuration métier pour cela : il n'aurait aucun moyen
   de rester cohérent avec un paramètre de session qu'il ne voit pas.

6. **D6 — Ce que cet ADR ferme.** Le fuseau n'est plus modifiable à chaud. Le
   multi-site à fuseaux distincts sort du domaine du possible sans nouvel ADR :
   il exigerait que toute déduction de date métier passe par une valeur portée
   par la donnée, ce que D1 écarte explicitement.

## Contexte

L'audit du module Rapports (2026-08-01) a cherché un décalage de fuseau dans la
famille `recipe_cost_history`, qui déduit un jour métier par cast direct d'un
horodatage. **Ce décalage n'existait pas** : le paramètre de session de la base
vaut le fuseau métier, si bien que le cast donne déjà la bonne journée. Vérifié
au 2026-08-02 sur les 1 763 versions de recette porteuses d'items : **zéro**
divergence entre le jour obtenu par cast et le jour métier résolu explicitement,
dont 264 versions créées avant 08:00 locales — précisément le créneau qui aurait
dû rompre.

La recherche a en revanche mis au jour une incohérence de structure. Le fuseau
métier existe en **quatre exemplaires** : le paramètre de session PostgreSQL, la
colonne de configuration métier, et deux constantes distinctes dans deux paquets
partagés du monorepo. Les quatre portent aujourd'hui la même valeur — il n'y a
donc **aucun défaut en production**.

Ce qui rend la situation intenable n'est pas l'état présent, c'est le mécanisme.
La colonne est modifiable depuis l'écran des réglages, sur une liste de zones
IANA alimentée par le navigateur, et la RPC d'écriture ne valide que « chaîne non
vide » : aucun contrôle que la valeur désigne une zone réelle. Or **le paramètre
de session ne peut pas suivre un changement fait à l'exécution** : le modifier
exige l'ownership de la base et ne prend effet que sur les nouvelles connexions,
que le mutualiseur recycle. L'architecture propose donc un réglage qu'une large
part du système est physiquement incapable d'honorer.

Relevé au 2026-08-02 : sur 78 fonctions publiques qui déduisent une date d'un
horodatage, 30 résolvent le fuseau explicitement et 48 s'en remettent au
paramètre de session. Un changement de la seule colonne ferait diverger les deux
groupes sans qu'aucune erreur ne soit levée. Mesure de l'écart si la colonne
passait à UTC : **65 %** des commandes réglées, **63 %** des mouvements de stock
et **60 %** des entrées de journal d'audit changeraient de jour métier. Les
écritures comptables — création d'écriture de vente, mouvement de stock,
encaissement, remboursement, annulation, clôture de caisse, clôture
d'exercice — sont dans le groupe qui dépend du paramètre de session : les
nouvelles seraient datées du mauvais jour, et les rapports se contrediraient en
silence.

L'enseignement est que **la configurabilité affichée n'était pas réelle**. Offrir
un choix qu'une partie du système ne peut pas appliquer n'est pas une souplesse,
c'est un piège armé. The Breakery opère un site unique sur WITA, fuseau sans
heure d'été ; rendre ce paramètre modifiable à chaud répondrait à un besoin que
personne n'a exprimé, au prix d'un chantier lourd sur le chemin de l'argent.

## Conséquences

1. **Aucune conversion de masse.** Les fonctions qui s'en remettent au paramètre
   de session restent inchangées, y compris sur le chemin de l'argent. C'est le
   bénéfice principal de la décision : l'alternative — faire lire la
   configuration métier à toutes — aurait imposé de rouvrir les RPC
   d'encaissement, de remboursement, d'annulation et les déclencheurs
   d'écriture comptable, pour zéro changement de comportement.

2. **La liste de zones disparaît de l'écran, et avec elle un risque annexe.** Le
   choix offert incluait des fuseaux à heure d'été, alors que plusieurs calculs
   de fenêtre par défaut supposent un décalage fixe. D3 ferme cette porte sans
   traitement particulier.

3. **Un changement de fuseau reste possible, mais devient un geste conscient** :
   nouvelle migration portant le paramètre de session, mise à jour de la colonne
   miroir et de la constante client dans le même lot, redéploiement. Il n'y a
   plus de chemin où l'un bouge sans les autres.

4. **Tests exigibles** : la colonne miroir égale le paramètre de session ; la RPC
   d'écriture des réglages refuse la clé de fuseau ; l'écran des réglages
   généraux ne la propose plus. Le dictionnaire typé ne la déclare plus, ce que
   le compilateur suffit à garantir.

5. **Cet ADR n'exige pas de spec d'exécution** (règle documentaire 4) : le
   chantier tient en trois lots courts — le verrou, l'invariant, l'unification
   de la constante client.

## Réversibilité

Rouvrir le **réglage** demande trois gestes, et cette liste est complète :
rétablir la branche de validation de la clé dans la famille de RPC d'écriture des
réglages, redéclarer la clé au dictionnaire typé, et la réafficher sur l'écran
des réglages généraux. Rien d'autre n'a été détruit — la colonne miroir est
conservée (D2), et aucune fonction n'a été réécrite.

Rouvrir la **capacité** est une autre affaire, et cet ADR ne la promet pas. Un
fuseau réellement modifiable à chaud suppose que plus aucune déduction de date
métier ne dépende du paramètre de session : c'est la conversion de masse écartée
en conséquence 1, chemin de l'argent compris. Ce serait un chantier neuf, et il
appellerait un nouvel ADR — pas un retour en arrière sur celui-ci.

## Révision

Ces décisions ne se rouvrent que par un nouvel ADR.
