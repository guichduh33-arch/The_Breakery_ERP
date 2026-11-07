# Procédure commune de modification et de livraison

Cette procédure organise le travail autorisé par Mamat. Les règles restent dans
[AGENTS.md](../../AGENTS.md), les décisions dans les [ADR](../adr/) et les formats
de preuve dans l’[outillage agents](agent-tooling.md). Un résultat de test ne
prouve ni une publication, ni une installation, ni une opération physique.

## Démarrer sur un état connu

1. Lire l’objectif, ses restrictions et les messages de coordination des sessions
   actives. Désigner un écrivain par périmètre ; réserver les objets DB et le
   créneau des tests connectés avant toute mutation partagée.
2. Actualiser `origin/master`, puis relever branche, SHA, index, fichiers suivis,
   non suivis et worktrees. Ne jamais nettoyer un dossier pour faire disparaître
   un état inconnu. Le diagnostic ne lit pas les valeurs des secrets :
   `node scripts/agents/doctor.mjs`.
3. Reprendre la branche utile lorsqu’elle existe. Sinon, créer un worktree isolé
   depuis le master actualisé et une branche consacrée au sujet. Le dossier
   principal ne sert pas implicitement de base quand il contient un ancien état.
4. Relever le périmètre avec
   `node scripts/agents/pipeline.mjs inspect --base origin/master` et conserver
   son SHA de base. Lire les skills et les corps des ADR concernés ; ouvrir les
   sources et les tests candidats plutôt que tous les documents du dépôt.

Le point d’entrée des observations opérationnelles est l’[état des
environnements](etat-environnements.md). Ses dates ne certifient pas l’état du jour.

## Choisir les contrôles utiles

| Changement | Boucle locale | Validation avant livraison |
|---|---|---|
| Documentation et consignes | Liens, miroirs et gardes concernés ; tests Node si outillage modifié | Contrôles GitHub requis et revue documentaire |
| Back-office | Tests du parcours et lint des fichiers modifiés ; typage concerné | Suite BO complète, CI du candidat et recette du parcours |
| POS, tablette ou bridge | Tests du parcours et invariants concernés ; typage | Couverture POS requise en CI, paquet exact et recette sur la surface concernée |
| Domaine ou composant partagé | Tests directs et appelants BO/POS | Suites des applications affectées et contrôles d’intégration |
| Schéma, RPC ou Edge Function | Contrat, droits, refus, idempotence et tests ciblés sur DEV autorisée | pgTAP applicable, types régénérés, appelants et candidat final vérifiés |
| Prix, paiement, stock ou droits | Scénario nominal, refus et reprise après réponse incertaine | Contrôles métier complets ; aucune dispense fondée sur la taille du diff |

Le diagnostic `node scripts/ci/ci-scope.mjs --base origin/master` décrit le diff
committé : chemins documentaires ou code/outillage, base et SHA exacts. Il est
informatif et ne retire aucun job obligatoire. Un chemin inconnu n’est pas
assimilé à une simple modification documentaire.

La CI conserve ses protections : gardes, lint des fichiers touchés, typage,
tests sélectionnés par le graphe des packages, build et contrôle final agrégé.
Les suites BO, POS et partagées sont indépendantes ; un échec ne masque pas les
résultats des autres voies. Une modification de cet outillage force sa propre
validation complète sur PR. Les push master gardent la suite complète.

## Corriger sans multiplier les suites complètes

- Pendant l’édition, exécuter le test qui reproduit le défaut et les tests voisins
  découverts dans les pages **et** les features. Un nom de composant n’est pas un
  filtre fiable de nom de fichier. Le lanceur ciblé refuse un fichier absent ou
  une suite sans test réussi : `node scripts/agents/test.mjs <fichier-test>`.
- Après stabilisation, exécuter les contrôles complets applicables et rattacher
  leurs rapports au candidat. Ne pas relancer une suite réussie sans raison :
  code, base, configuration, dépendances ou environnement modifiés ; échec nouveau ;
  preuve incomplète ; ou doute concret sur sa portée.
- La réutilisation conserve le SHA, la base, la commande, le rapport et la cible.
  Une fusion ou une nouvelle base impose de revalider les conclusions affectées.
  Un test connecté peut devenir périmé sans changement de code : l’état DB compte.
- Ne pas remplacer une vérification complète applicable par un test ciblé, un
  rapport ancien, un cache de fichier personnel, une review ou un résultat ignoré.
- En cas d’échec d’environnement, conserver le diagnostic. Ne pas élargir un
  timeout ou ignorer un test pour obtenir du vert ; vérifier la cause et utiliser
  une surface capable d’exécuter le scénario concerné.

Le résumé CI donne les durées, le premier pas en échec et les liens vers les
jobs. Le résumé des tests indique la commande reproductible. Mesurer le délai
de bout en bout séparément de la somme des minutes de runners parallèles.

### Arrêter la commande sur erreur

Dans PowerShell, un point-virgule poursuit la commande suivante après un échec.
Avant un commit, push ou déploiement, contrôler explicitement le code de sortie :

