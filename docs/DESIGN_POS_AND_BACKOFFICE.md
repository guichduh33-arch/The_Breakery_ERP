# Design actuel — POS & Backoffice

> **Périmètre fonctionnel** : ce document décrit le **langage de design visuel et l'ergonomie** des deux applications POS et Backoffice du monorepo **V3** — issu de la vision originale V2 (AppGrav, jamais déployée) et repris tel quel dans V3. Pour les **tokens techniques canoniques** (Luxe Dark, variables CSS, scales, classes Tailwind), la source de vérité est [`reference/02-design-system/`](reference/02-design-system/) ; les **screenshots de référence** vivent dans [`docs/Design/`](Design/) (`backoffice/`, `caissapp/`).

---

## 1. Raison d'être de ce document

Là où `DESIGN.md` racine documente le design system **par tokens et fondamentaux techniques**, ce document décrit le design **par écran métier** : à quoi ressemble concrètement la page Dashboard, le POS en mode dine-in, la modale de paiement, la liste des produits. C'est la **lecture business-first** du design — utile pour onboarder un dev, un designer ou un stakeholder qui veut comprendre "à quoi ça ressemble" avant de plonger dans les variables CSS.

Le doc s'articule autour de deux paradigmes UX fondamentalement opposés :

- **POS** : sombre, plein écran, tactile, sensoriel — un poste de combat.
- **Backoffice** : clair, structuré, dense, scrollable — un bureau d'administration.

Les deux partagent une **identité visuelle commune** ("Luxe Bakery") qui crée la cohérence — mais leur ergonomie diverge radicalement parce que leurs missions divergent radicalement.

---

## 2. L'identité commune — "Luxe Bakery"

Avant de séparer POS et Backoffice, voici ce qui les unit.

### 2.1 L'aesthetic

**Luxe Bakery** = une boulangerie française premium, moody, artisanale. Inspiration : pâtisserie haut de gamme parisienne sous éclairage tamisé, vitrine en laiton, étiquettes manuscrites.

| Trait | Manifestation visuelle |
|---|---|
| **Profondeur théâtrale** | Le contenu émerge de l'ombre (POS) ou se pose sur de l'ivoire mat (Backoffice) — jamais sur du blanc cru, jamais sur du noir absolu |
| **Or vieilli comme accent** | `#C9A55C` — utilisé avec retenue : CTA, totaux, navigation active, logo. Jamais en aplats massifs. |
| **Formalité typographique** | Serif italique pour le branding (Playfair Display "B") + sans-serif géométrique pour l'opérationnel (Inter) |
| **Bordures chuchotées** | Lignes 1px translucides à 4-15% d'opacité — structure sans masse |
| **Densité utilitaire** | Beaucoup d'information par écran, mais avec un rythme vertical généreux pour préserver le sentiment premium |
| **Restraint chromatique** | La couleur a un sens : or = marque/action, vert = succès, orange = attention, rouge = critique |

### 2.2 Le vocabulaire d'atmosphère

**Moody · Artisanal · Nocturnal · Refined · Theatrical · Dense-yet-Elegant**

Concrètement : un cashier doit ressentir qu'il travaille dans un lieu **haut de gamme**, pas dans un Excel. Un gérant doit ressentir qu'il consulte des **chiffres précieux**, pas un dump CSV.

### 2.3 Les 4 polices

| Police | Rôle | Où la voit-on |
|---|---|---|
| **Inter** | Sans-serif opérationnel | 95% des textes : body, labels, boutons, navigation, tables, inputs |
| **Playfair Display** | Serif italique de marque | Logo "B" du POS, titres de dashboard, en-têtes display |
| **Fraunces** | Serif optique pour data viz | Modale Cashier Analytics, KPI premium |
| **JetBrains Mono** | Monospace tabulaire | Timers KDS, montants alignés, totaux |

### 2.4 La signature universelle — Les labels en majuscules tracking large

Présent dans **les deux apps** : les labels de section en très petite taille (10-12px), bold, **MAJUSCULES**, avec letter-spacing très ouvert (0.05em à 0.2em).

