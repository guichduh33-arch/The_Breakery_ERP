# ADR-036 — Stock vitrine indépendant des ventes BtoB

Date : 2026-11-02

Statut : accepté par Mamat le 2026-11-02.

## Décision

Le stock vitrine est un compteur indicatif, indépendant du stock opérationnel.
Il sert à bloquer la vente depuis le café lorsque le produit est indisponible
en vitrine. Il ne réserve pas une partie du stock général pour le BtoB.

Les ventes BtoB déduisent uniquement le stock général et ne doivent jamais
modifier le stock vitrine ni être bloquées par un compteur vitrine nul ou absent.
Le stock général nécessaire doit être suffisant : le réglage autorisant le stock
négatif ne permet pas de contourner ce contrôle pour le BtoB.

La modification et l'annulation d'une commande BtoB suivent cette séparation :
leurs déductions et restitutions ne modifient pas la vitrine. Les règles de
consommation des produits suivis et des recettes restent applicables au stock
général, conformément à ADR-016.

Cette décision précise le rôle de la vitrine laissée hors périmètre par
[ADR-027](027-stock-global-mono-section.md). Elle ne modifie pas les règles de
vente du café ni la gestion mono-emplacement du stock général.

## Historique

Les mouvements historiques restent conservés. Cette correction ne reconstitue
pas automatiquement les quantités de vitrine affectées par d'anciennes ventes
BtoB ; une éventuelle réconciliation exige un relevé distinct.
