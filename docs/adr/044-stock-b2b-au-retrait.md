# ADR-044 — Stock B2B au retrait, disponibilité indicative à la création

Date : 2026-11-20

Statut : décision de Mamat du 2026-11-09 (question `B13`, lot 5 du registre
`docs/audit-2026-11/04_QUESTIONS_CLARIFICATION.md`), précisée le 2026-11-20
pendant la réalisation de `S1-15`.

## Décision

1. **La création contrôle la disponibilité et avertit si le stock est
   insuffisant, sans bloquer la commande.** Ce contrôle est indicatif : il ne
   réserve et ne déduit aucun stock. La modification avant retrait ne déduit
   pas davantage de stock.
2. **Le passage à livré contrôle et déduit le stock général dans la même
   transaction.** Si le stock nécessaire est insuffisant, la livraison est
   refusée et aucun mouvement ni changement de statut n'est conservé. Le réglage
   autorisant le stock négatif ne contourne pas ce refus.
3. **Paiement et retrait restent indépendants.** Une commande peut être payée
   avant son retrait ; le paiement ne déduit pas le stock. Prix serveur,
   facturation, créance et revenu à la création conservent leurs règles.
4. **Les imports financiers historiques restent sans mouvement de stock.**
   Mamat a confirmé le 2026-11-20 que cette absence est normale. Ils sont exclus
   de toute reprise automatique et du retrait opérationnel ordinaire.

## Invariants associés

- [ADR-036](036-stock-vitrine-independant-du-b2b.md) : aucune dépendance au
  compteur vitrine, aucune modification de celui-ci.
- [ADR-016](016-consommation-semi-finis-stockes.md) : la consommation s'arrête
  aux semi-finis suivis ; les autres recettes sont dépliées en unités de base.
- L'avertissement révèle seulement la disponibilité, sans quantité de stock
  confidentielle. Il ne donne pas accès aux listes ou aux valorisations de
  stock protégées par [ADR-039](039-visibilite-stock-et-etats-financiers-par-permission.md).
- Un nouvel essai de livraison ne déduit jamais une seconde fois. Une
  annulation avant retrait ne restitue rien ; après retrait, elle restitue les
  quantités réellement sorties, sous les règles d'annulation existantes.
- Le compteur d'un produit non suivi reste inchangé ; les mouvements de vente
  et leurs contreparties restent nécessaires au coût des ventes.

## Contexte et limites factuelles

Le relevé de production du 2026-11-20 distingue 85 commandes natives toutes
retirées et 192 imports financiers sans mouvement de vente. Le chiffre initial
de 119 commandes « en attente » provenait du statut de paiement et ne prouvait
pas une absence de retrait. Aucune quantité de stock n'est à réinjecter sur ce
relevé ; un préflight doit le recontrôler avant toute bascule.

L'instantané des quantités de consommation conserve la restitution même si la
recette change ensuite. Le helper partagé d'annulation valorise toujours au
coût courant ; cet ADR ne décide aucune reprise comptable historique.

## Livraison et retour

Les anciens appels qui déduisent à la création ne peuvent pas rester
exécutables avec un retrait qui déduit à nouveau. Préparer le back-office,
appliquer atomiquement le changement de contrat puis basculer ses appels. Un
ancien onglet doit échouer plutôt qu'effectuer une double déduction.

Après une commande créée sous le nouveau contrat, réinstaller l'ancien
back-office ne suffit pas : ses fonctions ne sont plus disponibles et ses
hypothèses de stock diffèrent. Un retour exige une migration compatible avec
chaque commande et ses mouvements conservés ; aucune restauration ou purge
automatique n'est autorisée par cette décision.
