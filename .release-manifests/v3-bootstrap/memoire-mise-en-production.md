# Mémoire locale de reprise — prochaine étape jusqu’à la production V3

Rédigée le 29 septembre 2026 à la demande explicite de Mamat.
Note versionnée à la demande de Mamat ; aucune valeur secrète. Ce fichier n’est pas une mémoire
automatiquement chargée par Codex : demander sa lecture dans un nouveau chat.
Cette demande autorise la rédaction et la conservation du parcours, pas son exécution
en production. Seules les validations explicitement consignées ci-dessous sont acquises.

## Pourquoi les projets Supabase sont séparés

Inventaire relu dans Supabase le 29 septembre 2026 : les trois projets suivants
existent, en région `ap-southeast-1`, avec le statut `ACTIVE_HEALTHY`.
Ce statut décrit la disponibilité du projet, pas la conformité de son schéma
ni sa préparation à l'exploitation en boutique.

| Projet et référence | Création observée | Rôle dans la préparation V3 |
|---|---|---|
| `the-breakery-v3-dev` — `ikcyvlovptebroadgtvd` | 13 mai 2026 | Développement et tests automatisés sur les données de test ; cible du pgTAP autorisé dans cette reprise. |
| `the-breakery-v3-rehearsal` — `getctmbpjnrrjzncaqze` | 26 septembre 2026 | Répétition isolée de l'installation et des parcours V3 : authentification, vente simulée, clôture et hub. |
| `the-breakery-v3-prod` — `yjhhhmjgsmyzyymvixot` | 26 septembre 2026 | Cible candidate destinée aux données réelles de la boutique après validation et initialisation approuvée. |

Le raisonnement de préparation est le suivant : dev contient les évolutions et
les données de test ; rehearsal sert à éprouver la procédure de livraison et
les parcours sur une cible distincte ; prod permet de préparer un démarrage
avec les seuls référentiels, comptes, soldes et stocks d'ouverture approuvés.
Une réussite sur dev ne prouve pas l'installation sur une autre cible ; une
répétition technique ne prouve pas le fonctionnement sur le matériel boutique.
Les historiques de ventes de test ne sont pas destinés à la production.

Ces projets séparent des environnements. Ils ne répartissent pas les fonctions
BO, POS et KDS entre trois bases indispensables au fonctionnement de la boutique.
La création de prod ne prouve ni son initialisation ni une bascule effective.
L'inventaire établit les dates de création, pas l'auteur ni le détail de
l'autorisation donnée à cette date.

La durée de conservation de rehearsal reste à décider avec Mamat. Son utilité
actuelle est la répétition encore incomplète ; aucun maintien permanent,
arrêt ou suppression n'est décidé par cette note. Avant une éventuelle fin
d'usage, identifier les essais et preuves encore nécessaires, notamment la
restauration sur une cible isolée autorisée. Aucune restauration réussie
n'est acquise ici. Dev et prod ont des rôles distincts après la bascule :
préparer les évolutions d'une part, exploiter les données réelles d'autre part.

## Validation et preuves de la reprise du 29 septembre 2026

- Mamat a validé le candidat `0567b0e37feeaf91ff8da7369f191e08315b3a59`
  et autorisé le lancement manuel pgTAP sur dev, sans suite connectée concurrente.
  Cette validation ne vaut pas autorisation de déploiement production.
