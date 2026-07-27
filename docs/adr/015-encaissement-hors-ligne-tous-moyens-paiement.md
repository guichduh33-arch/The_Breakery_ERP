# ADR-015 — Encaissement hors-ligne étendu à tous les moyens de paiement sauf l'avoir

> **Date :** 2026-07-27 · **Statut : ACTÉ** (décision propriétaire, feu vert en séance 2026-07-27)

## Décision

En mode hors-ligne LAN (cloud injoignable, hub boutique disponible), le POS accepte
l'encaissement par **toute méthode de l'enum `payment_method` sauf `store_credit`** —
soit `cash`, `card`, `qris`, `edc`, `transfer`, `gopay`, `ovo`, `dana` — en règlement
simple **ou en partage d'addition** (1 à 5 règlements), **sans limite de durée de
coupure**.

La règle s'énonce en **liste d'exclusion à un seul élément**, volontairement : tout
moyen de paiement ajouté à l'enum plus tard sera hors-ligne par défaut, et devra
être exclu explicitement s'il dépend d'un contrôle serveur.

Quatre corollaires, tous exigibles :

1. **`store_credit` (avoir client) reste online-only.** Refus explicite en caisse
   pendant la coupure, jamais mis en file.
2. **La fenêtre `offline_max_hours` est supprimée** — colonne, validation et champ
   de réglage compris. Une coupure longue ne bloque plus l'encaissement.
3. **Le réglage `offline_cash_enabled` devient `offline_payments_enabled`**, son
   périmètre n'étant plus le cash. **Défaut inchangé à `false`** : le hors-ligne
   reste une activation explicite.
4. **Aucun contrôle anti-fraude supplémentaire n'est construit** : celui de la
   clôture de shift suffit (voir Contexte).

## Contexte

Le déclencheur est une correction factuelle de la fiche `docs/objectifs/POS.md` :
la limite « le POS ne supporte pas le mode offline » n'a plus lieu d'être, et
la restriction au seul cash reposait sur une prémisse fausse.

**Le terminal EDC ne dépend pas du réseau de la boutique.** Il porte sa propre
carte SIM et dialogue avec la banque tout seul. Quand la fibre tombe, un paiement
carte/QRIS s'autorise normalement — le POS n'a rien à demander au cloud, il a
seulement à *enregistrer* un règlement déjà encaissé par un autre canal. Il en va
de même du virement et des e-wallets, réglés depuis le téléphone du client. Ces huit
méthodes n'ont **aucun contrôle serveur susceptible d'échouer au retour du réseau** :
leur replay ne peut pas être refusé.

**L'avoir est le seul cas contraire, et c'est structurel.** Son solde se vérifie
serveur sous verrou (gate D8, ADR-013), et `p_offline_replay` **ne le bypasse pas**
— c'est écrit dans le corps de `pay_existing_order_v16`
(`20260726000238_adr013_lot4_pay_existing_v16_store_credit_gate.sql`, §D8). Un avoir
encaissé hors-ligne sur un solde déjà consommé ailleurs produirait une vente
définitivement rejetée, marchandise déjà remise. Pire, le drain de l'outbox
s'arrête au premier échec (`apps/pos/src/features/lan/offlineReplay.ts:162`) : cet
intent bloquerait toute la file des ventes de la coupure. L'exclusion de l'avoir
n'est donc pas une précaution, c'est la condition pour que la file reste saine.

**Le socle serveur était déjà prêt.** `pay_existing_order_v16` accepte `p_payments`
(tableau de 1 à 5 règlements, toutes méthodes de l'enum) avec `p_offline_replay`.
Aucune RPC money-path n'est à créer ni à bumper.

**Le contrôle de fraude existe déjà et est appliqué serveur.** Le risque théorique
— déclarer « carte » et empocher les billets — est capté à la clôture du shift :
`close_shift_v8` prend `p_counted_card` / `p_counted_qris` en **comptage aveugle**
et calcule l'écart contre le total enregistré
(`20260710000126_close_shift_v5_three_way_denominations.sql:159-161`), avec note
obligatoire puis PIN manager au-delà des seuils. Le caissier saisit le total du
ticket de lot de la machine EDC ; un écart saute aux yeux à la fermeture, sans
attendre le moindre relevé bancaire. Construire un rapport de rapprochement
supplémentaire ferait doublon.

## Conséquences

1. Les refus hors-ligne existants **restent en vigueur** et ne sont pas rouverts
   par cet ADR : promotions, remise commande, échange de points fidélité,
   paiement d'une commande déjà cloud. Ils dépendent tous d'une évaluation
   serveur, contrairement aux cinq méthodes autorisées.
2. L'intent d'outbox `cash_payment` devient un intent `payment` porteur d'un
   tableau de règlements. Le kind historique **doit rester lisible au replay** :
   un terminal qui reçoit la mise à jour avec des ventes en file ne perd rien.
3. `offline_max_hours` disparaît de `business_config`, de `set_setting`, de
   `get_settings_by_category` et du back-office. Les RPC settings sont bumpées
   (versions live à vérifier au moment de l'écriture — elles bougent souvent).
4. **Un shift ne peut toujours pas se clôturer pendant la coupure** : la clôture
   est une RPC cloud. Propriété héritée du cash différé, inchangée ici.
5. **Le hors-ligne n'a jamais été validé en conditions réelles de boutique.** Cet
   ADR élargit un chemin non éprouvé ; le défaut `false` du toggle est ce qui
   contient le risque. Une session de test en boutique reste due avant toute
   activation.
6. Cet ADR **exige une spec d'exécution** (règle documentaire 4) :
   `docs/specs/015x-offline-tous-moyens-paiement.md`, supprimée à la livraison,
   résiduel éventuel reporté ici.

## Réversibilité

Revenir au cash seul se fait en refermant le filtre de méthodes côté POS, sans
migration : le socle serveur multi-tender préexistait à cet ADR et lui survivrait.
Réintroduire une fenêtre de durée maximale demanderait en revanche une nouvelle
colonne et un nouveau bump des RPC settings — ce serait un ADR supersédant
celui-ci, qui devrait justifier pourquoi une coupure longue mérite de bloquer la
caisse alors que l'argent, lui, continue d'entrer.
