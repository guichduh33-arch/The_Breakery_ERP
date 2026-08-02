# ADR-021 — Fin de projet : la cible, l'ordre de traitement et le régime d'exécution

> **Date** : 2026-08-03
> **Statut** : ✅ Accepted (2026-08-03)
> **Décideurs** : propriétaire The Breakery (guichduh33)
> **Supersedes** : — (ne modifie aucun ADR ; fixe l'ordre dans lequel la dette
> laissée par ADR-003 à ADR-020 se solde)

## Contexte

De mai à août 2026, la V3 a été construite puis auditée module par module — stock,
production, rapports, clients, comptabilité, gouvernance documentaire. Ces audits
sont clos. Le projet n'est pas bloqué : il est **dispersé**. Ce qui reste à faire
vit dans quatre endroits qui ne se parlent pas — les fiches d'objectifs par
module, les ADR actés dont une partie n'est pas livrée, un second backlog produit
dans `docs/product/` jamais réconcilié avec les fiches, et des artefacts de
travail gitignorés qui portaient des décisions n'existant nulle part ailleurs
dans le dépôt.

Le 2026-08-02, un plan de fin de projet a été arrêté avec le propriétaire. Ce
plan vivait dans le profil utilisateur du poste de développement, **hors du
dépôt** : ni versionné, ni sauvegardé, ni protégé — la faiblesse même qui avait
déjà failli emporter les artefacts d'audit. Le présent ADR grave ce qui, dans ce
plan, relève de la décision.

Le découpage en lots numérotés, les estimations de durée et les listes de tâches
n'y figurent pas. Ce sont des outils de conduite : ils changent à chaque
livraison, et **un ADR ne se modifie jamais**. Pour mémoire et à titre de repère
daté, le plan du 2026-08-02 numérotait ces chantiers de 0 à 7 ; les lots 0 et 1.A
ont été livrés le 2026-08-03.

Un élément de contexte commande plusieurs des décisions ci-dessous : **la
boulangerie tourne sur un autre outil**. La V3 n'a jamais servi en réel, et la
base de développement ne contient que des données de test.

## 1. Décisions

### Décision 1 — La cible de fin de projet est la couverture fonctionnelle des fiches d'objectifs

La ligne d'arrivée du projet est la couverture fonctionnelle complète de
`docs/objectifs/` — dix-sept fiches au 2026-08-03. Ce sont elles qui font foi sur
ce qui est voulu, module par module.

**Pourquoi celles-là.** Le besoin métier était déjà écrit à quatre endroits ; en
choisir un seul comme cible est ce qui rend la fin de projet mesurable. Les fiches
sont le seul de ces gisements qui soit à la fois versionné, découpé par module et
rédigé en intention. `docs/product/DESCRIPTION.md` est un second backlog produit
qui n'a jamais été réconcilié avec elles : il **ne fait pas foi**, et sa
réconciliation appartient au chantier de vérité documentaire (décision 4).

**Aucune date n'est fixée.** Le critère est le chemin le plus court, pas une
échéance.

### Décision 2 — Base propre à la bascule : le code se corrige, les données de développement ne se réparent pas

Les données de la base de développement ne seront **pas** reprises. Cela vaut pour
tout écart d'historique constaté par les audits — écritures comptables mal
contrepassées, mouvements de stock sans écriture, écritures de taxe fantômes,
fiches de test mêlées au catalogue.

**Ce qui se fait à la place** : on corrige le code fautif, et on pose un test
anti-régression qui interdit la reproduction du défaut. Le fait constaté est
ainsi soldé pour l'avenir, sans payer une reprise de données.

**Pourquoi.** La V3 n'a jamais encaissé un vrai paiement. Réparer un historique
de test coûte le prix d'une reprise de production pour une valeur nulle : ces
lignes seront remplacées à la bascule, pas migrées. Cette décision est **bornée
par cet état** — elle tombe le jour où la V3 encaisse en réel, et le chantier de
bascule (décision 4, quatrième axe) est ce qui matérialise cette frontière.

### Décision 3 — Les artefacts de travail se convertissent, ils ne se versionnent pas bruts

Les fichiers de travail `.claude/audit-*.md` restent **gitignorés**. Ils ne sont
jamais versionnés en l'état.

Ce qu'ils contiennent se convertit selon sa nature : une décision du propriétaire
devient un **ADR** ; une intention métier devient une ligne de **fiche
d'objectifs** ; un geste d'exploitation devient un **runbook**. Ce qui ne rentre
dans aucune de ces trois formes n'avait pas vocation à survivre.

**Pourquoi.** Un rapport d'audit brut mélange trois registres — le constat daté,
l'intention, la décision — et seul le dernier engage. Le verser tel quel au dépôt
y installerait des affirmations sur le code qui pourrissent au premier renommage,
et une décision noyée dans un rapport n'est pas opposable.