```
OPERATIONS     MANAGEMENT     ADMIN     ACTIVE ORDER     TOP PRODUCTS TODAY
```

C'est la signature architecturale du design system — petites, commandantes, hiérarchiques. À la fois discrètes et autoritaires.

---

## 3. L'application POS — Le poste de combat sombre

### 3.1 Le décor général

**Theme `.theme-pos`** — schéma sombre.

| Couche | Valeur | Effet |
|---|---|---|
| Page background (`--surface-0`) | `#0C0C0E` | Quasi-noir, profondeur de vitrine éteinte |
| Cards / panels (`--surface-1`) | `#151517` | Surface principale — un cran au-dessus du fond |
| Élevations (`--surface-2`) | `#1E1E22` | Hover, modales |
| États actifs (`--surface-3`) | `#28282E` | Tabs sélectionnés, drop targets |
| Bordures (`--border`) | `#2A2A32` | Whisper-thin, jamais agressives |
| Texte principal (`--text-primary`) | `#F0F0F2` | Off-white doux — pas de blanc brûlé |
| Texte secondaire (`--text-secondary`) | `#A8A8B0` | Métadonnées, labels |

L'œil ne se fatigue **jamais** : le contraste est élevé sans être agressif, et l'or `#C9A55C` ressort comme un point lumineux dans la nuit.

### 3.2 Le POS principal — `/pos`

**Réf visuelle** : `docs/Design/caissapp/04-grid-coffee-cart-2items-table-t12.jpg`

Layout en **deux colonnes** plein écran :

#### Colonne gauche — La grille produits (≈60% largeur)

- **Search bar** en haut : input arrondi, fond `surface-1`, placeholder doux.
- **Navigation catégories** (au-dessus ou comme bandeau latéral) : badges arrondis, catégorie active en or.
- **Grille produits** : 2 à 4 colonnes selon viewport, cartes carrées de ~280×280 px.
  - **Photo produit** plein cadre haute qualité (cappuccino, baguette artisanale, latte glacé).
  - **Overlay sombre** dégradé bas pour lisibilité texte.
  - **Nom + prix** en bas à gauche.
  - **Étoile favori** en haut à droite (Lucide icon).
  - **Badge "SOLD OUT"** en travers diagonal si stock épuisé — gris translucide, opacity réduite sur l'image.
- **Stock badge** discret en coin si stock bas (orange pour <10, rouge pour <5).

#### Colonne droite — Le cart actif (≈40% largeur)

Section **`ACTIVE ORDER #4315`** :

- **Header cart** : titre en MAJUSCULES tracking large + numéro de commande à droite.
- **Sous-ligne** : type ("Dine-in") + **Badge table jaune en haut à droite** `TABLE: T12` avec fond gold/10.
- **Toggle group DINE IN / TAKE-OUT / DELIVERY** : 3 onglets pleine largeur, l'actif en fond `gold/10` + texte gold.
- **Bouton "ADD CLIENT"** en pleine largeur, fond `surface-2`, icône utilisateur Lucide à gauche.
- **Bouton "HELD ORDERS"** + bouton "CLEAR" en row, équilibrés.
- **Liste des items** :
  - Quantité en préfixe gras (`1x`).
  - Nom produit en `text-primary`.
  - **Modifiers** ligne en dessous en couleur d'accent (rouge / orange) — ex: `HOT/ICED: HOT`, `Milk: Oat milk`.
  - Boutons − / `1` / + pour ajuster quantité.
  - Icône tag pour appliquer un modifier ad hoc.
  - Prix aligné à droite en monospace.
  - Icône poubelle pour retirer.
- **"ADD SPECIAL INSTRUCTIONS"** bouton textuel discret.
- **Bloc Totaux** en bas :
  - SUBTOTAL en label + montant à droite.
  - APPLY DISCOUNT (lien cliquable).
  - TAX INCLUDED (10%) — la PB1 visible.
  - **TOTAL AMOUNT** en gros caractère + or pour le montant.
- **Bouton "SEND TO KITCHEN"** pleine largeur, fond `surface-2`, icône avion en papier.
- **Bouton "CHECKOUT" en or massif** pleine largeur, gros, avec montant rappelé à droite. C'est **le bouton primaire absolu** — le geste final.

