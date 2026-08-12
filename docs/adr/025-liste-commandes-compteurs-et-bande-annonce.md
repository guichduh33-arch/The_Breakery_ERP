# ADR-025 — La liste des commandes : des compteurs servis à part, une bande qui dit les vrais statuts

> **Date** : 2026-08-12
> **Statut** : ✅ Accepted (2026-08-12 — validé avec amendement de la décision 5 :
> les tuiles d'argent restent, servies par la fonction de compteurs)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (ne modifie aucun ADR)
> **Complète** : ADR-024 (le principe « compteurs séparés des lignes » posé pour
> la liste de stock) et ADR-009 (le cycle de vie des ordres) — sans les modifier.
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cet ADR — on cite la
> **famille**. La version vivante se vérifie dans `supabase/migrations/` et au
> call-site.

## Contexte

La liste des commandes du back-office (« Live Orders ») est l'écran
d'opérations du domaine Sales : le manager de boutique l'ouvre entre deux
services pour répondre à « où en sont les commandes », le gérant pour retrouver
une commande précise. Elle est servie par la famille `get_orders_list`,
paginée par curseur, avec les filtres appliqués côté serveur.

Sa refonte vers l'archétype List (DESIGN.md) exige une bande de compteurs qui
**sont** les filtres. Un relevé du 2026-08-12 a établi trois faits.

**Tous les chiffres de l'écran ne comptent que ce qui est chargé.** Les tuiles
de synthèse (total, montant, complétion, payé, impayé) sont calculées côté
client sur les lignes déjà chargées d'une liste paginée par curseur. Après le
premier chargement, elles annoncent la première page en la présentant comme la
période. C'est la classe de défaut que l'ADR-024 a nommée et corrigée sur la
liste de stock : un chiffre faux affiché comme vrai.

**Les onglets de statut mentent sur le cycle de vie.** La bande actuelle
affiche « New / Preparing / Ready », des étapes de préparation projetées sur
les statuts réels `pending_payment` / `draft` / `paid`, qui ne signifient pas
cela (ADR-009). Un manager qui lit « Preparing 3 » croit à trois commandes en
cuisine ; il regarde trois brouillons.

**La fonction de lignes est saine.** Contrairement au cas ADR-024, la famille
`get_orders_list` ne fait pas voyager d'agrégat avec ses lignes : elle renvoie
les lignes et un curseur, rien d'autre. Il n'y a rien à retirer, seulement une
fonction de compteurs à ajouter à côté.

## 1. Décisions

### Décision 1 — Les compteurs de la liste des commandes sont servis par une fonction distincte

Une famille de lecture dédiée (`get_orders_counters`) sert le compte total et
les comptes par statut pour la fenêtre et les filtres en cours. La famille
`get_orders_list` n'est pas modifiée. Le pied de liste lit le compteur du
panier actif — c'est ce qui lui permet d'annoncer « 12 sur 240 » et de rester
vrai sur une liste vide.

**Pourquoi.** Le principe est celui de l'ADR-024, décision 1, appliqué à la
deuxième liste paginée du back-office : un agrégat calculé sur les lignes
chargées n'est pas un agrégat, c'est un échantillon. La fonction porte la même
exigence de permission que celle des lignes (`orders.read`).

### Décision 2 — Les compteurs mesurent ce que l'écran montre, pas le statut actif

Les compteurs appliquent la fenêtre de dates et **tous les filtres serveur en
cours** (type, paiement, client, montant, remboursement…), mais **jamais le
statut sélectionné** — sinon la bande ne pourrait annoncer que le panier déjà
choisi et cesserait d'être un moyen d'en changer. Même règle, même conséquence
assumée que l'ADR-024, décision 2 : en filtrant, on perd le panorama global.

### Décision 3 — Les paniers sont les statuts réels, nommés par leurs noms

Les paniers de la bande sont les valeurs du type énuméré Postgres existant
`order_status`, plus le panier « tous ». Aucun nouveau type n'est créé ;
l'interface dérive les valeurs des types régénérés et n'en réécrit aucune.

Les libellés de l'interface disent les statuts réels — « Pending payment »,
« Draft », « Paid », « Completed », « Voided », « B2B pending » — et les
libellés de fantaisie « New / Preparing / Ready » meurent avec la refonte.
Le suivi de préparation appartient au KDS, pas à cette liste.

### Décision 4 — La parité entre compteurs et lignes est tenue par un test

Pour chaque panier, un test de base vérifie que le compteur égale le nombre de
lignes que la fonction de lignes renvoie pour ce même statut, mêmes fenêtre et
filtres. Même raison que l'ADR-024, décision 4 : les règles de sélection vivent
désormais dans deux fonctions, et seule une garde exécutée empêche leur
divergence silencieuse. La garde nouvelle exige aussi son test négatif de
permission (ADR-021, déc. 6).

### Décision 5 — Les indicateurs d'argent restent, et deviennent vrais

*(Sémantiques corrigées le 2026-08-12, avant merge, sur relevé de review : la
première rédaction définissait « payé » par la seule existence d'une ligne
`order_payments`, ce qui classait impayée toute facture B2B réglée — les
règlements B2B posent le statut sans ligne de paiement, défaut déjà corrigé
une fois dans la famille `get_pos_b2b_debts`. La rédaction affirmait aussi à
tort reprendre « les règles que l'écran appliquait déjà ».)*

Les tuiles d'argent de la liste — montant total, réglé, impayé, remboursé —
sont conservées, mais leurs valeurs sont servies par la même famille de
compteurs, côté serveur, sur la même fenêtre et les mêmes filtres que les
comptes (décision 2). Plus aucun chiffre de l'écran n'est calculé sur
l'échantillon chargé.

Les sémantiques sont fixées ici pour ne pas dériver : **réglé** = la commande
a au moins un paiement enregistré **ou** porte un statut qui dit l'argent
(payé, complété) — la règle que l'écran appliquait avant la refonte ;
**impayé** = ni réglée ni annulée ; les commandes **annulées** ne sont dans
aucun des deux paniers d'argent. Les sommes réglé/impayé sont des **totaux de
commandes**, pas des encaissements nets : le **remboursé** de la fenêtre
s'affiche dans sa propre tuile au lieu d'être soustrait en silence. Le taux
de complétion se dérive des comptes ; il n'a pas besoin d'être servi.

## 2. Conséquences

1. **Une fonction nouvelle, aucune modifiée.** La famille `get_orders_counters`
   naît avec la garde `orders.read`, le REVOKE anon/PUBLIC de rigueur et son
   GRANT explicite `authenticated`. Aucun appelant existant ne casse.
2. **Types régénérés** après la migration (`types.generated.ts`).
3. **Preuves exigibles** (ADR-021, déc. 6) : parité compteur/lignes par panier
   sur jeu semé ; sommes réglé/impayé/remboursé exactes sur le même jeu, cas
   « réglée par statut sans ligne de paiement » compris ; refus au rôle sans
   `orders.read` ; un filtre qui ne ramène rien affiche un pied qui compte ;
   **la bande de statut de la liste** ne porte plus aucun libellé
   « New / Preparing / Ready » — les badges de statut cuisine du détail
   (`preparing`, `ready`), qui disent le KDS et non le cycle de vie, sont hors
   de cette preuve.
4. **L'invalidation temps réel rafraîchit les deux lectures** : un événement
   realtime qui invalide les lignes invalide les compteurs, par imbrication des
   clés de requête (même mécanique que la liste de stock).
5. **Aucune reprise de données, aucune table touchée.**

## 3. Ce que cet ADR ne tranche pas

- **La liste des clients.** Elle charge un jeu borné et compte en mémoire, cas
  que l'ADR-024 a explicitement laissé hors du principe. Si elle devient
  paginée un jour, le principe s'applique et il n'y a pas besoin de nouvel ADR.
- **La forme de la pagination de la liste des commandes.** Le curseur existant
  n'est ni exigé ni remplacé ici.
- **Un panier « remboursées ».** Le filtre serveur de remboursement existe ;
  en faire un panier de la bande est une évolution de la fonction de compteurs
  qui ne rouvre pas cet ADR (même règle de révision que l'ADR-024).

## 4. Révision

Les décisions 1 à 5 ne se rouvrent que par un nouvel ADR. Ajouter un panier ou
un filtre à la fonction de compteurs n'en demande pas, tant que les décisions
1, 2 et 4 tiennent.
