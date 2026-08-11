# ADR-023 — L'écran client au repos : la vitrine du jour remplace la file de retrait

> **Date** : 2026-08-11
> **Statut** : ✅ Accepted (2026-08-11)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (ne modifie aucun ADR)
> **Complète** : ADR-006 (les réglages de l'écran client vivent dans le socle
> `business_config`) — sans le modifier.
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cet ADR — on cite la
> **famille**. La version vivante se vérifie dans `supabase/migrations/` et au
> call-site.

## Contexte

L'écran client (`/display`) est la seule surface du produit regardée par
quelqu'un qui n'est pas employé. Sa composition est arrêtée depuis le
2026-07-07 : la **moitié gauche porte la marque en permanence**, la moitié
droite porte l'état. Il ne se touche jamais et ne s'appaire pas à une session de
personnel : il s'authentifie par jeton d'appareil.

Sa moitié droite connaît aujourd'hui deux régimes. Pendant une commande, elle
montre le panier en direct puis la confirmation de paiement. **Au repos**, elle
montre deux flux d'attente indépendants : les commandes dont au moins un item a
été marqué prêt en cuisine — alimenté par le statut cuisine des lignes, **sans
aucune condition de paiement**, ce qui couvre une commande de salle non encore
réglée comme une commande comptoir envoyée avant encaissement — et, en dessous,
la file des commandes payées ou terminées. Les deux flux sont plafonnés, pour
qu'un rush ne fasse pas déborder un écran de hauteur fixe.

Trois faits cadrent la décision.

**La fiche d'objectifs veut à la fois l'un et l'autre.** `CUSTOMER_DISPLAY.md`
décrit un repos commercial — « l'écran continue à vendre quand personne ne
commande » — **et** une annonce de commande prête en grand caractère, présentée
comme un moyen de « scaler le service sans staff supplémentaire ». Les deux
occupent la même moitié d'écran. Rien n'a jamais arbitré laquelle passe devant.

**Le réglage que la fiche promet n'existe pas.** Elle annonce un interrupteur
« Show ready orders » et un bip configurable. Dans le socle de réglages, l'écran
client ne porte que son message de pied de page et son slogan. Il n'y a donc
aucun interrupteur à basculer : il y a du code à retirer, ou un interrupteur à
créer.

**Le support que la fiche prête à la vitrine n'existe pas non plus.** Elle décrit
une table dédiée de promotions d'affichage, purement marketing, distincte des
promotions transactionnelles. Cette table n'a jamais été créée — ni migration, ni
type généré. La seule table au nom voisin est celle des mouvements de stock de
vitrine physique, qui n'a aucun rapport.

Autrement dit, le repos de l'écran client livre aujourd'hui la moitié
opérationnelle d'une intention dont la moitié commerciale n'a jamais eu de socle.

## 1. Décisions

### Décision 1 — Au repos, l'écran client est commercial, pas opérationnel

**L'état de repos est une vitrine.** Il montre des **produits réels** du
catalogue, choisis à la main, avec leur prix. Il ne montre plus de file
d'attente.

**Pourquoi.** L'écran est regardé par un public non formé, non captif, qui n'a
rien demandé. Entre deux commandes, la question qu'il se pose n'est pas
« où en est la commande d'un autre » mais « qu'est-ce qu'on vend ici ». Faire
cohabiter les deux registres sur une demi-largeur revenait à n'en servir aucun
correctement.

**Conséquence assumée, énoncée par le propriétaire :** le client perd son canal
visuel d'annonce. Savoir qu'une commande est prête redevient un appel de vive
voix, au comptoir. C'est un recul de service accepté en connaissance de cause,
pas un oubli.

### Décision 2 — La sélection est manuelle, le prix ne l'est jamais

Les produits mis en avant sont **choisis un par un depuis le back-office**. Leur
**prix n'est jamais saisi ni recopié** : il est résolu depuis le catalogue au
moment de l'affichage.

**Pourquoi la sélection est manuelle.** Un classement automatique — les
meilleures ventes, par exemple — ne pilote pas le message : un jour creux
afficherait un palmarès peu flatteur, et rien ne permettrait de pousser une
nouveauté. La vitrine est un geste commercial ; elle appartient au gérant.

**Pourquoi le prix ne l'est pas.** Un prix recopié dans une table d'affichage est
un prix qui dérive. L'écran client est **le seul écran que personne ne
surveille** : un montant faux y survivrait des jours, sous les yeux de clients
qui n'ont aucun moyen de savoir qu'il est faux. Cette décision est le corollaire
d'un invariant déjà posé ailleurs : le serveur est l'autorité sur les prix, et
aucune surface n'en propose une seconde source.

### Décision 3 — L'annonce « commande prête » ne se supprime pas : elle s'éteint