### 3.3 La modale de paiement

Plein écran, fond noir profond. Layout :

- **Header** numéro commande + montant total en gold massif.
- **Numpad virtuel** (~60% gauche) : grille 3×4 avec gros boutons tactiles, font Playfair pour les chiffres, hover doux.
- **Liste des méthodes de paiement** (~40% droite) :
  - Tiles colorées par méthode : Cash (vert), Card (bleu), QRIS (violet), GoPay/OVO/DANA (couleurs e-wallet).
  - Active en or.
- **PaymentStatusBar** : Total dû / Total payé / Reste à payer, mise à jour temps réel.
- **PaymentAddedList** : split en cours, items un par un avec icône retrait.
- **PaymentSuccess** : écran de confirmation grand avec ✓ vert + monnaie à rendre en or massif.

### 3.4 Les modales secondaires

Toutes suivent le même pattern : centrées, fond `surface-1`, blur derrière, header avec titre Playfair + close button, body scrollable, footer avec actions (cancel à gauche `text-secondary`, primary à droite `bg-gold`).

Exemples : `DiscountModal`, `CustomerSearchModal`, `VariantModal`, `ModifierModal`, `RefundModal`, `VoidModal`, `PinVerificationModal`, `SplitByItemModal`.

### 3.5 Le KDS — `/kds/:station`

Layout grille de cartes commandes :

- **Header station** en haut : nom + icône Lucide colorée (ChefHat rouge pour Hot Kitchen, Coffee or pour Barista, Store vert pour Display, Users gris pour Waiter).
- **Compteur All-Day** : nombre cumulé d'items préparés aujourd'hui.
- **Order cards** : fond `surface-1`, header avec numéro + table + chrono (CountdownBar de couleur progressive vert → orange → rouge clignotant).
- **Items** : checkbox "Ready" par item, modifiers en sous-ligne, notes spéciales mises en valeur.
- **Bouton "All Ready"** vert quand tous items prêts.
- **Progress bar** sous chaque card : pourcentage d'items prêts.

### 3.6 Le Customer Display — `/display`

Plein écran face client. Deux modes :

#### Mode Active

- **Logo Breakery** en en-tête.
- **Liste items animée** en gros caractères au centre.
- **Remises** affichées avec animation discrète quand elles s'appliquent.
- **TOTAL** en très gros caractère gold.
- **Points fidélité gagnés** quand client lié : animation de chiffres qui montent.

#### Mode Idle

- **Logo dominant** au centre.
- **Promos rotatives** en fade in/out (8-15s par promo).
- **Message d'accueil** en Playfair.
- **Dim** automatique après 30 min d'inactivité.

### 3.7 Tablet Ordering — `/tablet`

Layout similaire au POS mais simplifié :

- **PIN verification** en plein écran à l'ouverture.
- **Indicateur LAN** dans le header (Wifi vert / gris).
- **Grille produits** + **cart inférieur** sur orientation portrait (plus tactile pour le serveur en marche).
- **Bouton "SEND TO POS"** très visible en bas.

### 3.8 Les invariants UI du POS

| Invariant | Pourquoi |
|---|---|
| **Aucun menu back-office** | Pas de navigation latérale, pas de breadcrumb. Le caissier ne peut pas se perdre. |
| **Pas de scrollbar verticale principale** | Tout le contenu critique tient à l'écran. La grille produits scrolle indépendamment. |
| **Boutons ≥ 48px de hauteur** | Cible tactile confortable pour le doigt. |
| **Or pour le geste primaire absolu** | Un seul bouton or par écran (CHECKOUT, SEND TO KITCHEN, Confirm). Hiérarchie d'action évidente. |
| **Animations < 200ms** | Pas de transitions longues qui ralentissent le geste. |
| **VirtualKeypad omniprésent** | Tout input texte/nombre déclenche le clavier virtuel — pas de dépendance clavier physique. |

---

## 4. L'application Backoffice — La salle de commandement claire

### 4.1 Le décor général

**Theme `.theme-backoffice`** — schéma clair off-white.

