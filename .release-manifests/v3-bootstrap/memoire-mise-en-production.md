# Mémoire locale de reprise — prochaine étape jusqu’à la production V3

Rédigée le 29 septembre 2026 à la demande explicite de Mamat.
Note versionnée à la demande de Mamat ; aucune valeur secrète. Ce fichier n’est pas une mémoire
automatiquement chargée par Codex : demander sa lecture dans un nouveau chat.
Cette demande autorise la rédaction et la conservation du parcours, pas son exécution
en production. Les validations mentionnées ci-dessous restent à obtenir.

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
- Dernier état connu de #546 : ouverte, fusionnable, CI et pgTAP verts ; non fusionnée.
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

- Relire l’état GitHub de #546 et de master ; décider avec Mamat si #546 entre
  dans cette release. Ne pas la fusionner au titre de cette note.
- Fixer ensuite le SHA complet final de master et travailler depuis un checkout propre.
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
- Première action de reprise : vérifier #546 et master, puis faire arrêter le périmètre
  exact du candidat avant de produire les preuves finales sur master.

Phrase de reprise : « Lis .release-manifests/v3-bootstrap/memoire-mise-en-production.md,
vérifie l’état courant et reprends à la première étape non validée. »
