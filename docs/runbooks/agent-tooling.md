# Consignes agents et preuves de validation

Procédure initiale validée le 8 octobre 2026. Mandat d’autonomie fixé par Mamat
le 2 novembre 2026 : l’objectif autorise la procédure nécessaire de bout en bout,
dont l’agent principal assume les validations, sans approbation intermédiaire.

## Sources et miroirs

| Source à modifier | Sortie générée |
|---|---|
| `AGENTS.md` | `CLAUDE.md` |
| `.agents/skills/` | `.claude/skills/` |
| `.claude/agents/*.md` | `.codex/agents/*.toml` |

Les skills tiers `playwright-cli` et `impeccable` sont exclus de la génération :
leur mise à jour reste indépendante. Ne pas remplacer leurs fichiers par une copie
métier. Les profils Markdown conservent leur format Claude ; seuls le nom, la
description et les consignes deviennent un profil Codex, pas le modèle ni les outils.

Le générateur adapte les références AGENTS/CLAUDE dans les skills et rôles et
le chemin du CLI Playwright dans le skill français. Les liens Impeccable pointent
vers sa copie canonique, sans créer de copie Claude. Le miroir racine conserve
l'identité des sources communes ; seul son titre et le co-auteur sont adaptés.
Aucune adaptation métier implicite n'est permise.

## Boucle de travail

Depuis la racine, avec Node installé :

Pour une reprise de livraison ou d'environnement, commencer aussi par
l'[état des environnements](etat-environnements.md) et ses preuves datées.
Le document désigne des observations ; il ne dispense pas de vérifier la
cible et l'artefact réellement chargé avant une action qui en dépend.

1. `node scripts/agents/doctor.mjs` : relever branche, SHA, worktrees,
   modifications, runtime, métadonnées pnpm, miroirs et fichiers d'environnement.
2. `node scripts/agents/context.mjs apps/backoffice/src/pages/orders` :
   rechercher le package et les tests candidats, puis ouvrir seulement les fichiers
   pertinents. Les résultats sont des pistes, pas une preuve de couverture.
3. `node scripts/agents/pipeline.mjs inspect --base origin/master` : relever le
   périmètre et les rôles/preuves suggérés, puis modifier la source autorisée
   après lecture des invariants et skills utiles.
4. `node scripts/agents/sync.mjs --write`, puis `--check`.
5. Exécuter les suites Node listées dans le job de gouvernance de
   [ci.yml](../../.github/workflows/ci.yml), dont les scénarios agents,
   le contrôle DB et les manifestes de release.
6. Exécuter les validations adaptées au changement ; présenter résultats,
   exclusions et limitations séparément.

Le diagnostic n'installe rien, n'exécute aucun test, ne supprime aucun worktree et
ne lit pas les valeurs des secrets. La version pnpm installée est déduite de
`node_modules/.modules.yaml` : ce n'est pas une exécution du binaire global.
Un worktree inaccessible est signalé comme tel, jamais déclaré propre.

La génération refuse les fichiers miroirs devenus orphelins : leur suppression
doit être examinée et autorisée, jamais automatique. Le contrôle CI échoue
sur toute divergence. Les profils de contexte restent des inventaires :
[recherche ciblée et profils](../context-profiles.md).

## Preuves de test

### Circuit commun et diagnostic de livraison