| Couche | Valeur | Effet |
|---|---|---|
| Page background (`--surface-0`) | `#F8F8F6` | Ivoire mat doux — jamais blanc cru |
| Cards / panels (`--surface-1`) | `#FFFFFF` | Cartes blanches qui se détachent légèrement |
| Élevations (`--surface-2`) | `#F2F2EE` | Hover, sections sélectionnées |
| États actifs (`--surface-3`) | `#EAEAE6` | Cellules de table actives |
| Bordures (`--border`) | `#E5E7EB` | Lignes claires discrètes |
| Texte principal (`--text-primary`) | `#1A1A1D` | Noir doux — jamais noir absolu |
| Texte secondaire (`--text-secondary`) | `#6B7280` | Gris medium pour métadonnées |

L'or `#C9A55C` reste **identique** entre les deux thèmes — c'est la constante de marque. Mais sur fond clair, il apparaît plus chaud et plus "doré ancien" que sur fond sombre.

### 4.2 Le Dashboard — `/`

**Réf visuelle** : `docs/Design/backoffice/Dashboard.jpg`

Layout **sidebar fixe gauche + content scrollable droite**.

#### Sidebar gauche (~220 px)

- **Logo Breakery** en haut : croissant illustré + texte "French Bakery & Pastry" en Playfair italique gold + badge "250" rouge (notifications).
- **Sections de navigation** organisées par catégorie :
  - `OPERATIONS` (label uppercase wide tracking, gris muted)
    - Dashboard (actif → fond `gold/10`, **bordure droite gold 2px**, texte gold-dark)
    - POS Terminal
    - Kitchen Display
  - `MANAGEMENT`
    - Products
    - Stock & Inventory
    - Order History
    - B2B Wholesale
    - Purchases
    - Suppliers
    - Expenses
    - Customers
  - `ADMIN`
    - Reports
    - Accounting
    - Users
- **Icônes Lucide** 16px à gauche de chaque item, alignement parfait.
- **Hover** : fond `surface-2` léger, texte primary.
- **Bouton collapse** en bas de la sidebar (chevron).
- **Profil utilisateur** en footer : avatar circulaire + "Mamat (Owner)" + bouton logout.

#### Content principal

- **Header de page** en haut :
  - Titre "Dashboard" en gros caractère bold.
  - Sous-titre dégradé : "Good evening, Mamat (Owner). Friday, May 1, 2026" en `text-secondary`.
  - À droite : badge "Last updated 21:53" avec pastille verte clignotante + bouton refresh.
- **Rangée de KPI cards** :
  - 5 cards uniformes blanches avec ombre douce.
  - Icône en haut à gauche (`$`, sac, cube, trending, users).
  - Label uppercase wide tracking en gris.
  - Valeur en très gros caractère noir + `Rp` en or pour les montants.
  - Largeur égale, gap ~16px.
- **Charts** sur la ligne suivante :
  - Card "30-DAY REVENUE TREND" : courbe gold lissée sur fond ivoire, axe Y en milliers, hover tooltip.
  - Card "REVENUE BY ORDER TYPE" : donut chart avec couleurs charts (gold/bleu/rouge/vert/violet).
- **Sections compactes** :
  - "TOP PRODUCTS TODAY" / "HOURLY SALES" / "PAYMENT METHODS" : 3 cards en row.
  - Payment Methods avec progress bars colorées par méthode (Cash vert, Qris violet, Card bleu, Edc or).
  - Empty states discrets "No sales today yet" en `text-muted`.
- **Sections "INVENTORY MONITOR"** et **"RECENT ORDERS"** en bas avec liens "View all →".

### 4.3 Les pages liste — Pattern récurrent

Toutes les pages liste (Products, Customers, Orders, Suppliers, B2B, Expenses…) suivent le même squelette :

1. **Header de page** : titre + sous-titre + actions à droite (boutons "New X", export, refresh).
2. **Stats cards** en row (3 à 6 KPI compactes).
3. **Filters bar** : recherche + dropdowns statuts/types/dates + bouton "Reset".
4. **Table** principale :
   - Header sticky, fond blanc cassé.
   - Lignes en `surface-1` alternées doucement (sans zébrage agressif).
   - Hover row : fond `surface-2`.
   - Coloration de cellule selon statut (badges colorés pour status, payment_status, etc.).
   - Actions en fin de ligne (icônes Lucide cliquables + menu kebab).
