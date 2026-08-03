---
name: playwright-fr
description: >-
  Déclencheurs francophones et propres au projet pour le pilotage de navigateur. Use this
  skill whenever the user wants to open or drive a browser from the terminal, screenshot a
  page, verify the POS/BO UI in a real browser, run or debug Playwright E2E tests — or
  mentions playwright, E2E, screenshot / capture d'écran, teste dans le navigateur, vérifie
  la page, ouvre la caisse dans le navigateur, regarde l'écran. Prefer it over ad-hoc npx
  playwright commands.
---

# Pilotage de navigateur — aiguillage

Cette skill ne contient aucune procédure. Elle existe pour un seul motif : le CLI
`playwright-cli` compare `.claude/skills/playwright-cli/SKILL.md` **octet par octet**
avec sa copie embarquée et affiche un bandeau d'avertissement à chaque commande dès que
le fichier diffère. On ne peut donc pas enrichir la `description` de cette skill-là sans
polluer toutes les sorties. Les déclencheurs vivent ici, la procédure reste là-bas.

**Marche à suivre : invoquer la skill `playwright-cli` et la suivre.**

Rappels propres au projet, à appliquer par-dessus :

- **URLs avec `&` sous PowerShell** : `playwright-cli --% goto "https://…?a=1&b=2"`,
  sinon l'URL est tronquée au premier `&`. Concerne les écrans POS/BO à query params.
- **Ports E2E** : POS sur `5173`, back-office sur `5174` (voir `playwright.config.ts`).
- **Artefacts** : `.playwright-cli/` est déjà ignoré par git — ne rien committer de là.
- **Après une mise à jour du CLI**, `playwright-cli install --skills` réécrit
  `.claude/skills/playwright-cli/` : le diff se relit et se valide comme tout autre
  changement du repo.