```powershell
node --test scripts/ci/ci-pipeline.test.mjs
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
git diff --check
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
```

Le code nul d’une dernière commande ne valide pas les commandes précédentes.
Conserver les nombres réussis, échoués et ignorés ; expliquer les exclusions.

## Préparer la PR

1. Relire le diff depuis la base, y compris les fichiers nouveaux. Vérifier
   secrets, fichiers générés, changements étrangers au sujet et invariants métier.
2. Faire l’audit agents obligatoire et la revue indépendante. Une documentation
   factuellement périmée se corrige ; une décision non implémentée reste du backlog.
3. Vérifier les miroirs et les gardes applicables. Committer seulement le sujet,
   sur sa branche ; ne pas transformer un commit de fusion pour y cacher un fix.
4. Pousser un candidat relisable et ouvrir sa PR. Donner problème, résultat,
   contrôles exécutés, ignorés et limites. Une simple présence de fichier de test
   n’est pas une preuve d’exécution.
5. Attendre les contrôles requis, puis intégrer dans le créneau coordonné.
   Avant de faire évoluer master, vérifier qu’un autre candidat de production
   n’attend pas encore son contrôle ou sa publication sur le SHA exact.

## Sérialiser les opérations partagées

DEV est une base commune. Les suites pgTAP, tests live, E2E mutatifs, répétitions
et migrations ne se lancent pas concurremment sur les mêmes fixtures. Annoncer
le responsable, le candidat et le créneau ; vérifier la fin effective d’un run
avant le suivant. L’annulation demandée d’un job n’en prouve pas la fin.

Le workflow nocturne comporte une programmation dans Git. Vérifier aussi son
état d’activation GitHub et ses derniers résultats : le calendrier déclaré ne
prouve pas qu’il s’exécute. La publication BO garde son contrôle DB du candidat
final, même après une PR front seule. Cette procédure ne le supprime pas.

Regrouper, lorsque les contrôles le permettent, les changements indépendants déjà
validés avant de figer le candidat final, pour éviter de recommencer une validation
exacte simplement parce qu’une fusion sans lien métier est intervenue trop tard.
Cela n’autorise ni à passer une PR rouge, ni à utiliser une preuve d’un autre SHA.

## Livrer et vérifier l’usage

- Identifier les composants à livrer : DB, fonctions, BO, bundle LAN, bridge ou APK.
  Une modification de tests ou de documentation n’exige pas une installation
  applicative. Une fusion seule ne prouve pas la mise en place d’un composant.
- Avant toute écriture DB, relire l’objet réel de la cible et préserver les corps
  publiés. Appliquer la procédure ciblée du domaine ; ne pas rejouer arbitrairement
  l’historique cloud. Réconcilier les types et les appelants dans le même lot.
- Construire et identifier le paquet destiné à l’environnement demandé. Le paquet
  CI à configuration factice ne se publie pas en production. Conserver manifeste,
  empreinte, cible compilée, provenance et gestes de retour réellement disponibles.
- Pour une caisse ou tablette, vérifier le bundle exact puis la version réellement
  chargée avant les interactions. Conserver configuration et outbox. Les essais de
  paiement ou les opérations physiques restent limités au mandat et au créneau.
- Contrôler après livraison le parcours réel et les données attendues. Distinguer
  lecture d’API, navigateur, téléchargement récupéré, appareil observé et papier.

## Clore, réconcilier et nettoyer

La clôture restitue résultat, commits/PR, cibles, contrôles et limites. Un snapshot
de conservation protège un état ; il ne remplace pas son examen fonctionnel.

Pour chaque reliquat ou branche :

1. Comparer les changements au master actuel et retrouver leurs intégrations,
   y compris les squash et réimplémentations. Tester les vrais résiduels utiles ;
   livrer les correctifs nécessaires, sans recopier les anciennes versions entières.
2. Vérifier les fichiers suivis, non suivis, ignorés, stashes et worktrees. Conserver
   les preuves privées et les artefacts de retour nécessaires ; ne pas les publier
   avec le code. Aucun nettoyage ne se déduit du seul âge d’un dossier.
3. Identifier les sessions actives et les PR encore utiles. Une fonction métier
   incomplète, un prototype ou un test non réconcilié reste un chantier nommé,
   pas une branche inutile à supprimer ni un candidat à déployer automatiquement.
4. Quand le contenu est intégré ou prouvé redondant et qu’aucun travail local ne
   serait perdu, retirer la référence inutile. Détacher au même commit un ancien
   worktree seulement après vérification ; ne pas supprimer ses preuves ignorées.
5. Pour supprimer un répertoire, vérifier son chemin absolu et l’absence de travail
   ou d’artefact nécessaire. Réexaminer la liste après le dernier retrait et vérifier
   les gestes de retour annoncés. Ne jamais utiliser un nettoyage Git global.

L’inventaire standard est `node scripts/agents/inventory.mjs --base origin/master`.
Il décrit les références locales et les équivalences observées ; actualiser aussi
le distant et les PR avant de conclure. Il ne supprime rien et ne décide pas
qu’une intention métier est abandonnée.