Le circuit et les limites de travail simultané sont définis dans
[AGENTS — Circuit de livraison commun](../../AGENTS.md#circuit-de-livraison-commun).
Les profils métier existants interviennent selon le diff ; le testeur produit
les preuves et le reviewer reste indépendant. Aucun profil supplémentaire de
coordination n’est créé. La continuité repose sur les profils, pas sur la mémoire
d’une instance d’agent.

`node scripts/agents/pipeline.mjs inspect --base origin/master` affiche le SHA,
la base résolue, les chemins modifiés, la présence de travail local et les contrôles
requis. Les chemins partagés déclenchent prudemment BO et POS. L’agent doit ajouter
les vérifications métier nécessaires : le routage par fichier ne peut pas établir
à lui seul la couverture d’un paiement, d’une permission ou d’un mouvement de stock.
La CI conserve ce diagnostic comme artefact ; elle ne le présente pas comme une
validation des étapes déclaratives ou de la production.

`node scripts/agents/inventory.mjs --base origin/master` relève les branches
locales et refs origin en cache, worktrees, changements non suivis et stashes.
Il ne fait pas de fetch : actualiser la référence et lire GitHub avant de conclure
sur le distant. Son code de sortie est non nul si un worktree est inaccessible.
Une équivalence de patch ne prouve ni livraison, ni absence de modifications locales.
Les chemins du parent non suivi d’un stash sont aussi listés. Les fichiers ignorés
et le contenu fonctionnel des stashes exigent un examen séparé.
L’outil ne propose aucune suppression automatique.

### Vérification des preuves enregistrées

`node scripts/agents/pipeline.mjs check --base origin/master --stage dev-verified
--evidence .release-manifests/delivery/evidence.json` vérifie les preuves fournies.
Les commandes ci-dessus sont à saisir sur une seule ligne. `--output` peut créer
un rapport neuf sous `.release-manifests/delivery/` ; un fichier existant n’est
jamais écrasé. Ces données locales ignorées sont des preuves factuelles, pas un
plan de session ni une mémoire. Leur transfert privé reste distinct d’un clone Git.

Format de l’enveloppe : `schemaVersion: 1`, `fingerprint` fourni par `inspect`,
et tableau `checks`. Les identifiants, étapes, rôles et cibles attendus sont
affichés dans `policy.checks`. Chaque preuve porte `id`, `status: "passed"`,
`actor`, `reference`, `observedAt` au format ISO et `target`. Dev/production
exigent aussi `targetFingerprint`, qui identifie l’état ou le paquet observé.
Les assertions SQL déclarent `passed` et `failed`; les exclusions restent explicites.
Pour un lot sans composant applicatif, les contrôles de publication, déploiement
et recette autorisent `status: "not-applicable"` avec `reason`, acteur, date,
référence et cible. Le diagnostic indique `allowNotApplicable`. Cela ne permet
jamais d’écarter une suite BO/POS ou une preuve DB applicable.

Pour un contrôle de commande, ajouter `command`, `exitCode`, `report` (chemin
relatif interne), `reportSha256` (empreinte exacte des octets). Le lecteur refuse
un rapport absent, vide, externe, altéré ou un code non nul. Les preuves Vitest
utilisent le rapport JSON natif ; les preuves Node utilisent le reporter TAP.
Aucun test réussi ou une suite entièrement ignorée ne vaut validation ; des tests
ignorés parmi d’autres exigent `skipReason`. Le testeur vérifie aussi que le
rapport correspond à la suite attendue : le format seul ne garantit pas la portée.

L’agent choisit `--target production|dev|none` selon la demande et ses restrictions,
avec `production` par défaut. `dev` exige les observations de livraison sur dev ;
`none` représente une demande sans livraison applicative et permet de motiver sa
non-applicabilité. Les suites applicables restent requises. La cible fait partie
de l’empreinte : changer de destination invalide les preuves existantes. Ce choix
ne contourne jamais une restriction utilisateur ni une protection de plateforme.

Les contrôles GitHub utilisent `runId`, `GITHUB_REPOSITORY` et `GITHUB_TOKEN`
fournis par l’environnement, jamais dans le fichier. Le lecteur vérifie par GET
le dernier run CI push du SHA et ses jobs obligatoires. Sans accès, la preuve
reste bloquée. Il ne remplace pas le preflight BO qui exige aussi la preuve DB
du candidat et les protections de publication.

Un checkout sale, un rattachement SHA/base/périmètre périmé ou une preuve requise
manquante bloque `check`. Une empreinte ne prouve pas l’auteur ni la date réelle
d’exécution d’un rapport : les attestations restent des déclarations à vérifier
contre leurs sources. L’état DB actuel, la revue métier, le respect de la demande
et l’installation physique ne sont pas certifiés par ce lecteur.

Les étapes acceptées sont `scoped`, `dev-verified`, `reviewed`, `integrated`,
`ready`, `deployed`, `verified`, `closed`. Les conditions sont cumulatives. Un
changement de SHA/base exige un nouveau rattachement des preuves affectées, y
compris après fusion. Conserver le SHA de base du lot affiché avant intégration
et l’utiliser ensuite dans `--base <SHA>` : `origin/master` actualisé peut devenir
égal à HEAD et effacer le diff du lot. Un périmètre vide bloque toute validation
au-delà de `scoped`, plutôt que de retirer silencieusement les contrôles métier.
Le lecteur ne lance ni commande de test, ni écriture DB,
ni publication, ni installation. Les tests connectés restent manuels, autorisés
et non concurrents sur les fixtures partagées, selon les règles existantes.

Le diagnostic worktree affiche au plus dix exemples de changement par défaut,
avec `statusTotal` et `statusTruncated`. `doctor.mjs --verbose` affiche le détail.
`inspectionComplete: false` signale au moins un worktree inaccessible. Un
succès mesure les miroirs et la version pnpm installée, pas la propreté ni
l'accessibilité complète des checkouts. Les tests transverses de l'outillage
agents sont proposés explicitement par `context`, puis complétés par ses
heuristiques ; une liste vide ne prouve jamais l'absence de couverture.

`node scripts/agents/test.mjs packages/utils/src/__tests__/idr.test.ts`
exécute un fichier existant avec le Vitest déjà installé, sans installation.
Le rapport distingue réussis, échoués et ignorés. Aucun test exécuté, un rapport
absent, un code de sortie non nul ou une suite entièrement ignorée font échouer
la commande. Des tests ignorés restent à expliquer même si d'autres réussissent.

Les tests live appartiennent à `@breakery/supabase-tests`, pas au package client.
Ils exigent la cible dev explicite, les credentials et
`--allow-dev-mutations` lorsque ces opérations sont nécessaires à l’objectif
demandé et que ses restrictions le permettent. Ce drapeau ne définit pas le mandat.
Ne pas lancer de tests live pour valider ces scripts.

Une suite ciblée ne remplace pas la suite BO complète lorsqu'on touche le BO,
ni la CI POS complète. La review indépendante ne remplace jamais les tests.

## Scénarios de routage et limites

`node --test scripts/agents/scenarios.test.mjs` vérifie les parcours BO, POS,
migration, test live et release sur des fixtures locales. Il contrôle le package,
les tests candidats et les limites présentes dans les profils sources. Il ne
mesure pas à lui seul la qualité d'un agent exécutant une tâche métier.

Pour la revue en lecture seule, utiliser un chemin réel de chaque parcours,
comparer les candidats aux fichiers existants et relever les commandes erronées,
les lectures inutiles et les preuves manquantes. SQL n'est pas Vitest ; une
recherche vide n'est pas une preuve d'absence de tests. Les fichiers non suivis
non ignorés doivent rester visibles. Ne lancer aucun test cloud pour cette revue.

## Reprise et clôture d'un lot

Le bilan conversationnel indique le résultat, les décisions validées,
commits/PR, environnement, tests exécutés et ignorés, installations observées,
limites et travail restant. Rattacher chaque preuve à une date, une cible et
un SHA ou artefact. Distinguer commit, bundle construit, publication et
installation ; une étape réussie ne certifie pas la suivante.

Si le bilan mérite une conservation Git, l’agent vérifie et fait relire son texte
factuel dans le document opérationnel concerné, puis le commite dans le mandat.
Aucune validation documentaire intermédiaire de Mamat n’est requise. Ne pas
enregistrer un plan de session. Les décisions durables passent par un ADR qui
restitue la demande sans inventer d’arbitrage métier. Aucun hook n’écrit
automatiquement un bilan ou une mémoire.

Une nouvelle session vérifie Git et les sources citées, puis les résultats
distants avant reprise. Une ancienne mémoire contraire à un fait actuel est
un indice à revalider ; une décision ADR non implémentée reste du backlog.
Sans source durable d'une décision verbale, annoncer la limite et demander
l'information avant l'action dépendante. Un clone ne récupère pas les preuves
privées, les accès, les artefacts ignorés ou l'historique local du client.
