# Audit design POS — Stock Vitrine (`/pos/stock`) — 2026-07-11

## 1. Synthèse

- **Périmètre audité** : le module « Cafe Stock » de la caisse — écran `/pos/stock` et sa carte produit.
  Fichiers lus : `features/stock/POSStockView.tsx`, `features/stock/components/POSStockCard.tsx`,
  `features/stock/components/AdjustDisplayModal.tsx`, `features/stock/hooks/usePOSStockProducts.ts`.
- **Profil** : **CAISSE uniquement** (route desktop/Tauri, tactile — le propriétaire confirme un usage au doigt).
  Pas de surface WAITER ici → pas de section WAITER dans ce rapport.
- **Verdict (4 lignes)** : l'écran est **fonctionnel et cohérent en tokens**, mais pensé comme une grille de
  consultation, pas comme un **outil de comptage/réassort rapide au doigt**. Trois faiblesses dominantes se
  cumulent : (a) **bilinguisme FR/EN dans le même écran** qui trahit un manque de finition, (b) **cibles tactiles
  à 32–36 px** sur les contrôles les plus tapés (−/+/+5), (c) **aucune vue liste dense** alors que la tâche
  réelle — « faire le tour de la vitrine et recompter » — réclame de voir 15–20 lignes d'un coup.
  **Le P0 à régler en premier** : les cibles tactiles des steppers/presets (douleur à chaque saisie de quantité).
- **Découverte structurante pour l'implémentation** : **il n'existe aucun champ `batch_size`/`pack_size` sur
  `products`** (colonnes réelles : `unit`, `min_stock_threshold`, `default_shelf_life_hours`). Les incréments
  « intelligents » demandés devront donc **dériver de l'`unit`** (+ indice secondaire `min_stock_threshold`),
  pas d'un batch size inexistant — sauf à ajouter une colonne (hors périmètre design).

### Tableau de maturité

| Écran | Profil | Maturité (1-5) | Faiblesse dominante |
|---|---|---|---|
| Grille + header (`POSStockView`) | Caisse | 3 | Densité inadaptée au comptage ; pas de vue liste ; bilinguisme |
| Carte produit (`POSStockCard`) | Caisse | 2 | Cibles 32–36 px sur −/+/presets ; incréments codés en dur ; libellés EN |
| Modale d'ajustement (`AdjustDisplayModal`) | Caisse | 4 | RAS majeur — déjà en `h-touch-comfy` (56 px), 100 % FR, écart affiché |

## 2. Constats détaillés (par sévérité)