Le code des deux flux d'attente **reste en place**. Il passe derrière un réglage
d'écran client, **éteint par défaut**. Allumé, il rend à l'écran son
comportement d'avant ; éteint, la vitrine occupe seule le repos.

**Pourquoi ne pas supprimer.** Le service rendu par l'annonce est réel et son
retrait est un pari commercial, pas une certitude. Une suppression franche
rendrait le retour arrière coûteux — il faudrait reconstruire deux flux, leurs
plafonds de rush et leur raccordement au temps réel. Un interrupteur transforme
un pari irréversible en réglage.

**Pourquoi éteint par défaut.** Un réglage neuf allumé par défaut ne change rien
et laisse croire que la décision est appliquée. C'est l'état par défaut qui porte
la décision 1.

### Décision 4 — Ce chantier est une fonctionnalité nouvelle, et il est assumé comme tel

Il ne solde aucun engagement antérieur : aucun ADR ne l'exigeait. Il entre donc
en concurrence avec les trois chantiers que l'ADR-021 déc. 4 fait passer avant
toute fonctionnalité nouvelle — le filet d'intégration continue, la vérité
documentaire, puis la dette d'ADR.

**Le propriétaire l'ordonne malgré cet ordre**, en connaissance de l'arbitrage.
Cette décision est écrite pour que le hors-plan soit **daté et visible**, et non
découvert plus tard comme une dérive.

## 2. Conséquences

1. **Un support de persistance est à créer** pour la sélection : les produits
   retenus et leur ordre d'affichage. Il ne stocke **jamais** un prix
   (décision 2). Le socle de réglages existant porte des valeurs scalaires ; il
   ne convient pas à une liste ordonnée.
2. **Un écran de curation entre au back-office** : choisir les produits, les
   ordonner, voir ce que l'écran client montrera. Il relève du domaine des
   réglages, pas du catalogue — on n'y modifie aucun produit.
3. **Un réglage d'écran client s'ajoute au socle** (décision 3), éteint par
   défaut, propagé sans redémarrage de l'écran comme les réglages existants.
4. **Le rendu de la vitrine occupe la moitié droite au repos**, dans le respect
   de la composition arrêtée le 2026-07-07 : la moitié gauche reste la marque, et
   la vitrine ne s'y étend pas.
5. **Preuves exigibles** (ADR-021 déc. 6) : un produit retiré du catalogue ou
   rendu invisible en caisse **disparaît de la vitrine** ; un changement de prix
   au back-office **se voit sur l'écran client** sans réédition de la sélection ;
   le réglage éteint **ne montre aucune file** et allumé **la rend** ; la
   sélection survit à un rechargement de l'écran. Régénération des types après
   le changement de schéma.
6. **La fiche `docs/objectifs/CUSTOMER_DISPLAY.md` est corrigée dans le même
   lot.** Elle décrit aujourd'hui l'inverse de la décision 1 et promet un support
   qui n'existe pas. Sans cette correction, la fiche restant la cible de fin de
   projet (ADR-021 déc. 1), une session ultérieure reconstruirait la file de
   retrait en croyant solder du retard.
7. **Aucune reprise de données.** Rien à migrer : la sélection naît vide, et
   l'absence de file d'attente ne laisse aucun résidu.
8. **Cet ADR n'exige pas de spec d'exécution** (règle documentaire 4) : le
   chantier tient dans un lot unique.

## 3. Ce que cet ADR ne tranche pas

- **La fenêtre d'affichage d'un produit en vitrine** — permanente, par plage
  horaire, ou par jour. Une boulangerie ne montre pas les mêmes choses à 7 h et à
  17 h ; le besoin est reconnu, la forme n'est pas décidée.
- **Le comportement quand la sélection est vide.** Marque seule, repli sur autre
  chose, ou refus d'un enregistrement vide : à décider avant l'implémentation,
  jamais par défaut.
- **Le sort du bip sonore** que la fiche associait à l'annonce de commande prête.
  Il suit l'interrupteur de la décision 3 ; savoir s'il mérite son propre réglage
  n'est pas tranché.
- **La compensation du canal perdu.** L'appel de vive voix est le comportement de
  repli acté ; aucun autre dispositif — sonnerie de table, message, affichage
  ailleurs — n'est décidé ici.
- **Le mode « vitrine externe »** que la fiche porte à son backlog, pour un écran
  placé côté rue. Il reste au backlog et n'est pas confondu avec la présente
  décision, qui porte sur l'écran face caisse.
- **Le sort des autres promesses non tenues de la fiche** — animations de
  fidélité, QR de paiement, multilingue. Elles restent du backlog métier.

## 4. Révision

Les décisions 1 à 4 ne se rouvrent que par un nouvel ADR. La décision 3 est
délibérément réversible **par réglage** : allumer l'interrupteur ne demande aucun
ADR, c'est un geste d'exploitation. Rouvrir la décision 1 — rendre à la file
d'attente la place du repos — en demanderait un.
