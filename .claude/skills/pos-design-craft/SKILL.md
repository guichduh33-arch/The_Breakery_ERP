---
name: pos-design-craft
description: >-
  Créer ou refondre une interface POS Breakery : caisse, tablette serveur, KDS et customer display. Design neuf, maquette et ergonomie tactile. Audit visuel existant : pos-frontend-design-audit ; panne fonctionnelle : pos-flow-audit.
---

# POS Design Craft — conception visuelle + ergonomique du POS

Préciser CAISSE, WAITER, KDS ou display ; vérifier l’existant et les dépendances avant de concevoir. Lire les piliers visuels pour la conception et le protocole navigateur avant de livrer.

## Lecture proportionnée

Les règles d’CLAUDE.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Pour conduire la conception, le diagnostic ou le conseil demandé ; lire seulement le cas correspondant. | [méthode ciblée](references/workflow.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par CLAUDE.md. | [contrôles et sources](references/verification.md) |

## Pilier 1 — Pratique & vitesse (ergonomie terrain)

Chaque règle est chiffrée ; toute déviation se justifie par écrit.

- **Loi de Fitts** : temps d'atteinte ∝ distance/taille. Donc : cibles fréquentes = **grandes + proches de la zone d'attention** ; actions d'angle/bord = cibles « infinies » (le doigt bute sur le bord, impossible de dépasser) — y placer Encaisser, catégorie active. **Minimiser la distance panier↔grille** : le ratio ajout-produit/correction est ~20:1, le layout doit refléter ce ratio.
- **Cibles tactiles** : plancher absolu 44 px (WCAG), confort Android 48 px ; **actions de rush (ajout produit, Encaisser, ± quantité) : 56–72 px** — arbitrage dans la fourchette : 56 px en densité CAISSE, **64 px par défaut en WAITER** (pouce), 72 px pour l'action Encaisser. **Espacement : plancher 8 px, 12 px en rush/WAITER.** Raison : mains grasses/farinées = précision dégradée, le coût d'un mis-tap en rush est disproportionné.
- **Thumb zones (profil WAITER, une main)** : actions primaires dans le tiers bas / bord dominant ; actions destructrices (void, suppression ligne) **hors zone de réflexe** — jamais adjacentes à une action fréquente.
- **Compter les taps** : mesurer le chemin produit→encaissement en taps ; chaque écran conçu doit annoncer son compte. Défauts intelligents (variante la plus vendue pré-sélectionnée, quantité 1) + modificateurs rapides > arborescences profondes.
- **Feedback < 100 ms perçu** sur chaque tap : visuel (état pressed net) toujours ; haptique si la plateforme le permet (`navigator.vibrate(10)` guardé — la coque Capacitor existe depuis l'ADR-029, mais **`@capacitor/haptics` n'est PAS installé** : vérifié le 2026-08-31, l'ajouter est une décision à faire trancher, pas un acquis) ; sonore optionnel et coupable. Jamais de latence perçue : optimistic UI (pilier 3).
- **Tolérance à l'erreur** : undo non-bloquant (toast sonner avec action Annuler, 5 s) > confirmation préalable. Modale de confirmation **uniquement** pour l'irréversible (void, abandon de commande) — jamais de modale qui casse le flux d'ajout en rush.
- **Plein soleil** : sur les chiffres (prix, totaux, quantités) viser **AAA (7:1)** ; minimum AA partout. Interdits : gris pâle sur fond clair, texte < 16 px pour l'opérationnel, information portée par la couleur seule.

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
