# ADR-043 — Une session de caisse vit sur un terminal ; seule la dernière clôture d'un terminal s'annule, tant que son rapport Z est un brouillon

Date : 2026-11-19

Statut : décisions de Mamat du 2026-11-09 (questions `C01` et `C04`, lots 4 et 5
du registre des décisions rendues de
`docs/audit-2026-11/04_QUESTIONS_CLARIFICATION.md`, et la règle « une session
par terminal, terminal obligatoire » du §6.3 de `docs/SPECS_OFFICIELS_ERP_POS.md`),
précisées par Mamat le 2026-11-19 pour les tâches `S3-01` à `S3-03` du master
plan de finition.

## Décision

1. **Le terminal est obligatoire à l'ouverture d'une session, et un terminal
   ne porte qu'une session ouverte.** La règle s'ajoute à celle qui existait :
   un caissier ne tient toujours qu'une session ouverte.

2. **Les totaux d'une session sont figés à sa clôture** : encaissements par
   moyen de paiement, chiffre d'affaires et nombre de commandes. Une opération
   ultérieure ne les change pas.

3. **Le propriétaire peut annuler la dernière clôture d'un terminal.** « La
   dernière » s'entend par terminal : aucune session plus récente ne doit avoir
   été ouverte sur ce terminal depuis.

4. **L'annulation n'est possible que tant que le rapport Z de la session est un
   brouillon.** Un rapport Z signé est définitif : la clôture ne s'annule plus.

5. **L'annulation défait tout ce que la clôture a posé** : elle contre-passe
   l'écriture d'écart de caisse et le règlement du tiroir (fond rendu à la petite
   caisse, reste en fonds non déposés), retire le rapport Z brouillon et remet
   la session en `open`. Le geste est tracé dans le journal d'audit, avec l'état
   d'avant.

6. **L'annulation est refusée si l'argent déposé par la clôture a déjà quitté
   les fonds non déposés** (dépôt en banque, retrait) : la contre-passation
   rendrait ce compte négatif.

7. **Un utilisateur qui détient la permission de clôturer les sessions des
   autres compte et clôture, depuis le POS, la session ouverte d'un autre
   caissier.** Sans cette permission, on ne clôture que sa propre session. Un
   caissier qui oublie de clôturer ne bloque donc pas son terminal pour la
   suite.

## Ce qui ne change pas

- Aucune session ne se clôture automatiquement ; la session ouverte depuis plus
  de 24 heures déclenche une alerte (`C01`).
- Le fond de caisse émis à l'ouverture reste acquis à la session rouverte.
- L'état intermédiaire de recomptage reste abandonné : l'annulation le remplace.

## Contexte

Le 2026-11-09, Mamat a écarté un état de recomptage au profit d'une annulation
de la dernière clôture, réservée au propriétaire (`C04`). Avec une session par
terminal, « la dernière clôture » pouvait désigner la dernière de la boutique ou
la dernière de chaque terminal. Et la clôture crée aussitôt un rapport Z, que le
propriétaire signe ensuite : la décision ne disait pas si une clôture déjà signée
restait annulable. Mamat a tranché les deux points le 2026-11-19 : par terminal,
et seulement avant signature. La revue du lot a ensuite relevé deux cas que
la décision ne couvrait pas : l'argent déposé déjà sorti des fonds non déposés,
et le terminal bloqué par la session oubliée d'un autre caissier. Mamat a
tranché le même jour : refus de l'annulation dans le premier cas, clôture par un
manager dans le second (points 6 et 7).

À la clôture, le tiroir est aussi réglé en comptabilité (fond rendu, reste
déposé). Contre-passer la seule écriture d'écart aurait laissé ce règlement en
place sur une session rouverte, et la clôture suivante l'aurait compté deux fois.
Le point 5 tire cette conséquence de la décision `C04`.

## Conséquences

- Les sessions historiques sans terminal (antérieures à cette règle) restent
  telles quelles ; leur clôture ne peut pas être annulée, faute de terminal.
- Les sessions clôturées avant le gel des totaux n'ont pas de totaux figés ; les
  rapports gardent pour elles leur lecture d'avant.
- Les mises en œuvre et leurs preuves vivent dans le master plan, tâches `S3-01`
  à `S3-03`.

## Réversibilité

Revenir sur ces règles demande un nouvel ADR. Une annulation de clôture se
défait en clôturant à nouveau la session : la nouvelle clôture pose ses propres
écritures et un nouveau rapport Z.