5. **Pagination** en bas : navigation page + sélecteur "Items per page".
6. **Export buttons** : CSV + PDF en bas ou dans le header.

### 4.4 Les pages détail — Pattern récurrent

Toutes les fiches détail (Product Detail, Customer Detail, Order Detail, B2B Order Detail, Supplier Detail…) :

1. **Breadcrumb** en haut : `< Back to {parent}` + titre.
2. **Bloc identité** : nom, badges de statut, métadonnées clés (date, créateur, ID).
3. **Tabs** horizontaux pour organiser l'info :
   - Onglet actif : bordure inférieure gold 2px + texte gold-dark.
   - Onglet inactif : texte `secondary`.
4. **Content par tab** : cards blanches avec sections internes.
5. **Sidebar latérale droite** parfois : résumé permanent, totaux, actions rapides.
6. **Footer d'actions** : boutons primaires (Save, Approve) + secondaires (Cancel, Delete).

### 4.5 Les pages settings — Layout dédié

Layout sub-sidebar dans la sidebar :

- **Sidebar settings** à gauche (sous la navigation principale ou en pleine largeur) regroupe par catégorie :
  - GENERAL (Company, Business Hours, Tax)
  - SALES & POS (POS Config, Payment Methods, Loyalty)
  - OPERATIONS (Inventory, Categories, Product Types, KDS, Display)
  - COMMERCE (B2B)
  - SYSTEM (Printing, Notifications, Security, Financial, Roles, Audit, LAN, Devices, History)
  - LAYOUT (Floor Plan, Sections)
- **Content settings** à droite : formulaire structuré avec sections collapsibles, switches, dropdowns, bouton "Save Changes" en bas.

### 4.6 Le module Accounting — Spécificité

Pages très "tabulaires" avec densité maximale d'information :

- **Trial Balance, Balance Sheet, Income Statement** : tables hiérarchiques pliables, alignement monospace des montants.
- **General Ledger** : table dense avec colonnes Date / Description / DR / CR / Balance.
- **Journal Entries** : liste + modal formulaire avec lignes DR/CR équilibrées en direct.
- **VAT Management** : carte de synthèse PB1 + tableau mois par mois.

L'esthétique reste cohérente (off-white, or, Inter) mais la **densité est maximale** — un comptable veut tout voir en un écran.

### 4.7 Le module Reports — Spécificité

Layout type :

- **Header avec DateRangePicker** + filtres contextuels + bouton export CSV/PDF.
- **5 KPI cards en haut** avec `ComparisonKpiCard` (delta vs période précédente).
- **1 ou 2 graphiques** Recharts (lignes, barres, donut) avec couleurs chart palette.
- **Table détaillée** en bas avec tri + pagination.

### 4.8 Les invariants UI du Backoffice

| Invariant | Pourquoi |
|---|---|
| **Sidebar persistante** | Orientation permanente — l'utilisateur sait toujours où il est |
| **Breadcrumbs systématiques** | Navigation lisible dans les détails imbriqués |
| **Sticky headers de tables** | Lire des tables longues sans perdre les colonnes |
| **Tabs horizontaux pour les détails** | Densité d'info sans noyer dans le scroll |
| **Bouton primaire en bas-droite ou en haut-droite** | Position prédictible pour "Save" / "Create" |
| **Empty states soignés** | Texte clair + icône + (parfois) CTA ("No customers yet — Add your first") |
| **Skeleton loading** | Charger sans flash blanc |

---

## 5. Les couleurs partagées avec sens métier

Au-delà des fonds et textes, les **couleurs sémantiques** sont strictement codées et identiques dans les deux apps (avec des variantes adaptées au thème).