| # | Sévérité | Écran | Profil | Constat (avec fichier:ligne) | Critère |
|---|---|---|---|---|---|
| 1 | **P0** | Carte | Caisse | Steppers −/+ en `h-9 w-9` = **36 px** (`POSStockCard.tsx:155,173`) et presets `PresetChip h-9` = 36 px (`POSStockCard.tsx:271`), tapés à chaque réassort. Sous le seuil 44 px. | Cible tactile |
| 2 | **P1** | Carte + Vue | Caisse | **Mélange FR/EN** : `Cafe Stock` (`POSStockView.tsx:181`), `Search…` (`:210`), `{n} out/low/products` (`:197–199`), `Loading stock…` (`:241`), `No products match` (`:249`), `OUT OF STOCK — sales blocked` (`POSStockCard.tsx:139`), `Low stock — restock needed` (`:144`), `Enter quantity` (`:188`), `Receive +{qty}` (`:184`) — VS les boutons/toasts FR `Retour cuisine`/`Perte`/`Ajuster` (`:203,214,221`) et `…en vitrine`/`…retour cuisine` (`POSStockView.tsx:98,118`). | Cohérence / finition |
| 3 | **P1** | Vue | Caisse | **Aucune vue liste dense** : unique rendu `grid xl:grid-cols-5 gap-3` de cartes hautes (`POSStockView.tsx:258`). Recompter 40 produits = beaucoup de scroll ; impossible de balayer une colonne de nombres. | Densité / vitesse |
| 4 | **P1** | Carte | Caisse | **Incréments codés en dur** `+5/+10/+20` (`POSStockCard.tsx:177–179`) — absurdes pour un gâteau entier (`unit = pièce`), trop petits pour des viennoiseries au fournil. Ne dérivent ni de `unit` ni du volume. | Ergonomie de rush |
| 5 | **P1** | Vue/Carte | Caisse | **Seuil d'alerte non éditable depuis le POS** : `min_stock_threshold` est affiché (`POSStockCard.tsx:131,144`) mais aucun contrôle pour le régler ; le caissier qui constate « ça alerte trop tard » ne peut rien faire (éditable BO seulement). | Couverture fonctionnelle (UI) |
| 6 | **P2** | Carte | Caisse | **Seuil illisible** : rendu `STOCK 🔔 {n}` en `text-[10px] text-text-muted` (`POSStockCard.tsx:129–132`) — info de contrôle en muted + 10 px, sous le confort de lecture rush. L'icône `Bell` sert à la fois d'« out », de « low » et de label seuil (sémantique brouillée). | Lisibilité / hiérarchie |
| 7 | **P2** | Vue | Caisse | `CategoryChip h-8` = **32 px** (`POSStockView.tsx:336`) et search `input h-9` = 36 px (`:212`) — filtres tapés au doigt sous 44 px (moins critiques car peu fréquents). | Cible tactile |
| 8 | **P2** | Carte | Caisse | Boutons de clôture `Retour cuisine`/`Perte`/`Ajuster` en `size="sm"` = **36 px** (`POSStockCard.tsx:196–226`) — actions secondaires, tolérable mais borderline pour du tactile. | Cible tactile |
| 9 | **P2** | Vue | Caisse | Erreur de chargement rendue en simple texte `Failed to load stock.` sans retry (`POSStockView.tsx:244`) au lieu d'un `ErrorState` avec action. | Couverture d'états |
| 10 | **P2** | Carte | Caisse | `aria-label="Decrease"/"Increase"` en anglais (`POSStockCard.tsx:152,171`) — a11y incohérente avec une UI cible FR. | Accessibilité / i18n |

## 3. Benchmark vs leaders

