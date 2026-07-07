# Benchmark — patterns de l'état de l'art des POS restaurant

Cheat-sheet des patterns UI/UX des leaders, à utiliser en Étape 4 comme **lentilles de comparaison**, pas comme specs pixel. But : situer la maturité d'un écran et repérer le pattern manquant qui débloquerait la CAISSE ou les WAITER. Reste honnête — ce sont des conventions de référence largement répandues, pas des captures officielles.

## Les acteurs et leur ADN

| Leader | Force / ce qu'on leur emprunte |
|---|---|
| **Square for Restaurants** | Grille produits ultra-rapide, gros boutons colorés par catégorie, encaissement minimal-taps, quick-cash. Étalon de la **vitesse comptoir**. |
| **Toast** | Coursing/timing cuisine, modificateurs riches, KDS robuste, gestion dine-in profonde. Étalon **table service + cuisine**. |
| **Lightspeed (L-Series/K-Series)** | Plan de salle visuel soigné, transfert de table, design dense mais lisible. Étalon **floor management**. |
| **TouchBistro** | Conçu iPad-first pour serveurs : prise de commande debout, gros tap targets, gestes. Étalon **WAITER tablette**. |
| **Clover** | Modulaire, périphériques (tiroir/imprimante), boutons larges, simplicité. Étalon **hardware + simplicité**. |
| **Revel** | Dense, orienté chaînes, raccourcis et favoris configurables. Étalon **rush haute cadence**. |
| **SumUp** | Mobile-first minimaliste, encaissement en très peu d'écrans. Étalon **simplicité mobile**. |
| **Storyous** | Café/bar européen, tabs ouverts, ardoises rapides. Étalon **café + addition ouverte**. |

## Patterns par écran

### Grille produits / registre
- **Boutons gros et colorés par catégorie** (Square, Revel) — reconnaissance par couleur + photo, pas par lecture. Vise un tap sûr sans viser.
- **Favoris / most-sold épinglés** en tête, voire un écran « rush » configurable (Revel, Toast) — les 10 produits qui font 80 % du volume accessibles sans naviguer.
- **Recherche tolérante** toujours visible (Square) — 2 lettres suffisent.
- **Badge stock/86'd** clair sur la tuile (Toast « 86 this item ») — l'épuisé se voit d'un coup d'œil.
- Comparaison Breakery : grille `grid-cols-4`, favoris/combos épinglés en CategoryNav, low-stock ribbon présent. Juger : densité en rush, taille des tuiles sur tablette.

### Panier / ticket
- **Ligne éditable inline** (qty ± direct sur la ligne, swipe-to-delete) — TouchBistro, Square.
- **Total et CTA paiement dominants**, toujours visibles en bas (pouce-atteignable sur tablette).
- **Type de service (dine-in/takeaway/delivery)** en bascule claire et persistante.
- Comparaison Breakery : `CartLineRow` (trash-first + stepper), `CartTotals` gold mono, tabs type service dans `ActiveOrderPanel`. Juger : hiérarchie du TOTAL, atteignabilité du CTA sur tablette.

### Modificateurs
- **Une modale par produit, options en 1 tap**, groupes requis en haut, validation bloquée tant que requis non choisi (Toast).
- **Modificateurs fréquents pré-affichés** (lait, sucre) sans scroll.
- Comparaison Breakery : `ModifierModal` (@breakery/ui) + `VariantSelectModal` grille 3 col. Juger : nombre de taps pour une option courante, scroll.

### Paiement / encaissement
- **Méthode probable pré-sélectionnée**, gros boutons méthode (Square, Clover).
- **Quick-cash** (montant exact, 50k, 100k) pour éviter le numpad (Square).
- **Split bill par convive** + split tender (Toast, Lightspeed) — diviser l'addition d'une table partagée.
- **Confirmation paiement claire** + monnaie à rendre en gros (lisible par le client).
- Comparaison Breakery : `PaymentTerminal` 2 colonnes, méthodes `grid-cols-3`, `SplitPaymentFlow`. Juger : taille des boutons méthode, présence/visibilité quick-cash, taps jusqu'au paiement.

### Plan de salle / tables (WAITER + dine-in)
- **Vue spatiale fidèle** (formes, sections, statut couleur), **transfert/fusion de tables** en drag ou menu (Lightspeed, Toast).
- **Occupation/temps assis** visible par table (turn-time).
- Comparaison Breakery : `FloorPlanModal` (scatter `TableCell` + sections + statut). Juger : lisibilité statut, geste de transfert, info temps.

### KDS (cuisine)
- **Tickets lisibles à distance**, **couleur d'urgence** par âge, **bump** d'un geste, coursing/recall (Toast).
- Comparaison Breakery : `KdsBoard` grille responsive + `KdsOrderCard` (bordure urgence + timer). Juger : taille de police à 1-2 m, clarté du bump.

### Customer display
- **Miroir de commande en direct**, total et monnaie en très grand, message de remerciement/paiement (Square, Clover).
- Comparaison Breakery : `CustomerDisplayView` (Playfair 2xl, GRAND TOTAL gold). Juger : lisibilité à distance, reset propre entre clients.

### Prise de commande WAITER (tablette debout)
- **iPad-first, gros targets, actions primaires en bas** (pouce), gestes (swipe), **offline-resilient** (TouchBistro, SumUp).
- **Table choisie une fois**, puis enchaînement produits sans re-sélection.
- Comparaison Breakery : `TabletOrderPage` + `TabletCartPanel` (300px) + `OfflineBanner`. Juger : cibles `h-12`+, atteignabilité pouce, comportement portrait, clarté offline.

## Comment formuler une ligne de benchmark dans le rapport
> **<Écran>** — Les leaders (`<lequel>`) font `<pattern>`. Aujourd'hui Breakery fait `<état constaté, fichier:ligne>`. Maturité `<1-5>`. Pattern à importer : `<le delta concret>`, utile surtout pour `<caisse/waiter>`.