**Conséquence assumée** : tant qu'une indétermination n'a pas trouvé sa forme,
elle n'existe pas dans le dépôt et ne survit pas à la session qui l'a relevée. Le
chantier de vérité documentaire (décision 4) est son point d'atterrissage.

### Décision 4 — Trois chantiers passent avant toute fonctionnalité nouvelle, dans cet ordre

**(a) Le filet d'intégration continue.** Il conditionne la vitesse de tout le
reste : sans lui, chaque livraison suivante est posée sans preuve, et un défaut
introduit ne se découvre qu'après fusion. Élargir le filet coûte une fois ; ne
pas le faire coûte à chaque chantier ultérieur.

**(b) La vérité documentaire.** Tant qu'une fiche décrit un objet qui n'existe
pas, ou déclare à faire ce qui est livré, « couvrir les fiches » vise une cible
mouvante. Ce chantier porte aussi la réconciliation du second backlog produit
(décision 1) et l'atterrissage des indéterminations (décision 3).

**(c) La dette d'ADR.** Une décision actée et non livrée est **un engagement
déjà pris**. Elle prime sur toute fonctionnalité nouvelle, quelle que soit
l'attractivité de cette dernière. C'est aussi le meilleur rapport entre valeur et
effort du projet : la conception y est faite, seule l'exécution manque.

Vient ensuite le gros œuvre fonctionnel, puis — hors des fiches, mais commandant
l'usage réel — **le chantier d'exploitation et de bascule** : environnement de
production, reprise depuis l'outil actuel, restauration éprouvée, déploiement du
front, conservation légale. Il n'est décrit par aucune fiche et ne doit pas
disparaître pour autant.

### Décision 5 — Les paliers fonctionnels sont coupables

Une fois les trois chantiers de la décision 4 soldés, la couverture fonctionnelle
se livre par paliers de gravité. **Le propriétaire arrête où il veut**, et
l'arrêt à un palier n'a aucune conséquence sur les paliers déjà livrés : chacun
laisse le produit dans un état cohérent.

**Pourquoi c'est une décision et non une évidence.** Elle interdit de rendre un
palier dépendant du suivant, donc de construire une infrastructure à moitié en
comptant sur un chantier ultérieur pour la finir.

### Décision 6 — Un chantier se termine par des preuves exécutées, jamais par une affirmation

Un chantier n'est livré que lorsque les preuves correspondantes ont été
**exécutées et montrées** :

- pour la base, des tests pgTAP, et **pour chaque garde ajoutée un test négatif**
  — un rôle non autorisé se fait refuser — pas seulement le cas passant ;
- pour le front, la suite de tests du paquet concerné, l'intégration continue
  restant le seul filet complet ;
- après tout changement de schéma, la **régénération des types** ;
- pour la sécurité, le rejeu des conseillers de la plateforme et la comparaison à
  l'état précédent ;
- de bout en bout, le parcours de l'argent, pour les chantiers qui le touchent.

Le régime de travail est le même à chaque chantier : **une branche dédiée, jamais
de commit direct sur la branche principale**, différence et tests montrés,
validation du propriétaire, puis fusion.

## 2. Conséquences

1. **Une demande de fonctionnalité nouvelle est différée** tant que les trois
   chantiers de la décision 4 ne sont pas soldés — y compris si elle paraît
   petite. C'est l'effet voulu.
2. **Un écart de données constaté dans un audit ne produit plus de chantier de
   reprise** (décision 2) : il produit une correction de code et un test.
   L'écart lui-même se note et s'oublie.
3. **Les fiches d'objectifs deviennent le contrat.** Une fiche fausse est un
   défaut au même titre qu'un défaut de code, et se corrige avant d'être
   utilisée comme cible.
4. **Un artefact de travail non converti est perdu**, par construction
   (décision 3). Convertir est un geste à faire pendant la session qui produit
   l'artefact, pas plus tard.
5. **Le présent ADR ne se met pas à jour** au fil des livraisons. L'état
   d'avancement vit hors du dépôt ; ce qui doit lui survivre devient un ADR
   nouveau.

## 3. Ce que cet ADR ne tranche pas

- **Le contenu des chantiers.** Il vit dans les fiches d'objectifs et dans les
  ADR non livrés, qui font foi chacun sur son domaine.
- **La numérotation des lots, leur durée et leur ordre interne.** Outils de
  conduite, hors dépôt.
- **Les arbitrages fonctionnels encore ouverts** — notamment la borne du stock
  négatif, la répartition de la taxe sur une addition partagée, les actions en
  masse sur les commandes, les permissions à seuil. Chacun demande son propre
  ADR, et le chantier de vérité documentaire (décision 4b) est l'endroit où ils
  se posent.
- **La date de bascule en exploitation réelle.** Elle borne pourtant la
  décision 2, et devra être décidée pour elle-même.
