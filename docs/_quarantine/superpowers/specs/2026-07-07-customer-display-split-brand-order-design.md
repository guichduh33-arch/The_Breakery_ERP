# Customer Display — split marque / commande (design)

**Date :** 2026-07-07 · **Surface :** `apps/pos` route `/display` uniquement · **DB :** aucune migration · **Money-path :** intouchée

## Demande (propriétaire, 2026-07-07)

> « Améliore le customer display avec notre logo et un slogan sur une moitié et la commande sur
> l'autre moitié avec le détail des modifiers des produits, ainsi que les détails de la méthode de
> paiement avec le détail des taxes incluses, les points cumulés pour les clients fidèles. »

## Design retenu

### Layout 50/50 permanent

Toutes les vues du display (idle, panier live, confirmation paiement) partagent le même squelette
dans `BrandedLayout` : **moitié gauche = panneau marque**, **moitié droite = contenu d'état**.

- **Gauche — `CDBrandPanel`** : `BrandLogo` XL (croissant + wordmark, tagline SVG désactivée) +
  slogan sous le logo en Playfair italique. Slogan configurable par terminal
  (`posSettingsStore.displaySlogan`, nouveau champ Settings → KDS & Display) ; défaut
  « French Bakery & Pastry ».
- **Droite** selon l'état :
  - *idle* : file pickup existante (`CurrentOrderCard` + `OrderQueueTicker`) — inchangée.
  - *panier live* : liste des lignes + total (`CustomerDisplayView`, restructurée).
  - *payment_complete* : nouvelle `CDPaymentPanel` (Merci enrichi).

### Détail des modifiers (panier live)

Le broadcast `cart_update` transporte déjà les `CartItem[]` complets ; seuls le mapping page et la
vue les ignoraient. `CustomerDisplayLine` gagne `modifiers?: { label, price_adjustment }[]`, rendus
sous le nom du produit (« + Extra shot +Rp 5 000 » / ajustement 0 sans montant). Correction au
passage : `line_total` du mirror intègre désormais les ajustements de modifiers
(`(unit_price + Σ adj) × qty`), aligné sur `calculateTotals`.

### Taxes incluses

- `CartUpdateMessage.totals` gagne `tax_amount`, calculé au **taux serveur** (`useTaxRate()` passé
  en paramètre à `useCartBroadcast(taxRate)`) sur le total post-promotions, même formule PB1 que
  `calculateTotals` (`roundIdr(total × r / (1+r))`). Le hook garde `DEFAULT_TAX_RATE` en défaut de
  paramètre (tests sans QueryClient).
- La bande de totaux affiche « Tax included · Rp X » (prix TTC — la taxe est extraite, pas ajoutée).

### Confirmation de paiement enrichie

`PaymentCompleteMessage` gagne : `tax_amount`, `customer_name`, `points_earned`,
`loyalty_balance_after` (null quand non applicable). Émetteur unique : `SuccessModal`, qui possède
déjà toutes ces valeurs (server-authoritative). `CDPaymentPanel` affiche : Merci {prénom} !,
« Paiement reçu · {méthode} » (labels partagés `paymentMethods.ts`), total, taxes incluses,
monnaie à rendre (cash uniquement), points gagnés + nouveau solde (clients fidèles).

### Retraits

`CDActiveCartView` est supprimé : sa branche welcome est remplacée par `CDBrandPanel`, sa branche
paiement par `CDPaymentPanel`, et sa branche liste-panier était déjà morte (la page routait ces
états vers `CustomerDisplayView`).

## Hypothèses (session autonome — à invalider si besoin)

1. Le slogan par défaut reste la tagline existante « French Bakery & Pastry » ; configurable par
   terminal plutôt qu'en `business_config` (cohérent avec `displayFooterMessage`).
2. Copy : anglais pour l'UI, moments français conservés (« Merci ! », « Monnaie à rendre »),
   miroir de l'existant.
3. La file pickup reste sur la moitié droite en idle (valeur opérationnelle conservée).

## Tests

Smokes display mis à jour (`CustomerDisplayView`, `cart-broadcast-*`, page) + nouveaux asserts :
modifiers rendus, ligne taxe, méthode/points sur `CDPaymentPanel`. Zéro pgTAP (aucun changement DB).
