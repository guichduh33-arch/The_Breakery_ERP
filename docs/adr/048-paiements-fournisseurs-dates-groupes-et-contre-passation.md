# ADR-048 — Paiements fournisseurs : date réelle, règlement groupé, contre-passation

Date : 2026-11-26

Statut : décisions de Mamat du 2026-11-26. La section « Choix de méthode »
porte des choix techniques de l'agent, pris dans le mandat : ils ne sont pas
des décisions de Mamat.

## Contexte

Un paiement fournisseur se saisissait bon par bon, toujours daté de l'instant
de la saisie, et ne se corrigeait d'aucune façon. Un virement unique qui solde
plusieurs bons devait être découpé à la main. Une saisie tardive datait le
décaissement, son écriture et le contrôle de période du jour de la saisie. Une
erreur restait au grand livre, et l'annulation d'une réception payée au
comptant restait bloquée faute de chemin pour annuler son paiement.

Le même jour, Mamat a rendu obligatoire la date réelle d'encaissement au
règlement B2B et a demandé la même règle pour les achats.

## Décision

1. **Un paiement fournisseur porte la date réelle du décaissement**, choisie
   par l'opérateur à la saisie. Elle date le paiement, son écriture et le
   contrôle de période. La saisie ne retient jamais le jour courant par défaut.
2. **Plusieurs bons d'un même fournisseur se règlent en un seul paiement.**
   L'opérateur choisit les bons et le montant réellement payé.
3. **Un paiement fournisseur enregistré par erreur se corrige par une
   contre-passation**, jamais par une modification ni une suppression. Le
   paiement d'origine reste visible. Un nouveau paiement se saisit ensuite si
   besoin.
4. **Seul le super admin contre-passe un paiement fournisseur.** Il saisit son
   propre PIN, vérifié par le serveur avec verrouillage, et un motif
   obligatoire.
5. **La contre-passation est datée du jour du paiement d'origine.** Si la
   période comptable de ce jour est fermée, elle est refusée.
6. **Un paiement déjà rapproché avec la banque peut être contre-passé.** Le
   rapprochement se reprend ensuite à la main.
7. **Chaque contre-passation est tracée** dans le journal d'audit : paiement,
   montant, moyen, date d'origine, motif, auteur.
8. **Chaque bon de commande montre l'historique détaillé de ses actions** :
   création, modification, facture, réception, annulation de réception,
   paiement, contre-passation, annulation — avec la date, l'heure et l'auteur.

## Choix de méthode

- Le serveur garde un défaut à l'instant courant quand la date manque, comme
  la famille `record_b2b_payment` : c'est l'écran qui exige la saisie.
- Le grand livre `purchase_payments` reste append-only. La contre-passation y
  ajoute une ligne **négative**, liée au paiement annulé et portant le motif.
  Toutes les sommes existantes (reste dû, encours fournisseur, rapport des
  paiements, annulation de réception) restent justes sans être réécrites. Une
  seule contre-passation par paiement ; une contre-passation ne se contre-passe
  pas.
- L'écriture inverse reprend les comptes réellement mouvementés par l'écriture
  d'origine, pas le mapping courant (les espèces sont passées en petite caisse
  le 2026-11-15).
- Le règlement groupé écrit une ligne et une écriture **par bon**, liées par un
  identifiant de groupe : les lecteurs existants retrouvent l'écriture d'un
  paiement par sa ligne. Le montant va au bon le plus ancien d'abord (date de
  commande, puis création). Un bon déjà soldé, d'un autre fournisseur ou
  annulé est refusé.
- Un paiement groupé se contre-passe **en entier** : la saisie fautive est une.
- Les bons importés de l'ancienne caisse ne se contre-passent pas ici : la
  garde d'import n'admet que des ajouts positifs.
- Une contre-passation qui ajouterait une ligne bancaire dans un mois dont le
  rapprochement est **finalisé** est refusée : elle casserait l'empreinte de ce
  rapprochement. Un simple rapprochement en cours ne bloque pas (décision 6).
- L'historique d'un bon lit le journal d'audit, lisible avec la permission
  d'audit. Sans elle, l'écran le dit ; les paiements restent visibles dans la
  carte des paiements.

## Conséquences

- Un rapprochement bancaire qui portait le paiement contre-passé montre
  désormais une ligne inverse non rapprochée, à traiter à la main.
- Après une contre-passation, le bon reste verrouillé à l'édition et sa facture
  reste exigée : ces gardes regardent l'existence d'un paiement, pas son solde.
- L'annulation d'une réception payée au comptant devient possible après la
  contre-passation de son paiement, puisque son contrôle lit le solde.
- Le rapport des paiements fournisseurs lit le grand livre tel quel : une
  contre-passation y apparaît comme une ligne négative du jour d'origine. Les
  montants se compensent ; le nombre de paiements compte aussi ces lignes.
- Le serveur n'encadre pas la date saisie (ni futur, ni antérieure au bon) :
  seul le contrôle de période la borne. Un encadrement serait une décision à
  prendre.

## Bilan factuel

Relevé du 2026-11-27. Livré par la PR #780 (branche
`feat/supplier-payments-grouped-dated-reversal`), intégrée par la PR #781 et
fusionnée dans `master` en `9c4c96c7`, puis publié en production le 2026-11-27
vers 1 h UTC+8 : migrations `20261126000001` et `20261126000002`, et
back-office. Détail et preuves dans `docs/runbooks/etat-environnements.md`,
complément du 27 novembre 2026.

- **Base** : paiement d'un bon par la v3 de `record_po_payment`, règlement
  groupé par la v2 de `record_supplier_payment`, contre-passation par
  `reverse_po_payment_v1`. Le garde de facture passe en v2 et laisse passer la
  contre-passation. Ni `anon` ni le client n'exécutent les fonctions internes.
- **Back-office** : les libellés « Paid at », « Pay several orders » et
  « Reverse payment » sont présents dans le code servi par le domaine de
  production, avec les appels aux nouvelles fonctions.
- **Non vérifié** : aucun paiement, règlement groupé ou contre-passation saisi
  en production au relevé.
