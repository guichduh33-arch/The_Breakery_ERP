---
name: playwright-fr
description: >-
  Piloter ou vérifier le POS/BO dans un navigateur depuis le terminal : Playwright CLI, capture, parcours UI et E2E. Respecter le navigateur ou l’outil explicitement choisi ; ne pas ouvrir un second workflow concurrent.
---

# Pilotage de navigateur — aiguillage

Le contrat du CLI reste dans sa copie fournie par l’outil. Le CLI
`playwright-cli` compare `.claude/skills/playwright-cli/SKILL.md` **octet par octet**
avec sa copie embarquée et affiche un bandeau d'avertissement à chaque commande dès que
le fichier diffère. On ne peut donc pas enrichir la `description` de cette skill-là sans
polluer toutes les sorties. Les déclencheurs vivent ici, la procédure reste là-bas.

**Marche à suivre : lire la copie du dépôt de [playwright-cli](../playwright-cli/SKILL.md) et la suivre pour le pilotage depuis le terminal. Respecter un navigateur ou un outil explicitement choisi par Mamat ; ne pas lancer en parallèle un second workflow de navigateur.**

Rappels propres au projet, à appliquer par-dessus :

- **URLs avec `&` sous PowerShell** : `playwright-cli --% goto "https://…?a=1&b=2"`,
  sinon l'URL est tronquée au premier `&`. Concerne les écrans POS/BO à query params.
- **Ports E2E** : POS sur `5173`, back-office sur `5174` (voir `playwright.config.ts`).
- **Artefacts** : `.playwright-cli/` est déjà ignoré par git — ne rien committer de là.
- **Après une mise à jour du CLI**, `playwright-cli install --skills=agents` met à jour la copie Codex ; `--skills` vise la copie Claude. Vérifier les chemins annoncés avant d’exécuter la commande : elle réécrit
  `.claude/skills/playwright-cli/` : le diff se relit et se valide comme tout autre
  changement du repo.

Pour une session courte, préférer une recherche ou un snapshot ciblé au DOM complet ; ne capturer une image que pour vérifier un rendu. Réutiliser la session navigateur existante. Les résultats d’un test ne valent que pour les viewports et états effectivement exercés.

Un avertissement de version peut venir des fins de ligne : comparer le contenu avec la copie embarquée, puis normaliser CRLF/LF avant de conclure à une version obsolète. Ne pas réinstaller automatiquement.
