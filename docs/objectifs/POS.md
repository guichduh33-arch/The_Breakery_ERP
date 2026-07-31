# Module POS — Objectif métier

> **Héritage V2** : décrit la vision business cible. **V2 jamais déployée en prod**. Implémentation réelle = V3 monorepo (`apps/pos`).
>
> **Périmètre fonctionnel** : ce document décrit **ce que l'App POS sert à faire au quotidien** pour The Breakery,
>
> **Révision** : 2026-07-28 · **Statut** : Livré
> **ADR applicables** : ADR-009 (cycle de vie des commandes), ADR-010 (verrou cuisine + perte obligatoire), ADR-013 (avoir client, nonce PIN manager sur toute remise money-path, ordre canonique des totaux), ADR-015 (hors-ligne : tous les moyens de paiement sauf l'avoir, sans limite de durée)
>
> **Convention** : aucune version d'objet DB (`_vN`) dans cette fiche — on cite la
> famille (`close_shift`, `complete_order_with_payment`). La version vivante se
> vérifie dans `supabase/migrations/` et au call-site, jamais ici.

---

## 1. Raison d'être

L'App POS est **le poste de travail de la caisse** de The Breakery. Elle répond à une question simple mais omniprésente :

> *"Comment je prends une commande, je l'envoie en cuisine, j'encaisse et je sors le client en moins d'une minute, sans erreur, à 200 commandes par jour ?"*

C'est l'écran qui transforme **un client devant le comptoir** en **transaction propre, comptabilisée, traçable** : produit, modificateurs, remise éventuelle, taxe PB1, paiement, ticket, ouverture du tiroir-caisse, déduction stock, envoi cuisine, attribution fidélité.

Le POS est **fullscreen, sans menu de navigation back-office**, conçu pour une utilisation **touch-first** par une cashier qui ne lâche pas l'écran des yeux pendant le rush. Toute friction inutile coûte 5 secondes — et 5 secondes × 200 transactions = 17 minutes de file d'attente par jour.

Lest **bien plus que la caisse** : il intègre la gestion de session (ouverture / fermeture / écart), les ardoises (paiement différé), les commandes différées, l'historique transactionnel, la liaison avec le KDS, la tablette serveur, le customer display et le tiroir-caisse physique.

---

## 2. Les 6 zones de l'écran principal

L'écran principal est structuré en **6 zones permanentes** :

| Zone | Job-to-be-done |
|---|---|
| **Menu top bar** | Navigation modes (table / takeaway / delivery), accès aux modales (clients, ardoises, historique, paramètres) |
| **Category Nav** | Sélecteur de catégorie produit (Pains, Viennoiseries, Boissons…) |
| **Product Grid** | Grille tactile des produits filtrés par catégorie, avec stock badge et prix |
| **Combo Grid** | Grille séparée des combos (combos = produits composés à prix groupés) |
| **Cart** | Panier en direct avec lignes, totaux, taxes, remises |
| **Cart Actions** | Boutons d'action : Hold, Discount, Customer, Send to KDS, Pay |

Toute l'interface est conçue pour qu'un caissier puisse encaisser **sans toucher le clavier physique** — un Virtual Keypad apparaît au besoin pour les saisies (montant, recherche client, code produit).

---

## 3. Les 6 invariants du module

Quel que soit le moment d'utilisation, le POS garantit toujours :

1. **Une session de caisse ouverte avant toute transaction**. Pas de session = pas de vente possible. Force la discipline de fond de caisse et de réconciliation.
2. **Touch-first, sans dépendance au clavier**. Tous les boutons sont dimensionnés pour le doigt, le Virtual Keypad gère les saisies textuelles.
3. **Cart locké après envoi cuisine** (ADR-010). Les items envoyés au KDS
   deviennent verrouillés — et la garde est **serveur**, pas seulement UI :
   l'annulation d'une ligne verrouillée exige le PIN manager **et une
   déclaration de perte obligatoire** (quantité pré-remplie, ajustable par
   l'autorisateur, déduite via le circuit waste recette-aware et rattachée à
   la commande) ; la baisse de quantité exige une autorisation manager à usage
   unique + la perte sur le delta ; la suppression est refusée. La hausse de
   quantité passe par l'ajout d'une nouvelle ligne, jamais par la retouche.
4. **Auto-évaluation des promotions** à chaque changement de panier via `useCartPromotions`. Le caissier ne calcule jamais : le système applique automatiquement les bonnes remises.
5. **Tax PB1 10% incluse dans tous les prix**. Le client voit toujours le prix total ; le système isole la taxe (`tax = total × 10/110`) pour la comptabilité.
6. **Une commande atomique : items + paiements en une seule transaction**. Le POS poste l'Edge Function `process-payment`, qui appelle côté serveur la RPC money-path courante (famille `complete_order_with_payment`) : celle-ci crée la commande et tous ses paiements dans une transaction Postgres unique — pas de risque de paiement orphelin si la connexion saute. Le POS n'appelle jamais la RPC directement.

---

## 4. Démarrer une journée — Ouvrir la session

Avant la première vente, le caissier ou le manager doit **ouvrir une session de caisse** :

- Comptage du fond de caisse initial en espèces.
- Sélection du terminal POS sur lequel la session s'ouvre.
- Attribution au cashier.
- Création d'un enregistrement `pos_sessions` avec `opening_cash`.

Tant qu'aucune session n'est ouverte, le POS refuse toute transaction et affiche le bouton "Open shift" en plein écran.

Bénéfice métier : **fond de caisse rigoureusement chiffré au départ**, condition sine qua non de la réconciliation de fin de journée.

---

## 5. Prendre une commande — Le geste principal

### 5.1 Choisir le type de commande

Avant ou pendant la composition, le caissier choisit le **type** :

- **Dine-in** — service en salle, déclenche la sélection d'une table sur le plan de salle.
- **Takeaway** — emporter.
- **Delivery** — livraison.

Le type pilote ensuite la logique de paiement (différé acceptable pour dine-in, immédiat pour takeaway/delivery) et l'affichage cuisine (sticker emballage takeaway, etc.).

### 5.2 Ajouter des produits

Trois mécanismes complémentaires :

- **Clic produit dans la grille** → ajout direct au panier.
- **Combo selector** → un combo (ex: "petit-déjeuner") déclenche un sélecteur de composants qui permet de choisir (croissant **ou** pain au chocolat + café **ou** thé).

### 5.3 Modificateurs et variantes

À l'ajout d'un produit, deux modales peuvent apparaître :

- **Modificateurs** — options avec surcoût (lait d'amande +5k, sucre +2k, supplément chocolat +3k).
- **Sélecteur de variantes** — variantes de prix selon une caractéristique (taille S/M/L, parfum).

Les modificateurs sont stockés JSONB sur l'item du panier, leur surcoût est inclus dans le `total_price` de la ligne.

Dans un combo, les modificateurs d'un composant retenu se posent **dans le
sélecteur de combo lui-même**, sous l'option concernée — mêmes questions,
mêmes obligations et même facturation que si le composant était vendu seul
(ADR-017). Le caissier ne rouvre jamais une seconde modale après coup.

### 5.4 Remise

Bouton **Discount** → la modale de remise :

- Remise en % ou en montant fixe.
- Remise sur tout le panier ou sur un item ciblé.
- **PIN manager** requis si la remise dépasse le seuil configuré.
- Trace obligatoire : raison de la remise (geste commercial, défaut produit, fidélité, ami du gérant…).

### 5.5 Lier un client

Bouton **Customer** → la recherche client :

- Recherche par nom, téléphone, e-mail, numéro de membre, **scan QR** du client.
- Affiche la fiche client avec palier fidélité, points, historique.
- Bouton "Create new" si le client n'existe pas.
- La sélection applique automatiquement le pricing tier du client (retail / wholesale / discount % / catégorie custom).

Bénéfice métier : **transformer chaque vente anonyme en vente nominative** quand c'est pertinent, sans ralentir si ça ne l'est pas.

---

## 6. Envoyer en cuisine — Le moment où le panier se verrouille

Bouton **Send to Kitchen** → les items sont envoyés au KDS, **et le panier passe en mode locked** :

- Chaque item envoyé est marqué `is_locked = true` (posé par `send_items_rpc`
  à l'émission du KOT).
- L'icône d'un cadenas apparaît sur la ligne.
- L'annulation d'une ligne verrouillée passe par la modale dédiée : raison +
  PIN manager (header, vérifié par l'EF `cancel-item`) + **quantité de perte**
  pré-remplie à la quantité de la ligne, ajustable 0..qty (0 = rien n'était
  encore produit — la déclaration reste obligatoire et tracée). La RPC
  `cancel_order_item_rpc` refuse un cancel verrouillé sans déclaration.
- La perte est déduite en stock via le circuit waste recette-aware (produit
  fini, composants de combo ou ingrédients de recette selon le produit) et
  rattachée à la commande — visible dans les mouvements de stock et l'audit.

Pourquoi ce verrouillage : **un item envoyé en cuisine consomme un coût** (le boulanger commence à faire le sandwich). Le retirer sans contrôle = fraude potentielle (encaisser, annuler, empocher).

Le caissier peut **continuer à ajouter** des items au panier après envoi cuisine (le client commande encore un café) : les nouveaux items ne sont pas locked tant qu'ils n'ont pas été envoyés à leur tour. C'est une **commande à items mixtes** locked + non-locked.

Verrouillé veut dire verrouillé partout : le Backoffice (page Orders) applique
les mêmes règles — baisse seule sous autorisation manager avec perte sur le
delta, suppression refusée. Il n'existe aucun chemin d'édition silencieuse
d'un item parti en cuisine (ADR-010).

---

## 7. Mettre en attente — Held orders

Spécificité du dine-in : un client peut commencer sa commande, manger, puis ajouter plus tard.

Bouton **Hold** → la commande est mise en attente (statut `held`) :

- Le panier est vidé, le caissier peut servir le client suivant.
- Plus tard, depuis la liste des commandes en attente, le caissier reprend la commande où elle en était.
- Le `useRestoreHeldOrders` hook gère la restauration propre du state cart.

Bénéfice métier : **un comptoir ne se bloque jamais sur une commande non finalisée**. Plusieurs commandes peuvent vivre en parallèle sans collision.

---

## 8. Encaisser — Le moment décisif

Bouton **Pay** → la modale de paiement s'ouvre. C'est l'écran le plus riche du POS, structuré en plusieurs sous-vues :

### 8.1 Sélection méthode

Le sélecteur de méthode propose les méthodes activées dans Settings : Cash, Card, QRIS, GoPay, OVO, DANA, Bank Transfer, B2B Credit, POS Outstanding.

### 8.2 Saisie du montant

- Saisie du montant au clavier virtuel.
- Pour Cash : montant reçu → calcul automatique de la monnaie à rendre, arrondie à 100 IDR.
- Pour digital : montant exact pré-rempli.

### 8.3 Paiement multiple (split)

Le client peut payer **moitié cash + moitié carte**. La modale supporte plusieurs paiements ajoutés à la liste :

- Chaque paiement est ajouté un par un avec sa méthode et son montant.
- Le bandeau de statut affiche : Total dû / Total payé / Reste à payer.
- Validation seulement quand "Reste à payer" = 0.

### 8.4 Split par item

Cas dine-in où 4 amis veulent payer chacun **ce qu'ils ont consommé** :

- Le flux de split (`SplitPaymentFlow`) propose trois modes : **par items**, parts égales, montants libres.
- En mode « par items », l'étape d'assignation affiche les lignes du panier et le caissier attribue les unités à chaque payeur.
- Le système calcule son total individuel. La **quote-part de taxe par payeur** n'est **pas livrée** : le total d'un payeur est la somme de ses lignes.
- Chaque sous-paiement crée son propre paiement dans la même commande.

### 8.5 Paiement différé (ardoise)

Si la méthode "POS Outstanding" est choisie, la commande passe en statut `unpaid` :

- Pas d'encaissement immédiat.
- Le client (lié obligatoirement) doit régler plus tard.
- La commande apparaît dans la vue des ardoises (`/pos/debts`) jusqu'à règlement.

### 8.6 Validation finale

À la validation, le POS poste l'Edge Function `process-payment`, qui appelle côté serveur la RPC money-path courante (famille `complete_order_with_payment`) dans une transaction unique. Le POS n'appelle jamais la RPC directement — c'est l'EF qui porte l'idempotence de retry (`x-idempotency-key`) et la vérification du PIN de remise. La RPC exécute **atomiquement** :

1. Création de la commande en base avec items et modificateurs.
2. Création de tous les paiements liés.
3. Mise à jour du stock (déduction).
4. Génération des écritures comptables (trigger Postgres).
5. Attribution des points fidélité au client (si lié).
6. Envoi KDS (si pas déjà envoyé).
7. Print du reçu (si auto-print activé dans Settings).
8. Ouverture du tiroir-caisse (si cash).
9. Affichage de `PaymentSuccess` avec total et monnaie à rendre.

Bénéfice métier : **un seul clic produit toute la chaîne**. Si la connexion saute après le clic, soit tout passe, soit rien — jamais un paiement orphelin.

---

## 9. Annuler / rembourser — Les actions de réparation

### 9.1 Void d'une commande

Bouton accessible depuis la modale détail ou l'historique transactionnel :

- L'annulation exige : PIN manager + raison obligatoire.
- L'annulation passe la commande en statut `voided`.
- Le stock est ré-crédité.
- Les points fidélité sont retirés au client si attribués.
- Génère une écriture comptable de contre-passation.

### 9.2 Refund partiel ou total

La modale de remboursement permet de rembourser :

- Total — rembourse toute la commande.
- Partiel — sélection des items à rembourser.
- Méthode de remboursement (cash sortie de caisse, transfer back…).
- PIN manager exigé.
- Trace audit complète.

Bénéfice métier : **un client mécontent est traité en 30 secondes**, sans bricolage ni excel parallèle.

---

## 10. Vue **Outstanding** — Les ardoises POS

`/pos/debts` (page séparée du POS principal mais dans le même module) :

- Liste de toutes les commandes en statut `unpaid` (ardoises).
- Par client : combien dépend depuis quand.
- Vieillissement (aging) visuel.
- Bouton "Encaisser" qui ouvre la même modale de paiement que pour une commande nouvelle.
- Bouton "POS Outstanding History" pour voir les ardoises soldées (avec délai de paiement).

Cas d'usage typique : un habitué emporte son café à 8h sans payer ("je passe ce soir"), reviens à 18h, le caissier solde son ardoise en 10 secondes.

Bénéfice métier : **autoriser le crédit informel** au comptoir tout en gardant trace de tout, sans risque qu'une ardoise se perde.

---

## 11. Le Virtual Keypad — La saisie touch-first

Spécificité ergonomique critique : le POS est conçu pour fonctionner **sans clavier physique** :

- `VirtualKeypadProvider` enveloppe toute l'arbre `/pos`.
- Tout input texte ou nombre dans le POS déclenche automatiquement le clavier virtuel.
- Deux dispositions : pavé numérique (montants) et clavier texte (recherche client, nom de commande).
- Fermeture automatique au blur ou validation.

Bénéfice métier : **un seul écran tactile suffit**. Pas de bureau, pas de clavier sur le plan de travail. Hygiène + ergonomie + maintenance.

---

## 12. Les modales et outils satellites

Le POS expose un grand nombre de modales et outils accessibles depuis la barre de menu :

| Modal | Job |
|---|---|
| **Analytique caissier** | Stats personnelles du cashier en cours de session (CA, panier moyen, méthodes) |
| **Historique transactionnel** | Les transactions du jour, avec drill-down |
| **Panneau commandes tablette** | Commandes envoyées depuis les tablettes serveur, à intégrer dans une commande caisse |
| **Sessions actives** | Voir toutes les sessions caisse actives sur les autres terminaux |
| **Réglages du terminal** | Réglages locaux (volume son, taille police, layout) |
| **Vérification PIN** | Gardien universel — déclenchée par toute action sensible |

---

## 13. Réceptionner les commandes tablette

Le panneau des commandes tablette liste en continu les commandes envoyées depuis les **tablettes serveur** en salle :

- Un serveur prend une commande à table avec sa tablette.
- La commande est créée côté serveur et **part aussitôt en cuisine** ; elle apparaît au comptoir en attente de reprise.
- Le caissier la **reprend** : elle passe dans son panier, et il l'encaisse. La reprise est exclusive — deux caissiers ne peuvent pas se disputer la même commande.
- Une commande dont toutes les lignes ont été annulées par le flux manager se **clôt** depuis ce même panneau, sans encaissement.

Bénéfice métier : **dispatcher la prise de commande entre la salle et le comptoir** sans ressaisie.

---

## 14. Couplage temps réel — Les 4 canaux

Le POS dialogue en direct avec **4 canaux Realtime** :

1. **KDS** (`useKdsStatusListener`) — change d'état des items cuisine, son "order ready", refresh des badges.
2. **Customer Display** (`useDisplayBroadcast`) — diffuse le cart en cours via BroadcastChannel pour affichage sur l'écran client.
3. **Commandes salle** — les commandes tablette en attente arrivent au comptoir, avec un rattrapage périodique pour qu'un événement perdu ne les fasse pas disparaître.
4. **Live Sessions** (`useAllOpenSessions`) — synchro avec les autres terminaux POS sur le même LAN.

Bénéfice métier : **un écosystème cohérent en temps réel**, sans qu'aucun écran nécessite de rafraîchissement manuel.

---

## 15. Fermer la journée — End of day

À la fin du service, le manager déclenche la clôture :

1. **Réconciliation cash** :
   - Le système affiche le cash attendu (opening + ventes cash − refunds).
   - Le manager compte physiquement le tiroir.
   - Saisie du cash compté → écart calculé.
   - Si écart > seuil, raison obligatoire.

2. **Statistiques session** :
   - CA total, nombre de transactions, panier moyen.
   - Répartition par méthode de paiement.
   - Liste des voids / refunds.

3. **Validation et clôture** :
   - Statut session → `closed`.
   - Génération automatique d'un journal cash (mouvement comptable).
   - Impression du Z (récapitulatif clôture).

L'historique des sessions permet de **revoir les sessions passées** (jusqu'à 30 jours) avec leurs écarts.

Bénéfice métier : **clôture rigoureuse en 5 minutes** avec preuves chiffrées de cohérence cash. Aucune session ne se ferme sans réconciliation.

---

## 16. Mécaniques transverses — Comment le POS dialogue avec le reste

| Module | Relation |
|---|---|
| **Products / Categories** | Le POS lit le catalogue produit + les prix selon le client lié. |
| **Customers** | Recherche client, attribution fidélité auto, application du pricing tier. |
| **Inventory** | Chaque vente déduit le stock ; le badge `StockBadge` alerte sur les produits en rupture. |
| **Orders** | Les commandes créées au POS apparaissent dans `/orders` pour consultation. |
| **KDS** | Send to Kitchen alimente le KDS ; statuts cuisine remontent au POS. |
| **Accounting** | Triggers Postgres génèrent les JE automatiquement à la complétion de chaque commande. |
| **Promotions / Combos** | `useCartPromotions` évalue à chaque changement de cart. |
| **Reports** | Les ventes alimentent ~16 reports de la catégorie Sales. |
| **Settings** | Toggles "auto-print", "auto-send KDS", "require customer", "session timeout" pilotent le comportement. |

---

## 17. Ce que le module ne fait **pas** (par design)

- Le POS **ne gère pas le catalogue**. Pas d'ajout / modification de produit ici — uniquement la vente.
- Le POS **ne fait pas de promotion manuelle complexe**. L'engine promo est dans le module Promotions, le POS ne fait que l'appliquer.
- Le POS **ne crée pas de commande B2B**. Le canal wholesale a son propre flux dans le module B2B.
- Le POS **ne valide pas de stock impossible** sauf si le toggle "allow oversell" est activé dans Settings.
- Le POS **ne pilote pas l'item status** côté cuisine (preparing → ready → served). C'est le KDS qui le fait.

---

## 18. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| ✅ | **Offline complet — tous moyens de paiement** | **Livré (ADR-015).** Pendant une coupure : prise de commande **et** encaissement par toute méthode **sauf l'avoir client**, partage d'addition compris (1 à 5 règlements), **sans limite de durée**. L'EDC carte/QRIS a sa propre connexion SIM, le POS ne fait qu'enregistrer le règlement ; la file locale est rejouée au retour du réseau. Réglage `offline_payments_enabled`, **défaut OFF**. L'avoir reste online-only : son solde se vérifie serveur sous verrou, et un replay refusé bloquerait toute la file. Contrôle EDC déjà assuré par le comptage aveugle de la clôture de shift. **Reste dû : validation en conditions réelles de boutique.** |
| 🔴 | **Pre-authorization cartes** | Pour les commandes dine-in, pré-autoriser la carte à l'arrivée et finaliser au départ. |
| 🟠 | **Réservation / pré-commande client** | Prendre une commande à retirer plus tard (anniversaire, gâteau sur mesure) avec acompte. |
| 🟠 | **Tableau "Tables ouvertes" en vue principale** | Vue dédiée pour le dine-in avec statut de chaque table (vide / commandée / servie / à encaisser). |
| 🟠 | **Quick reorder** | "Refaire la même commande" depuis l'historique pour les habitués. |
| 🟡 | **Voice search** | Recherche client / produit à la voix dans le rush. |
| 🟡 | **Suggested upsell** | Proposer "voulez-vous un café avec ?" basé sur l'analyse basket. |
| 🟢 | **Customer-facing payment QR** | QR généré à la volée pour paiement direct par l'app banque client. |

---

## 19. En une phrase

Le module POS est **le poste de combat de la caisse** de The Breakery : il transforme un client devant le comptoir en transaction propre, comptable et traçable en moins d'une minute, supporte sans flancher 200 commandes par jour avec modifiers, splits, ardoises, promos auto et fidélité, verrouille tout ce qui sort de cuisine pour bloquer la fraude, dialogue en direct avec le KDS, la tablette serveur et l'écran client — pour qu'aucune vente ne soit ni mal saisie, ni mal encaissée, ni perdue entre le geste de la cashier et le tiroir-caisse.
