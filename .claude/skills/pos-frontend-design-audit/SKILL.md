---
name: pos-frontend-design-audit
description: >-
  Auditer l’aspect et l’ergonomie du POS Breakery existant : hiérarchie, lisibilité, cibles, états et caisse/tablette. Constats et recommandations en conversation. Pannes fonctionnelles : pos-flow-audit ; code validé : pos-frontend-design-implement.
---

# POS Frontend Design Audit — The Breakery (caisse + tablette serveur)

Suivre la route jusqu’au rendu réellement utilisé. Pour un écran nommé, rester sur cet écran ; pour un audit plus large demandé, couvrir les profils concernés sans en inventer. Lire la grille avant de juger.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

## Arbitrages gravés — ce qui n'est JAMAIS un défaut

Ces points ont été tranchés par Mamat. Les re-signaler fait perdre la confiance dans tout le reste du rapport. **Ne les liste pas comme constats**, même « pour mémoire ».

- **L'or MÈNE, le vert ENGAGE.** L'or guide l'œil (accent, total, actif) ; le vert porte l'action qui engage. Un CTA qui n'est pas or n'est pas une incohérence.
- **Le serif est légitime pour les titres de modales.**
- **Le numéro de commande est en mono, partout.** C'est voulu.
- **Playfair sur `/display`** — exception gravée.
- **Le croissant de l'écran de login** — exception gravée.
- **Le cyan vient de la famille `cat-*`** (teintes de catégorie), ce n'est pas une couleur hors système.
- **Un contraste de 4,4:1 sur un élément désactivé** n'est pas un défaut : un élément désactivé doit se lire comme désactivé.
- **Le plein-bord est un choix de design**, pas un oubli de marge.

## Garde-fous

- **Ne propose rien que tu n'aies ancré dans un fichier lu.** Si tu n'as pas ouvert le composant, ne juge pas son design. Si tu ne l'as pas trouvé, dis-le : « le composant que la carte annonce n'existe plus » est un constat honnête ; le juger de mémoire ne l'est pas.
- **Ne juge pas un fichier sans importeur.** Vérifie que le composant est atteint depuis une route ou un shell avant d'écrire un ticket dessus.
- **Ancre double dans le rapport** : `fichier:ligne` + l'ancre stable qui le porte (classe, libellé, nom de bloc). Le numéro rend le constat cliquable, l'ancre le rend vérifiable après une édition.
- **N'invente pas de tokens/primitifs.** Tout import doit exister dans `@breakery/ui` (cf. `breakery-ui-kit`) ou être une classe Tailwind du preset.
- **Sépare toujours CAISSE et WAITER** : une amélioration desktop dense peut casser l'ergonomie tablette debout, et vice-versa. Un bon ticket dit pour qui il vaut.
- **Reste dans l'aspect.** Dès qu'un constat devient « ça ne marche pas / ça double-charge / la cuisine ne reçoit rien », bascule-le explicitement vers `pos-flow-audit` au lieu de le traiter ici.
- **Le rapport est le hand-off.** Rends-le proprement **en conversation** : c'est l'entrée de `pos-frontend-design-implement`, **dans la même session**. Il n'y a pas de rattrapage sur disque — un audit non consommé se refait.

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
