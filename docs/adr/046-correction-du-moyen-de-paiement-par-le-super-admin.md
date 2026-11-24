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

Relevé du 2026-11-24. Livré par la PR #769, fusionnée le 2026-11-24 à
00 h 29 UTC+8 (master `553da7f0`).

- **Base** : migration `20261123000001_payment_method_correction.sql`. Elle crée
  la RPC `correct_order_payment_method_v1` et la table
  `payment_method_corrections` (historique et idempotence, lecture seule sous
  la visibilité des règlements). Appliquée en production sous la version
  `20261124110126` ; corps de la fonction identique au dépôt et à la base de
  dev ; non exécutable par `anon`.
- **Back-office** : bouton « Correct method » par règlement sur la fiche
  commande, visible du super admin seul ; fenêtre moyen, motif et PIN ; libellé
  « Payment method corrected » dans l'historique de la commande. Publié en
  production le 2026-11-24 (détail dans
  [l'état des environnements](../runbooks/etat-environnements.md)).
- **Écriture de correction** : neuve, à la date de la vente, rattachée à la
  vente. Shift ouvert : compte du nouveau moyen contre compte de l'ancien.
  Shift clos avec espèces : l'écart de caisse est réduit sur le compte où la
  clôture l'a passé. Deux moyens qui partagent le même compte (par exemple
  carte et EDC, ou QRIS et portefeuilles) ne donnent aucune écriture. Si le mapping a changé depuis la
  vente, la correction crédite le compte réellement débité par la vente.
- **Refus côté serveur**, en plus des décisions : commande B2B, période
  bancaire finalisée sur le compte concerné.

Écarts et limites constatés :

- Décision 8 : le refus « déjà rapproché » porte sur les lignes des écritures
  de la vente au compte de l'ancien moyen, pas sur le règlement seul. Une
  commande payée en deux règlements du même moyen est refusée dès que l'un des
  deux est rapproché.
- Décision 9 : l'ardoise est refusée par le serveur, mais le bouton reste
  visible sur une vente en ardoise ; le refus s'affiche alors en message.
- La course de deux corrections concurrentes de même clé est traitée dans la
  fonction, sans test automatisé (pgTAP ne tient qu'une session).
- Au relevé, aucune correction n'a encore été passée en production : l'usage
  réel n'est pas observé.