**Square for Restaurants / Square Inventory** — le comptage de stock se fait en **vue liste dense** : une ligne par
article, nom + compteur + champ de saisie aligné à droite, on descend au pouce et on tape les nombres à la chaîne.
La carte visuelle est réservée à la *vente*, pas au *comptage*. → importe la **vue liste** (constat #3).

**Loyverse / Toast — inventory counts** : le pas d'incrément d'un « +/- » suit **l'unité de vente** (à l'unité →
±1 ; au poids → clavier direct). Pas de presets magiques `+5/+10/+20` universels. → dérive les incréments de
`unit` (constat #4).

**Lightspeed / Revel** : les **seuils de réappro (par-level)** sont éditables là où on lit le stock, pas seulement
dans un back-office séparé — le responsable de salle ajuste le seuil au moment où il constate le problème.
→ contrôle de seuil inline (constat #5).

**Où on se situe** : maturité 2–3. On a l'isolation display-stock, les gestes (recevoir/retour/perte/ajuster) et
des tokens propres — mais l'écran est encore une *grille de consultation* là où les leaders offrent un *outil de
comptage*. Les patterns manquants (liste dense + incréments par-unité + seuil inline) sont tous faisables dans la
stack actuelle sans refonte.

## 4. Recommandations priorisées

### CAISSE

### [P0] Remonter les cibles tactiles des steppers et presets à 44–56 px
**Profil** — caisse (tactile).
**Écran** — `POSStockCard.tsx:149–180` (rangée numpad) + `PresetChip` (`:257–276`).
**Problème** — −/+ et +5/+10/+20 sont en `h-9 w-9` / `h-9` = 32–36 px, tapés à chaque réassort ; sous le seuil 44 px, source d'erreurs de saisie au doigt.
**Proposition** — passer les −/+ et les presets à `h-touch-comfy w-touch-comfy` (56 px), comme le fait déjà `AdjustDisplayModal.tsx:82,100`. Élargir le `gap` à `gap-2` (≥ 8 px) pour éviter les taps voisins. Si la largeur de carte devient serrée en vue carte, réduire à 2 presets max (voir P1 incréments) plutôt que rétrécir les boutons.
**Référence marché** — tous les POS tactiles (Square, Toast) tiennent 44 px+ sur les steppers de comptage.
**Stack** — tokens `h-touch-comfy`/`w-touch-comfy` déjà dans le design-system (`packages/ui`), aucun nouveau primitif.
**Effort / Impact** — S × fort.
**Critère d'acceptation** — chaque −/+/preset mesure ≥ 44 px (idéalement 56), espacés de ≥ 8 px, sur la carte ET la future ligne.

### [P1] Vue liste dense en plus de la vue carte (toggle)
**Profil** — caisse.
**Écran** — `POSStockView.tsx:258–275` (unique grille de cartes).
**Problème** — recompter la vitrine exige de voir beaucoup de lignes d'un coup ; les cartes hautes (image + banner + stepper + confirm + clôture) imposent du scroll et empêchent de balayer une colonne de nombres.
**Proposition** — ajouter un **toggle Carte / Liste** dans le header (à côté du `Settings`), persistant (localStorage). En mode Liste : une ligne compacte `h-touch-comfy` par produit — [vignette 32 px] · nom + SKU · nombre stock (mono, tonalité état) · pastille seuil · stepper −/+ + saisie + bouton « Recevoir » aligné à droite. Le geste de clôture (Retour/Perte/Ajuster) passe dans un menu `…` par ligne pour garder la densité.
**Référence marché** — Square Inventory / Loyverse counts : liste dense, saisie de nombres à la chaîne au pouce.
**Stack** — React + Tailwind ; réutiliser les mêmes handlers `onReceive/onReturnToKitchen/onWaste/onAdjust` déjà passés à `POSStockCard`. Extraire un `POSStockRow` frère de `POSStockCard`. Toggle via un simple `useState` + icônes `LayoutGrid`/`List` (lucide, déjà dépendance).
**Effort / Impact** — M × fort.
**Critère d'acceptation** — un bouton bascule Carte↔Liste ; en Liste, ≥ 12 produits visibles sans scroll sur un écran caisse 1080p ; toutes les actions restent atteignables.

### [P1] Incréments dérivés de l'unité (fin des +5/+10/+20 codés en dur)
**Profil** — caisse.
**Écran** — `POSStockCard.tsx:177–179`.
**Problème** — presets universels `+5/+10/+20` : absurdes pour un gâteau entier, sous-dimensionnés pour un bac de viennoiseries. Aucun lien avec la nature de l'article.
**Proposition** — calculer les presets à partir de `product.unit` (et, en indice secondaire, `min_stock_threshold`). Règle simple, table de correspondance dans `packages/domain` (IO-free) : unités « à la pièce » (piece/pièce/pcs/unit) → `[+1, +6, +12]` (logique douzaine boulangère) ; unités « entier/lourd » (cake/gâteau/entier/kg) → `[+1, +2]` ; défaut → `[+1, +5, +10]`. Optionnellement, si `min_stock_threshold ≥ 12`, proposer un preset « +seuil ». **Ne pas** créer de colonne `batch_size` (elle n'existe pas — décision hors design).
**Référence marché** — Loyverse/Toast : le pas suit l'unité de vente.
**Stack** — helper pur `deriveStockIncrements(unit, threshold): number[]` dans `packages/domain` (testable unitairement) ; la carte/ligne mappe le tableau retourné sur des `PresetChip`.
**Effort / Impact** — S–M × moyen.
**Critère d'acceptation** — un article « pièce » et un article « gâteau entier » affichent des presets distincts et sensés, sans valeur codée en dur dans le composant.

### [P1] Édition du seuil d'alerte depuis le POS
**Profil** — caisse.
**Écran** — `POSStockCard.tsx:129–132` (label seuil) — aucun contrôle d'édition.
**Problème** — le caissier voit le seuil mais ne peut pas le corriger quand l'alerte tombe trop tard/trop tôt ; réglable seulement en back-office.
**Proposition** — rendre le label seuil tapable (ou ajouter une action « Seuil » dans le menu clôture) ouvrant une petite modale sœur d'`AdjustDisplayModal` : stepper `h-touch-comfy` + confirmation, gatée `display.manage` (ou une perm dédiée). **Dépendance plomberie à déléguer** : la persistance de `min_stock_threshold` exige une RPC dédiée (ex. `set_display_alert_threshold_v1`) — **hors périmètre design, à cadrer avec `db-engineer`/`pos-flow-audit`** ; ce ticket ne porte que le contrôle visuel et son emplacement.
**Référence marché** — Lightspeed/Revel : par-levels éditables au point de lecture.
**Stack** — réutiliser `CenterModal` + tokens tactiles ; câblage RPC ultérieur.
**Effort / Impact** — M × moyen (UI S, mais bloquée par la RPC).
**Critère d'acceptation** — depuis la carte/ligne, un utilisateur habilité ouvre un contrôle de seuil à cibles ≥ 56 px ; (une fois la RPC dispo) la valeur persiste et l'état low/out se recalcule.

### [P1] Uniformiser la langue en anglais
**Profil** — caisse.
**Écran** — `POSStockView.tsx` + `POSStockCard.tsx` + les modales `Waste`/`Adjust` (voir constat #2).
**Problème** — la moitié de l'écran est en anglais (`Cafe Stock`, `Search…`, `OUT OF STOCK — sales blocked`, `Enter quantity`, KPI `out/low/products`) tandis que les gestes/toasts et les deux modales sont en français (`Retour cuisine`, `Perte`, `Ajuster`, `Déclarer une perte`, `Corriger le comptage`) — incohérence qui fait « inachevé ».
**Décision propriétaire (2026-07-11)** — **tout en anglais** (le reste du module, ex. `POSStockCategoriesSettings`, est déjà 100 % anglais → l'anglais est la convention). Le français était l'écart à corriger.
**Proposition** — traduire vers l'anglais toutes les chaînes FR visibles ET les `aria-label`/toasts : boutons `Retour cuisine`→`Return to kitchen`, `Perte`→`Waste`, `Ajuster`→`Adjust` ; modales `Perte vitrine`/`Déclarer une perte`→`Display waste`/`Record waste`, `Ajuster la vitrine`/`Corriger le comptage`→`Adjust display`/`Correct the count`, `Raison`→`Reason`, `Annuler`→`Cancel` ; toasts `…en vitrine`→`…to display`, `…retour cuisine`→`…returned to kitchen`, `…perte`→`…waste`, `Mise en vitrine échouée`→`Receive failed`, etc.
**Référence marché** — n/a (finition produit).
**Stack** — remplacement de littéraux ; aucun nouveau primitif.
**Effort / Impact** — S × moyen.
**Critère d'acceptation** — plus une seule chaîne FR visible ni en `aria-label`/toast sur l'écran stock et ses modales.

### [P2] Lisibilité du seuil + états d'erreur
**Profil** — caisse.
**Écran** — `POSStockCard.tsx:129–132` (seuil muted 10 px) ; `POSStockView.tsx:244` (erreur en texte nu).
**Problème** — l'info de seuil (contrôle) est en `text-text-muted` 10 px, difficile au coup d'œil ; l'erreur de chargement n'offre pas de retry.
**Proposition** — remonter le seuil en `text-xs text-text-secondary` avec un libellé explicite (`Seuil {n}`), réserver l'icône `Bell` aux seuls états alerte (pas au label). Remplacer le texte d'erreur par `ErrorState` avec bouton « Réessayer » (`products.refetch()`).
**Référence marché** — n/a.
**Stack** — `ErrorState` (`components/ErrorState.tsx`) déjà disponible ; tokens existants.
**Effort / Impact** — S × faible.
**Critère d'acceptation** — seuil lisible à ~50 cm ; l'échec de chargement propose un retry visible.

## 5. Quick wins (effort S, impact ≥ moyen)

- **P0 tactile** : `h-9 w-9` → `h-touch-comfy w-touch-comfy` sur −/+ et presets, `gap-1.5` → `gap-2` (`POSStockCard.tsx:149–180,271`). *S × fort.*
- **P1 langue** : traduire les ~12 littéraux/aria EN listés au constat #2. *S × moyen.*
- **P1 incréments** : helper pur `deriveStockIncrements(unit, threshold)` dans `packages/domain` + mapping sur les presets. *S–M × moyen.*
- **P2 erreur** : remplacer `Failed to load stock.` par `ErrorState` + retry (`POSStockView.tsx:244`). *S × faible.*

---

> **Hand-off** : ce rapport est l'entrée du skill `pos-frontend-design-implement`.
> Ordre d'implémentation conseillé : **P0 tactile → P1 langue → P1 vue liste → P1 incréments → P1 seuil (bloqué RPC) → P2 polish**.
> Délégations hors design : la **RPC de persistance du seuil** (ticket P1 seuil) et toute question d'idempotence/versioning → `db-engineer` / `pos-flow-audit`.