| Rôle | POS (dark) | Backoffice (light) | Usage |
|---|---|---|---|
| **Success** | `#34D399` | `#16A34A` | Confirmation, paid, completed, ready |
| **Warning** | `#FBBF24` | `#D97706` | Stock faible, pending, à risque |
| **Error** | `#F87171` | `#DC2626` | Erreur, voided, critique, refund |
| **Info** | `#60A5FA` | `#2563EB` | Information neutre, links |
| **Gold** | `#C9A55C` | `#C9A55C` | Marque, CTA primaire, totaux |

**KDS timing colors** (fixes, partout) :

- Vert `#22C55E` < 5 min
- Jaune `#EAB308` 5-10 min
- Orange `#F97316` 10-15 min
- Rouge `#EF4444` > 15 min (clignotement actif)

**POS category colors** (10 couleurs fixes) pour différencier visuellement les catégories produits dans la grille.

---

## 6. Les composants signature

### 6.1 Le KPI Card

Présent dans Dashboard, Reports, B2B Dashboard, etc.

- Fond `surface-1`.
- Padding généreux (24-32 px).
- Icône en haut à gauche, label uppercase wide tracking en gris.
- Valeur en très gros (text-3xl ou text-4xl).
- **`ComparisonKpiCard`** ajoute un delta % colorisé (vert pour positif, rouge pour négatif) avec petite flèche.

### 6.2 Le Status Badge

Petit, arrondi, fond pâle + texte saturé :

- `bg-success-bg text-success-text border border-success-border` pour "Paid".
- Variantes par statut, jamais d'aplat saturé.

### 6.3 La Cart Item Row (POS)

Pattern unique au POS :

- Quantité préfixe + nom + modifiers en sous-ligne.
- Boutons `−` quantité `+` alignés horizontalement.
- Icône modifier (tag) + icône delete (trash).
- Prix monospace aligné à droite.

### 6.4 Le Combo Selector

Modal avec sections (`ComboGroupSection`) pliables :

- Header de groupe : "Choose 1 of 4" en uppercase.
- Tiles produits avec photo + nom + surcoût éventuel.
- Sélection active : bordure gold + check mark.

### 6.5 La Date Range Picker

Présent dans tous les reports :

- Bouton qui ouvre un popover avec calendrier double mois.
- Presets shortcuts (Today, Yesterday, Last 7 days, This month, etc.).
- Comparaison période optionnelle (toggle).

### 6.6 Le Sound Indicator

Discret, dans le header POS et KDS :

- Icône speaker (Lucide) en gris si muet, en gold si actif.
- Cliquable pour toggle rapide.

---

## 7. Les comportements interactifs

### 7.1 Animations

Toutes les animations respectent `--transition-fast` (~150ms) ou `--transition-base` (~200ms).

| Animation | Où | Effet |
|---|---|---|
| Fade in/out | Modales, dropdowns | Doux, jamais brutal |
| Slide | Side panels, modales mobile | Depuis le bord pertinent |
| Scale | Boutons au clic | Légère réduction (0.97) puis retour |
| Shimmer | Skeletons loading | Effet de balayage subtil sur les placeholders |
| Pulse | Badges urgents (KDS critical) | Battement régulier |
| Promo apparition (display) | Customer Display | Fade in du nouveau prix après remise |

### 7.2 Hover states

**POS** : très subtils — fond passe `surface-1` → `surface-2`, légère élévation pour les boutons.

**Backoffice** : plus visibles (curseur souris) — surlignage row, underline sur les liens, scale 1.02 sur les cards cliquables.

### 7.3 Focus states

Tous les éléments focusables (TAB) montrent un **outline gold 2px** avec offset 2px. Accessibilité préservée.

### 7.4 Sons

| Son | Quand | Volume |
|---|---|---|
| `playOrderReadySound` | Une commande KDS passe en `all ready` | Moyen, configurable |
| Bip nouvelle commande KDS | Réception sur la station | Discret |
| Alerte urgente KDS | Item > seuil critique | Fort, répété |
| Validation PIN | Succès auth | Doux |
| Erreur réseau | LAN déconnecté | Moyen |

Tous configurables depuis Settings → POS Configuration / KDS Configuration.

---

## 8. Les états — Loading, empty, error

### 8.1 Loading

