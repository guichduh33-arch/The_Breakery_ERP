# pos-design-craft — contrôles et sources

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Vérification visuelle et recherche ciblée

## Vérification visuelle et recherche ciblée

Respecter le navigateur explicitement choisi. Sinon, suivre `playwright-fr` et la copie locale de `playwright-cli` ; utiliser seulement les capacités effectivement disponibles dans la session. L’absence du MCP Playwright ne dispense pas de vérifier le rendu avec un outil disponible.

1. Rendre la surface sur le serveur POS (`pnpm --filter @breakery/app-pos dev`) ou la maquette HTML, aux dimensions des appareils concernés : caisse, tablette portrait/paysage, KDS ou display.
2. Mesurer avec `getBoundingClientRect()` les cibles et espacements du Pilier 1 ; lire `getComputedStyle()` pour les couleurs. Calculer le contraste WCAG avec composition des alphas jusqu’au fond opaque : comparer deux couleurs translucides brutes donne un faux ratio. Viser AAA sur les chiffres, AA ailleurs.
3. Vérifier `scrollWidth > innerWidth`, états et lisibilité ; joindre les captures utiles et les mesures. Si la capture n’est pas récupérable, fournir les mesures et le snapshot sans inventer une preuve visuelle.
4. Corriger les défauts observés puis recontrôler les cas concernés avant de conclure. Une inspection de code ne vaut pas une validation visuelle ; si le navigateur est bloqué, nommer ce qui reste non vérifié.

Pour une décision visuelle structurante, rechercher des références publiques si nécessaire, en tirer des principes et mesures, jamais du code ou des assets copiés. Ne pas rafraîchir tout un benchmark pour un ajustement local.

---
