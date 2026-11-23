# ADR-046 — Correction du moyen de paiement d'une vente par le super admin

Date : 2026-11-23

Statut : décisions de Mamat du 2026-11-23, prises pendant un rapprochement
bancaire d'octobre 2026.

## Contexte

Le caissier se trompe régulièrement de moyen de paiement : une vente payée par
carte ou QRIS est saisie en espèces, ou l'inverse. Le rapprochement bancaire le
révèle : le virement carte ou QRIS reçu dépasse les ventes enregistrées sur le
compte d'attente, et l'écriture de règlement est refusée, car la banque ne verse
jamais plus que les ventes.

Un règlement de vente n'avait jusqu'ici aucune voie de modification. La seule
correction possible était une écriture manuelle, sans lien avec la vente, et les
rapports par moyen de paiement restaient faux.

## Décision

1. **Seul le super admin peut changer le moyen de paiement d'un règlement de
   vente déjà enregistré.** Il le fait depuis le back-office. Il saisit son
   propre PIN, vérifié par le serveur avec verrouillage, et un motif obligatoire.
2. **La correction porte sur un règlement entier.** Le montant ne change pas. Un
   règlement ne se scinde pas en deux moyens.
3. **Moyens concernés** : espèces, carte, EDC, QRIS, portefeuilles électroniques
   et virement. L'avoir client est exclu dans les deux sens : il engage le solde
   d'un client.
4. **L'écriture de vente d'origine n'est jamais modifiée.** La correction passe
   une écriture de correction, datée du jour du règlement d'origine. Si la
   période comptable de ce jour est fermée, la correction est refusée.
5. **Shift encore ouvert** : l'écriture déplace le montant du compte de l'ancien
   moyen vers le compte du nouveau. La clôture lira le moyen corrigé.
6. **Shift déjà clôturé, espèces concernées** : l'écart de caisse constaté à la
   clôture était faux du même montant. L'écriture de correction corrige cet
   écart au compte d'écart de caisse, au lieu de toucher le tiroir, déjà soldé
   par la clôture.
7. **Le rapport Z et les totaux figés du shift restent tels quels.** Ils sont le
   document du jour. La correction reste visible à part : écriture comptable,
   fiche de la commande, journal d'audit. Les rapports de ventes par moyen de
   paiement, lus en direct, montrent le moyen corrigé.
8. **Un règlement déjà rapproché avec la banque ne se corrige pas.** Le super
   admin doit d'abord défaire le rapprochement.
9. **Une commande annulée ou remboursée, même en partie, ne se corrige pas.**
   Les règlements d'ardoise (encaissement différé) sont hors du périmètre de
   cette décision.
10. **Seules les ventes de la caisse actuelle se corrigent.** Les ventes
    importées de l'ancienne caisse restent protégées par l'import et se
    corrigent hors de cet outil.
11. **Chaque correction est tracée** dans le journal d'audit : règlement, ancien
    et nouveau moyen, montant, motif, auteur.

## Conséquences

- Les rapports vivants et le rapport Z d'un shift corrigé ne donnent plus le
  même total par moyen. C'est voulu : le rapport Z dit ce qui a été déclaré à
  la clôture, les rapports vivants disent ce qui a été réellement encaissé.
- L'écriture de correction sur un compte d'attente carte ou QRIS doit pouvoir
  être réglée dans le rapprochement bancaire, avec les ventes du jour.
- Une annulation ou un remboursement postérieur à la correction suit le moyen
  corrigé.
- Une correction erronée se corrige par une nouvelle correction, tracée de la
  même façon.

## Bilan factuel

À compléter après livraison.
