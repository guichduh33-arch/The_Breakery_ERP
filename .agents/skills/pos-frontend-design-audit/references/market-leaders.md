# Benchmark — patterns de l'état de l'art des POS restaurant

Cheat-sheet des patterns UI/UX des leaders, à utiliser en Étape 4 comme **lentilles de comparaison**, pas comme specs pixel. But : situer la maturité d'un écran et repérer le pattern manquant qui débloquerait la CAISSE ou les WAITER. Reste honnête — ce sont des conventions de référence largement répandues, pas des captures officielles.

> **Les lignes « Comparaison Breakery » sont une photo datée du 2026-08-31.** Elles disent où
> chercher, pas ce qui est vrai aujourd'hui : **relis le composant** avant de t'appuyer sur l'état
> décrit. Le code est l'étalon — une comparaison bâtie sur cette page sans relecture produit un
> constat faux (c'est exactement comme ça qu'un composant supprimé a survécu des semaines ici).

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
- Comparaison Breakery (2026-08-31) : grille **auto-remplie** (`ProductGrid` — pas de nombre de colonnes figé, la tuile a un plancher de largeur et le rail se remplit), favoris/combos épinglés dans `CategoryNav`, overlay sold-out/expired sur la tuile. Juger : densité réelle en rush au format du poste, taille des tuiles sur tablette, lisibilité du sold-out.

### Panier / ticket
- **Ligne éditable inline** (qty ± direct sur la ligne, swipe-to-delete) — TouchBistro, Square.
- **Total et CTA paiement dominants**, toujours visibles en bas (pouce-atteignable sur tablette).
- **Type de service (dine-in/takeaway/delivery)** en bascule claire et persistante.
- Comparaison Breakery (2026-08-31) : `CartLineRow` (trash-first + stepper), pied de totaux **rendu inline dans `ActiveOrderPanel`** (Total en or mono ; il n'existe plus de composant `CartTotals` — seul le type de `@breakery/domain` porte ce nom), onglets de type de service dans le même panneau, CTA dans `BottomActionBar`. Juger : hiérarchie du TOTAL, atteignabilité du CTA sur tablette.

### Modificateurs
- **Une modale par produit, options en 1 tap**, groupes requis en haut, validation bloquée tant que requis non choisi (Toast).
- **Modificateurs fréquents pré-affichés** (lait, sucre) sans scroll.
- Comparaison Breakery (2026-08-31) : `ModifierModal` (de `@breakery/ui`) + `VariantSelectModal` (grille responsive 2→3 colonnes) + `ComboConfigModal`, tous ouverts par `ProductTapHandler`. Juger : nombre de taps pour une option courante, scroll, clarté des groupes requis.

### Paiement / encaissement
- **Méthode probable pré-sélectionnée**, gros boutons méthode (Square, Clover).
- **Quick-cash** (montant exact, 50k, 100k) pour éviter le numpad (Square).
- **Split bill par convive** + split tender (Toast, Lightspeed) — diviser l'addition d'une table partagée.
- **Confirmation paiement claire** + monnaie à rendre en gros (lisible par le client).
- Comparaison Breakery (2026-08-31) : `PaymentTerminal` (conteneur 2 colonnes qui délègue à `PaymentMethodGrid`, `QuickPayRow`, `TenderDraftPanel`, `OrderSummaryPanel`, `RetryBanner`), `SplitPaymentFlow` en 6 étapes et 3 modes (par article / à parts égales / montants libres). Juger : taille des boutons méthode, visibilité du quick-cash, taps jusqu'au paiement, longueur perçue du parcours split.

### Plan de salle / tables (WAITER + dine-in)
- **Vue spatiale fidèle** (formes, sections, statut couleur), **transfert/fusion de tables** en drag ou menu (Lightspeed, Toast).
- **Occupation/temps assis** visible par table (turn-time).
- Comparaison Breakery (2026-08-31) : `FloorPlanModal` (`FloorCanvas` + tuiles `TableCell`, onglets de sections **lues en base**) côté caisse, `features/tablet/FloorPlanView.tsx` côté salle, transfert via `useTransferOrderTable`. Juger : lisibilité du statut, geste de transfert, information de temps assis.

### KDS (cuisine)
- **Tickets lisibles à distance**, **couleur d'urgence** par âge, **bump** d'un geste, coursing/recall (Toast).
- Comparaison Breakery (2026-08-31) : `KdsBoard` (grille responsive) + `KdsOrderCard` (bordure d'urgence, `PrepTimer`), `BumpButton` / `RecallButton` / `UndoBumpToast`, `RecentlyServedStrip`, filtre de stations. Juger : taille de police à 1-2 m, clarté du bump, réversibilité perçue.

### Customer display
- **Miroir de commande en direct**, total et monnaie en très grand, message de remerciement/paiement (Square, Clover).
- Comparaison Breakery (2026-08-31) : `CustomerDisplayView` (titres `font-display`, GRAND TOTAL en or mono) + `CDBrandPanel` / `CDPaymentPanel` / `ShowcasePanel` (vitrine) / `OrderQueueTicker` / `PairDevicePrompt`. Juger : lisibilité à distance, remise à zéro propre entre deux clients, état non appairé.

### Prise de commande WAITER (tablette debout)
- **iPad-first, gros targets, actions primaires en bas** (pouce), gestes (swipe), **offline-resilient** (TouchBistro, SumUp).
- **Table choisie une fois**, puis enchaînement produits sans re-sélection.
- Comparaison Breakery (2026-08-31) : `features/tablet/TabletOrderPage.tsx` + `TabletMenuView` + `TabletCartPanel` (panneau repliable, largeur à relire dans le fichier) + `OfflineBanner`, le tout empaqueté **Capacitor Android** (ADR-029). Juger : cibles `h-12`+, atteignabilité pouce, comportement portrait/paysage, clarté du régime offline, safe-areas Android.

## Comment formuler une ligne de benchmark dans le rapport
> **<Écran>** — Les leaders (`<lequel>`) font `<pattern>`. Aujourd'hui Breakery fait `<état constaté, ancré sur le fichier + la classe/le libellé exact que tu viens d'y lire>`. Maturité `<1-5>`. Pattern à importer : `<le delta concret>`, utile surtout pour `<caisse/waiter>`.