- **Skeletons** systématiques (Skeleton, SkeletonTableRow) — rectangles gris doux avec shimmer.
- **Spinners** discrets pour les actions ponctuelles (refresh button avec rotation).
- **Suspense boundaries** sur chaque route lazy-loaded.

### 8.2 Empty

- **EmptyState** component dédié avec :
  - Icône Lucide grise centrée.
  - Titre principal en `text-primary`.
  - Sous-titre explicatif en `text-secondary`.
  - (Parfois) CTA primaire pour créer la première entité.

Exemples : "No customers yet — Add your first" / "No sales today yet" / "No data available".

### 8.3 Error

- **Error boundaries** par module (`ModuleErrorBoundary`) : capture les erreurs React, affiche un message de recovery + bouton retry.
- **Toast errors** via Sonner : top-right, rouge, auto-dismiss 5s.
- **Inline form errors** : texte rouge sous les inputs invalides.
- **Page errors** : fallback complet si une page entière crash.

---

## 9. Mobile et tablet — Adaptation responsive

### 9.1 POS

- **Capacitor Android** support natif via `npx cap sync`.
- Layout **adaptable** : sur tablette portrait, le cart bascule en bas plutôt qu'à droite.
- Boutons restent **tactiles à toutes tailles** (≥48px).
- Customer Display **conçu pour 1080p paysage** typiquement.

### 9.2 Backoffice

- **Responsive partiel** : la sidebar collapse en hamburger sur viewport < 768px.
- Tables → cards stackées sur mobile pour la lisibilité.
- **Pas optimisé pour smartphone** par design — c'est un outil bureau / tablette.

### 9.3 Mobile routes

`/mobile/*` propose des vues simplifiées pour la consultation rapide depuis un smartphone (orders, stock, customers). Pas de saisie complexe.

---

## 10. Différences fondamentales POS vs Backoffice (synthèse)

| Dimension | POS | Backoffice |
|---|---|---|
| **Thème** | Dark (`.theme-pos`) | Light (`.theme-backoffice`) |
| **Couleur dominante** | Noir / charbon | Off-white / ivoire |
| **Surface 0** | `#0C0C0E` | `#F8F8F6` |
| **Mission** | Action rapide, contact client | Configuration, analyse, décision |
| **Tempo cible** | < 1s par action | 3-5s acceptable |
| **Navigation** | Pas de menu, fullscreen | Sidebar persistante + breadcrumbs |
| **Input principal** | Touch + Virtual Keypad | Souris + clavier physique |
| **Densité info** | Sélectivement faible (lisibilité rush) | Maximale (tables, charts) |
| **Boutons primaires** | Très gros, or massif | Standards, or contenu |
| **Modales** | Plein écran fréquent | Centrées, taille adaptée |
| **Scroll** | Limité, contenu critique visible | Long, scroll attendu |
| **Animations** | Minimales, instantanéité | Légèrement plus marquées |
| **Audio** | Cruciale (bips, alertes) | Optionnelle |
| **Realtime** | Critique, < 1s | Important, < 5s |
| **Profil utilisateur** | Cashier, barista, serveur, cuisinier | Gérant, manager, comptable, admin |
| **Durée session moyenne** | 8h continues | Sessions courtes 5-30 min |
| **Ergonomie** | Tactile, gestes simples, gros boutons | Multi-pane, drag & drop, formulaires |

---

## 11. La constante invisible — La cohérence cross-app

Malgré ces divergences, **les deux apps se ressemblent** parce qu'elles partagent :

1. **Le même or** `#C9A55C` — la signature de marque qui traverse partout.
2. **La même typographie** (Inter / Playfair Display / Fraunces / JetBrains Mono).
3. **La même grille spatiale** (`--space-*` tokens cohérents).
4. **Les mêmes radius** (`--radius-*` cohérents).
5. **Les mêmes patterns** : labels uppercase tracking, KPI cards, badges, status colors sémantiques.
6. **Le même langage de marque** ("The Breakery", "French Bakery & Pastry", logo croissant).

Un utilisateur qui bascule du POS au Backoffice **ressent immédiatement** que c'est la même app — juste habillée pour un autre tempo.

---

