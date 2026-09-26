# Consignes agents et preuves de validation

Procédure à valider par Mamat avant commit.

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

1. `node scripts/agents/doctor.mjs` : relever branche, SHA, worktrees,
   modifications, runtime, métadonnées pnpm, miroirs et fichiers d'environnement.
2. `node scripts/agents/context.mjs apps/backoffice/src/pages/orders` :
   rechercher le package et les tests candidats, puis ouvrir seulement les fichiers
   pertinents. Les résultats sont des pistes, pas une preuve de couverture.
3. Modifier la source autorisée après lecture des invariants et skills utiles.
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

`node scripts/agents/test.mjs packages/utils/src/__tests__/idr.test.ts`
exécute un fichier existant avec le Vitest déjà installé, sans installation.
Le rapport distingue réussis, échoués et ignorés. Aucun test exécuté, un rapport
absent, un code de sortie non nul ou une suite entièrement ignorée font échouer
la commande. Des tests ignorés restent à expliquer même si d'autres réussissent.

Les tests live appartiennent à `@breakery/supabase-tests`, pas au package client.
Ils exigent la cible dev explicite, les credentials et
`--allow-dev-mutations` **après accord de Mamat**. Ce drapeau n'est pas
une autorisation autonome. Ne pas lancer de tests live pour valider ces scripts.

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
