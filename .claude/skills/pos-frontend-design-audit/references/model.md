# pos-frontend-design-audit — modèle, contrats et repères

Complément de [SKILL.md](../SKILL.md). Lire les sections nécessaires au parcours indiqué dans l’entrée ; les contrôles applicables restent obligatoires. Les relevés datés sont des points de départ à recouper, pas une certification du code actuel. Les chemins de code sont relatifs au dépôt ; les chemins nus `references/` désignent le dossier du skill. Les liens Markdown sont relatifs à ce fichier.

## Repères

- Contexte et conventions
- Source de vérité & ce qu'on NE fait PAS

# POS Frontend Design Audit — The Breakery (caisse + tablette serveur)

Auditeur du **design frontend** du module POS : l'aspect visuel, l'ergonomie tactile, la hiérarchie de l'information, la cohérence du design-system, la couverture des états, et la vitesse de manipulation au doigt — pour deux profils aux contraintes opposées : la **CAISSE** (poste comptoir, rush, encaissement < 1 min) et les **WAITER** (tablette de salle, prise de commande debout).

**Une seule base de code, deux empaquetages** : `apps/pos` est une **web app Vite**. La caisse la sert dans un navigateur — **il n'y a ni Tauri ni Electron dans le dépôt**. La tablette de salle sert la même app empaquetée **Capacitor Android** (ADR-029). Ne raisonne donc jamais en « app desktop native » : pas de fenêtre système, pas de menu OS. Le seul delta natif est côté WAITER (safe-areas, barre gestuelle Android, clavier tactile système).

Trois missions, dans cet ordre :

1. **AUDITER l'état actuel du code** et détecter les lacunes ergonomiques, visuelles et d'interaction. Le code (`apps/pos/src`) est la **source de vérité** — il est plus avancé que les maquettes et que l'objectif V2 archivé.
2. **COMPARER à l'état de l'art** des leaders POS restaurant, écran par écran, pour situer la maturité et importer les bons patterns.
3. **PROPOSER** des améliorations concrètes — esprit à la fois **critique, créatif et pragmatique** — classées par impact/effort, prêtes à devenir des tickets, distinguant CAISSE et WAITER.

**Livrable : un rapport EN FRANÇAIS rendu DANS LA CONVERSATION** (voir « Format du rapport ») pour que le skill **`pos-frontend-design-implement`** développe les propositions retenues **dans la même session**. **Aucun fichier n'est créé** — règle 1 de `CLAUDE.md`.

⚠️ **Un audit se scope pour tenir dans une session.** Le périmètre est une **zone ou un écran** (`caisse`, `waiter`, grille produits, écran de paiement, stock vitrine…), jamais « tout le POS ». Un audit qui déborde de sa session est **mal scopé** : réduis le périmètre, ne cherche pas à le faire survivre.

## Source de vérité & ce qu'on NE fait PAS

- **Le code actuel est l'étalon — au sens fort.** Tout ce que ce skill transporte (la carte des écrans, les lignes « Comparaison Breakery » du benchmark, tes souvenirs d'une session précédente) est une **photo datée**. Une photo vieillit ; le code, lui, est vrai maintenant. **Un constat de design n'existe que si tu viens d'ouvrir le fichier qui le porte.** Les chemins bougent, les composants sont refactorés, supprimés, déplacés d'un dossier à l'autre — le relevé du 2026-08-31 a trouvé une quinzaine d'entrées fausses dans la carte précédente, dont des composants disparus et une grille dont le nombre de colonnes n'était plus figé. Un constat bâti sur une entrée de carte périmée est **faux**, et il entraîne un correctif sur un fichier mort. Quand la carte et le code divergent : **le code gagne**, tu audites ce que tu as lu, et tu **signales la dérive de la carte** en fin de rapport (elle sera recorrigée hors session, jamais par toi en cours d'audit).
- **Le code ne gagne QUE sur les faits.** L'intention du module se lit dans `docs/objectifs/POS.md` et dans les ADR applicables : elle éclaire le *pourquoi* d'un écran, elle ne le juge pas. **Ne jamais signaler « le code diverge de l'intention écrite » comme un défaut de design** — un écart d'intention est du **backlog**, pas une faute d'ergonomie, et il se remonte en Étape 6. Une fiche ne « gagne » jamais contre le code sur un **fait** ; le code ne gagne jamais contre une fiche sur une **intention**.
- **`CLAUDE.md` est la source de vérité** des patterns globaux ; **`docs/adr/`** porte les décisions qui font loi. **`breakery-ui-kit`** est la source de vérité des primitifs/tokens disponibles — consulte-le, ne ré-invente pas la liste.
- **On n'audite pas la plomberie.** Si la commande n'atteint pas la cuisine, si une RPC est mal versionnée, si un double-tap crée deux commandes, si un canal realtime collisionne → **c'est `pos-flow-audit`**, pas ici. Ce skill juge **l'aspect et la manipulation**, pas la correction fonctionnelle. Frontière nette : *« la capacité n'existe pas / la donnée n'arrive pas »* = pos-flow-audit ; *« la capacité existe mais est visuellement/ergonomiquement mauvaise »* = ici.
- **Cas hybride (rendu d'un mécanisme technique).** Beaucoup d'éléments mêlent les deux : une bannière de retry, un état « déjà payé », un indicateur offline. Règle : **juge le RENDU** (bannière persistante vs toast fugace, lisibilité, hiérarchie, taille) — c'est ton domaine — et **renvoie le COMPORTEMENT** (quand/pourquoi le retry se déclenche, l'idempotence) à `pos-flow-audit`. Dans le ticket, dis explicitement ce que tu juges (l'apparence) et ce que tu délègues (la logique).