## 12. Le legacy V2 vs la vision V3

> ⚠️ **Note de cadrage (2026-06-27)** : V2 (AppGrav monolithe) n'a **jamais été déployée** — voir MEMORY `v2-not-in-production`. Le produit vivant est le **monorepo V3** (2 apps : `apps/pos` + `apps/backoffice`). Les références ci-dessous à un « monolithe Vercel », à `breakery-platform/`, aux apps `kitchen`/`comptable` et aux artefacts `_bmad/` décrivent une **ancienne vision de planification**, pas l'état livré. Pour l'état courant, la source de vérité est [`reference/02-design-system/`](reference/02-design-system/).

### 12.1 Tokens & référence visuelle (canoniques V3)

- Les **tokens canoniques** vivent dans [`reference/02-design-system/02-tokens.md`](reference/02-design-system/02-tokens.md).
- Les **screenshots de référence** sont dans [`docs/Design/`](Design/) (`backoffice/`, `caissapp/`).
- Les **2 thèmes** (`.theme-pos` dark + `.theme-backoffice` light) sont la mécanique réellement en place.

### 12.2 Ce qui évolue en V3

V3 (en cours dans `breakery-platform/`) étend le système à **4 thèmes** :

| App V3 | Thème |
|---|---|
| `caissapp` | `.theme-pos` (dark, hérité) |
| `kitchen` | `.theme-kds` (nouveau — variant cuisine optimisé) |
| `backoffice` | `.theme-backoffice` (light, hérité) |
| `comptable` (Pulse) | `.theme-pulse` (nouveau — variant comptable, plus institutionnel) |

Plus une **variante B2B gold-accent** activable contextuellement.

Pour la spec V3 complète, voir :

- `_bmad/output/planning-artifacts/ux-design-specification/design-system-foundation.md`
- `_bmad/output/planning-artifacts/ux-design-specification/visual-design-foundation.md`
- `_bmad/output/planning-artifacts/ux-design-specification/component-strategy.md`

Aucun token V2 n'est supprimé en V3 — l'extension est **strictement additive**.

---

## 13. Où trouver quoi (carte de navigation design)

| Tu cherches… | Va voir |
|---|---|
| Les **tokens techniques** (valeurs hex, scales, classes Tailwind) | [`reference/02-design-system/02-tokens.md`](reference/02-design-system/02-tokens.md) |
| L'**overview Luxe Dark** + fondamentaux | [`reference/02-design-system/01-luxe-dark-overview.md`](reference/02-design-system/01-luxe-dark-overview.md) |
| Les **primitifs shadcn** + **feature components** | [`reference/02-design-system/03-shadcn-primitives.md`](reference/02-design-system/03-shadcn-primitives.md) · [`04-feature-components.md`](reference/02-design-system/04-feature-components.md) |
| Les **layouts** + **responsive / mobile** | [`reference/02-design-system/05-layouts.md`](reference/02-design-system/05-layouts.md) · [`07-responsive-mobile.md`](reference/02-design-system/07-responsive-mobile.md) |
| Les **screenshots Backoffice** de référence | [`docs/Design/backoffice/`](Design/backoffice/) |
| Les **screenshots POS** de référence | [`docs/Design/caissapp/`](Design/caissapp/) |
| Les **fiches métier business-first** par module | [`reference/04-modules/`](reference/04-modules/) (Partie IV de chaque module) |

---

## 14. En une phrase

Le design d'AppGrav V2 est **deux paradigmes opposés tenus par une même main d'or** : le POS plonge le cashier dans une nuit théâtrale tactile où chaque produit émerge d'une vitrine, le Backoffice pose le gérant devant un bureau d'ivoire dense et structuré où chaque chiffre se compte — mais les deux partagent l'or vieilli `#C9A55C`, l'italique Playfair pour le branding, l'Inter pour l'opérationnel, les labels uppercase wide tracking comme signature, les mêmes couleurs sémantiques, le même langage de marque "Luxe Bakery" — pour qu'un utilisateur qui bascule entre les deux sente toujours qu'il est dans la même boulangerie, juste passé du comptoir vers l'arrière-boutique.