- La PR [#546](https://github.com/guichduh33-arch/The_Breakery_ERP/pull/546)
  est fusionnée depuis le 29 septembre à 05:52:35 UTC ; son commit de fusion
  est le candidat ci-dessus. Master correspondait à ce SHA au lancement.
- La [CI push du candidat](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/36528249581)
  a réussi, avec `governance-guards` et `lint-typecheck-test-build` réussis.
- Le [pgTAP manuel du candidat](https://github.com/guichduh33-arch/The_Breakery_ERP/actions/runs/36531263503)
  a été lancé le 29 septembre à 06:28:44 UTC sur le SHA exact validé.
  Au contrôle effectué pour cette mise à jour : `classify` réussi, `pgtap`
  en cours, résultat `db-gate` non acquis. Relire le run avant de conclure.
- Aucun workflow GitHub actif ou en attente n'a été observé avant le lancement.
  Ce contrôle ne recense pas les éventuelles suites lancées hors GitHub Actions.
- L'étape 1 reste ouverte : le lancement des tests ne valide pas leur résultat,
  les empreintes des bundles ni leur concordance avec les corps SQL et les EF.
  Le checkout documentaire est distinct du candidat de livraison : le SHA
  validé ne désigne pas automatiquement les fichiers du répertoire de travail.

## Point de départ à préserver

- Verdict acquis : validé techniquement sur répétition, pas en boutique.
- Répétition : `getctmbpjnrrjzncaqze` ; dev : `ikcyvlovptebroadgtvd`.
- La V2 `abjabuniwkqpfsenxljp` ne reçoit jamais la lignée de migrations V3.
- Le manifeste désigne `yjhhhmjgsmyzyymvixot` comme cible candidate V3.
  Confirmer son usage production et son état réel avant toute écriture.
  Son observation vide du 26 septembre est historique, pas une preuve actuelle.
- PR #547 fusionnée : correction du PIN en header et des erreurs de période fiscale.
  Commit testé : `1ca809c2e663335f3937d318c3ac41f2860875e1`.
  Commit de fusion : `ff97e8e7ce2efce9ef139bee2742c79355b4563c`.
- Preuves historiques de #546 avant fusion, distinctes des preuves du candidat :
  Tête : `c3f296404a0e6064d7087796219ccdb1ed3a2545`.
  CI : `36525950895` ; pgTAP : `36525950823`, 270 fichiers réussis.
  L’erreur venait de l’absence du secret SQL dans le contexte Dependabot.
  Ne pas élargir les droits secrets pour contourner ce problème.
- Les deux fonctions corrigées ont été déployées sur répétition uniquement :
  `auth-verify-pin` et `process-payment`. Leur déploiement dev/production n’est pas acquis.
- Autorisation existante de `verify_jwt=false` limitée à la répétition pour
  `auth-verify-pin`, `auth-get-session`, `auth-logout`, `auth-session-activity`,
  `auth-change-pin`, `kiosk-issue-jwt`, `notification-dispatch`,
  `customer-birthday-notify`. Contrôles internes obligatoires.
  `process-payment` garde `verify_jwt=true` dans le déploiement vérifié.
- Essais réalisés : authentification BO/POS, vente simulée, clôture sans écart,
  hub HTTPS/WSS, registre/synchronisation, cache, révocation, origines et matériel simulé.
- La coupure navigateur a conservé session/panier mais le hub était déconnecté :
  elle ne certifie pas le paiement offline et son rejeu de bout en bout.
- Hub et serveurs de test arrêtés, appareils temporaires révoqués, secret hub
  temporaire retiré, données d’audit conservées. Ne pas copier les ventes de test en prod.
- Certificats localhost/127.0.0.1 de répétition expirant le 30 septembre 2026 :
  ne pas les réutiliser comme certificats boutique.

## 1. Arrêter le périmètre du candidat

- Le candidat incluant #546 est validé dans la section de reprise ci-dessus.
  Recontrôler master avant toute publication ; un nouveau SHA exige de renouveler
  les preuves nécessaires et de faire valider le candidat correspondant.
- Travailler depuis un checkout propre du SHA validé pour produire les artefacts.
- Rattacher les preuves et manifestes à ce SHA ; conserver les preuves historiques
  et distinguer le commit testé du commit de fusion.
- Comparer sources, lockfile, bundles, corps SQL live, droits et configurations EF.
  Le champ historique `sourceSha` du bootstrap n’est pas à lui seul la preuve finale.
- Rejouer les tests des composants/générateurs concernés selon les changements.
  Exiger CI push réussie et pgTAP manuel réussi sur ce même SHA de master,
  avec `pgtap` et `db-gate` réellement réussis, sans concurrence de suites sur dev.
  Les preuves PR existantes ne remplacent pas ce prérequis de publication.

Sortie attendue : SHA gelé, empreintes vérifiées, preuves CI complètes et rattachées.
Tout changement ultérieur de SHA impose de renouveler les preuves nécessaires.

## 2. Fermer les écarts d’authentification et de déploiement

- Vérifier l’état effectif du BO publié, des clients et des EF de chaque cible.
  Le passage à `x-login-pin` exige une livraison coordonnée EF/clients.
- Vérifier connexion, restauration de session, expiration, révocation, déconnexion,
  refus des PIN/secrets incorrects et droits par rôle.
- Préparer l’inventaire des secrets par nom et usage, sans leurs valeurs :
  signature JWT, hub, notifications et autres dépendances réellement utilisées.
- Soumettre les configurations gateway de production à validation explicite.
  Ne pas exporter automatiquement les exceptions `verify_jwt=false` de répétition.
- Maintenir le wrapper PIN JWT existant ; pas de `auth.setSession` ni de
  remplacement par un header Authorization brut dans les clients.

Sortie attendue : matrice clients/EF/configurations compatible et ordre de livraison validé.

## 3. Terminer la répétition fonctionnelle

- Exécuter vente et remboursement avec contrôle des autorisations puis rapprochement
  commande, paiement, stock, taxes et écritures comptables.
- Connecter réellement le navigateur au hub ; couper le WAN en maintenant le LAN.
- Tester les opérations offline autorisées, retry, redémarrage du navigateur et du PC,
  reconnexion, rejeu unique et drainage de l’outbox.
- Prouver absence de doublon et de vente perdue ; expliquer tout rejet sans supprimer
  les intents. Préserver la lecture des anciens formats d’outbox.
- Renouveler les certificats de test si nécessaire et vérifier TLS sans désactivation.
- Après essais, arrêter les services temporaires, révoquer appareils/sessions et
  retirer seulement les secrets temporaires créés pour ces essais ; conserver l’audit.

Sortie attendue : preuves de bout en bout, avec versions, dates, résultats et limites.

## 4. Préparer et faire approuver la boutique

- Inventorier PC, réseau LAN, noms/adresses stables, terminaux, KDS, écran client,
  imprimantes et tiroir ; faire valider les appareils, rôles et capacités.
- Préparer un certificat adapté au véritable hôte LAN, sa chaîne de confiance,
  sa distribution contrôlée, ses ACL, son renouvellement et son responsable.
  L’autorisation locale de répétition ne vaut pas installation de confiance en boutique.
- Fixer les origines HTTPS exactes et vérifier appairage, révocation, blocage local,
  registre persistant, présence, WSS et refus des appareils/origines non autorisés.
- Installer et éprouver le démarrage du hub et des services après reboot du PC.
- Faire les essais sur le matériel réel avec l’accord opérationnel de Mamat : tickets,
  cuisine, reçu et tiroir. Les simulateurs ne constituent pas cette recette.

Sortie attendue : recette signée par Mamat sur les vrais terminaux et le réseau retenu.

## 5. Préparer l’initialisation de la cible production

- Confirmer explicitement cible V3, propriétaire, état live et procédure d’initialisation.
- Revalider le snapshot de schéma, extensions, fonctions, RLS/grants, types et références.
  Comparer les corps live avant tout correctif ; aucune réparation du bookkeeping,
  aucun rejeu global des migrations, aucune purge implicite.
- Faire approuver les référentiels : catalogue/prix, unités, comptes et mappings,
  rôles/utilisateurs, configuration métier, taxes, période fiscale ouverte,
  soldes et stock d’ouverture. Clarifier toute donnée manquante avec Mamat.
- Séparer données de référence et historiques de test ; ne pas importer les fixtures
  transactionnelles de répétition.
- Préparer les secrets production hors Git, les paramètres timezone, stockage et tâches
  planifiées requis par le code ; valider séparément l’activation des notifications.
- Exécuter l’initialisation seulement après approbation de la procédure concrète,
  puis comparer schéma/droits/références et réaliser les contrôles post-initialisation.

Sortie attendue : cible autorisée, initialisée et vérifiée, avec preuves et inventaire.

## 6. Prouver sauvegarde, restauration et conduite d’incident

- Définir couverture réelle : DB, Auth, stockage, secrets, configuration et bundles LAN.
- Identifier responsable, accès, rétention, durée de reprise et perte maximale acceptée.
- Restaurer sur une cible isolée autorisée ; mesurer la durée et vérifier soldes,
  stocks, paiements et accès. Une sauvegarde seule n’est pas une preuve de restauration.
- Conserver les versions applicatives précédentes et démontrer leur compatibilité
  avec les contrats SQL/EF avant de promettre un retour de version.
- Définir l’arrêt des nouvelles écritures et la réconciliation des ventes réalisées
  après sauvegarde, y compris les files locales. Ne jamais les effacer ou rejouer aveuglément.

Sortie attendue : restauration éprouvée et procédure d’incident approuvée par Mamat.

## 7. Verrouiller le circuit de publication

- Contrôler les protections effectives master : PR obligatoire, pas de force-push ni
  suppression, contrôles de gouvernance, CI et db-gate requis.
- Configurer/vérifier l’environnement GitHub Production, ses approbateurs et branches.
- Vérifier que Vercel ne publie pas automatiquement en production à chaque push,
  tout en conservant les previews. Le refus HTTP 403 historique ne prouve aucun réglage.
- Valider le projet BO, son build monorepo et ses variables Production distinctes de Preview.
- Préparer les variables et secrets nommés dans le runbook ; activer RELEASE_ENABLED
  seulement après validation administrative et opérationnelle.
- Conserver l’arrêt volontaire de staging tant que sa procédure DB ciblée n’est pas validée.

Sortie attendue : protections prouvées et précontrôle de publication réussi.

## 8. Construire et préparer la livraison finale

- Construire BO, POS et print-bridge depuis le SHA final avec leurs configurations cibles.
- BO sur Vercel ; POS/KDS/écran client servis en LAN par le PC boutique.
- Générer puis vérifier les manifestes avec les scripts release : SHA, lockfile,
  empreintes et références de preuves. Vérifier aussi la cible réelle des bundles LAN.
- Conserver les artefacts et configurations de retour ; aucun fichier secret dans les bundles.
- Fixer avec Mamat l’ordre précis DB/EF/clients, la fenêtre de bascule et les responsables,
  compte tenu de la rupture de transport du PIN et des outbox existantes.

Sortie attendue : dossier concret de livraison, artefacts vérifiés et ordre validé.

## 9. Décision de mise en production puis bascule

- Présenter à Mamat : SHA, cible, preuves, recette boutique, restauration, écarts résiduels,
  critères d’arrêt et personnes responsables. Obtenir son go explicite.
- Avant bascule : contrôler sauvegardes, état des caisses/outbox, écritures en cours,
  soldes et stocks d’ouverture, période fiscale et accès opérateurs.
- Exécuter uniquement la séquence de déploiement approuvée.
- Publier le BO par production-backoffice.yml sur le SHA exact approuvé ; livrer les
  bundles locaux et configurations compatibles ; vérifier identités et santé des services.
- Effectuer les contrôles de connexion, droits, synchronisation et parcours métier
  autorisés en production, sans injecter arbitrairement de ventes fictives.

Sortie attendue : décision et publication tracées, fonctionnement réel confirmé.

## 10. Surveillance initiale et clôture

- Surveiller erreurs BO/POS/EF, heartbeat, registre, impressions, files offline et paiements.
- Rapprocher les premières opérations réelles et la première clôture : commandes,
  paiements, caisse, stock, taxes et comptabilité.
- En anomalie, appliquer les critères d’arrêt validés et préserver les preuves et ventes.
- Confirmer sauvegardes, alertes, renouvellement TLS et responsabilité d’exploitation.
- Conserver le dossier final des empreintes, déploiements et validations.
  Signaler les écarts documentaires ; toute correction/commit documentaire suit
  la validation explicite de Mamat, sans modification automatique des ADR.

## Sources et reprise

- Procédure : docs/runbooks/production-v3-cutover.md, encore marquée préparatoire.
- Contrôles exécutables : .github/workflows/production-backoffice.yml et
  scripts/release/{preflight,manifest,verify-build}.mjs.
- Preuves locales : .release-manifests/v3-bootstrap/manifest.json et local-rehearsal/.
- Les résultats antérieurs de cette note reprennent la session ; les états distants
  doivent être relus avant exécution, ils ne sont pas rafraîchis par la rédaction.
- Première action de reprise : relire le résultat du pgTAP manuel du candidat
  validé, puis terminer les preuves et comparaisons de l'étape 1. Ne pas relancer
  une suite déjà active ni assimiler les preuves PR aux preuves du SHA de master.

Phrase de reprise : « Lis .release-manifests/v3-bootstrap/memoire-mise-en-production.md,
vérifie l’état courant et reprends à la première étape non validée. »
