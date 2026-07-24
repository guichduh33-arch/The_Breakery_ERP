# Module Promotions & Combos — Objectif métier

> **Statut V2/V3** : décrit la vision business cible. **V2 jamais déployée**. Implémentation V3 = DONE (`evaluate_promotions_v1`, `usePromotionsAutoEval`, `usePromotionsRealtime`, features `promotions` BO + POS, combos avec groupes). Voir [`../V2_V3_GLOSSARY.md`](../V2_V3_GLOSSARY.md).
>
> **Périmètre fonctionnel** : ce document décrit **ce que le module Promotions & Combos sert à faire au quotidien** pour The Breakery, 

---

## 1. Raison d'être

Le module Promotions & Combos est **le moteur commercial** de The Breakery. Il répond à une question simple mais déterminante pour la marge :

> *"Comment je propose un menu petit-déj à 35 000 IDR au lieu de 42 000 si on achète croissant + café, comment je fais −20 % le mercredi sur toutes les viennoiseries, comment j'offre le 3ᵉ cookie acheté, et comment je suis sûr que le caissier n'oubliera jamais d'appliquer la promo ?"*

C'est le module qui transforme **des règles commerciales écrites au tableau** en **calcul automatique appliqué à chaque panier**. Sans lui, chaque promo est une consigne à mémoriser (avec son lot d'oublis et d'erreurs de calcul) ; avec lui, dès qu'un panier remplit une condition, la remise s'applique d'elle-même, le caissier la voit, le client la voit, le ticket l'imprime.

Le module a **deux faces** :

- **Promotions** — règles automatiques (% sur catégorie, montant fixe, BOGO, produit gratuit).
- **Combos** — produits composés à prix groupés (menu, formule, bundle).

Les deux faces partagent le même moteur d'évaluation et le même invariant : **zéro saisie manuelle au moment de la vente** — le système fait le calcul.

---

## 2. Les deux familles d'outils

| Famille | Quoi | Saisie | Application |
|---|---|---|---|
| **Promotions** | Règles de remise conditionnelles | Page `/products/promotions` (un seul écran de configuration) | Auto-évaluées à chaque changement de panier |
| **Combos** | Produits composés vendus comme un seul SKU à prix groupé | Page `/products/combos` (création de combos + groupes) | Sélectionnés explicitement au POS via `ComboSelectorModal` |

Les deux résident administrativement dans le module **Products** (page parente) mais constituent un domaine métier autonome avec ses propres règles.

---

## 3. Les 5 invariants du module

Quelle que soit la promo ou le combo, le module garantit :

1. **Évaluation automatique au POS**. Le hook `useCartPromotions` recalcule à chaque changement de panier — ajout, retrait, modification de quantité, application d'une remise manuelle.
2. **Une seule meilleure promo par item**. Si deux promos s'appliquent, le moteur choisit celle qui avantage le plus le client (les promos ne s'empilent pas par défaut — choix de design pour la lisibilité).
3. **Périodes de validité strictes**. Une promo a une date / heure de début et de fin. Le moteur refuse de l'appliquer hors fenêtre.
4. **Pas de modification rétroactive**. Modifier une promo aujourd'hui ne change pas le calcul des ventes passées.
5. **Traçabilité au ticket**. Chaque remise appliquée apparaît sur le reçu client avec son libellé — pas de "ristourne cachée" sans nom.

---

## 4. Les 4 types de promotions

Le module supporte 4 mécaniques de remise via l'enum `promotion_type` :

### 4.1 `percentage` — Remise en pourcentage

La plus courante. Exemples :

- "−15 % sur toute la catégorie Viennoiseries le mercredi."
- "−10 % pour les clients Gold sur tout le panier."
- "−25 % sur les pains du jour après 18h."

Le moteur applique le pourcentage sur le sous-total des items éligibles.

### 4.2 `fixed_amount` — Remise en montant fixe

Une déduction en IDR. Exemples :

- "5 000 IDR de remise dès 50 000 IDR d'achat."
- "10 000 IDR offerts pour l'anniversaire client."

### 4.3 `buy_x_get_y` — Achetez X, obtenez Y (BOGO)

Mécanique d'incitation à l'achat multiple. Exemples :

- "Acheter 2 baguettes, la 3ᵉ offerte" (buy 2, get 1 free).
- "Acheter 4 cookies, payer 3" (buy 3, get 1 free, le 4ᵉ étant facturé).
- "1 boisson achetée = 1 viennoiserie à −50 %."

### 4.4 `free_product` — Produit gratuit

Cadeau automatique. Exemples :

- "Un cookie offert pour tout panier > 100 000 IDR."
- "Café gratuit pour les Platinum à chaque visite."

---

## 5. Les conditions d'application

Chaque promo est définie par une **combinaison de conditions**. Le moteur (`promotionMatchers`) évalue chaque panier contre :

| Condition | Exemple |
|---|---|
| **Période date/heure** | "Du 12 au 18 mai, entre 14h et 18h" |
| **Jours de la semaine** | "Lundi, mardi, jeudi" |
| **Produit(s) spécifique(s)** | "Sur le produit Croissant Tradition uniquement" |
| **Catégorie(s)** | "Sur toute la catégorie Viennoiseries" |
| **Montant minimum panier** | "Dès 75 000 IDR d'achat" |
| **Quantité minimum d'items** | "À partir de 3 viennoiseries" |
| **Type de client** | "Clients B2B uniquement", "Tier Gold+", "Anniversaire du client" |
| **Type de commande** | "Dine-in uniquement", "Takeaway exclu" |
| **Méthode de paiement** | "Si payé par QRIS" |
| **Code promo saisi** | "Si le client tape le code WEEKEND" |
| **Limite d'usage** | "Maximum 100 utilisations / max 1 par client / par jour" |

Les conditions sont **toutes en ET logique** — toutes doivent être remplies pour que la promo s'applique.

Bénéfice métier : **combiner finement les leviers commerciaux** sans devoir coder. "Happy hour viennoiseries Gold le mercredi entre 14h et 17h dans la limite de 50 utilisations" = saisie en 6 cases.

---

## 6. Le moteur d'évaluation — Le cœur du module

`promotionEngine` est le service qui orchestre l'application :

### 6.1 Le flux à chaque évaluation

À chaque changement de panier, le hook `useCartPromotions` :

1. Récupère la liste des promos actives (`usePromotions`).
2. Pour chaque promo : appelle `promotionMatchers` qui teste les conditions sur le panier courant.
3. Pour les promos qui matchent : appelle `promotionCalculators` qui calcule le montant de la remise.
4. Si plusieurs promos s'appliquent au même item : sélection de la plus avantageuse pour le client.
5. Le résultat est injecté dans le calcul des totaux (`calculateTotals`).
6. Le cart affiche les remises ligne par ligne et au sous-total.

### 6.2 Performance et fiabilité

- Évaluation **< 100 ms** sur un panier typique de 10 lignes (objectif UX).
- Pure function — déterministe — testable (couverture dans `promotionEngine.test.ts`).
- Aucun aller-retour serveur — tout est calculé côté client à partir des règles déjà chargées.

Bénéfice métier : **le caissier voit la promo se déclencher en direct** dès qu'il ajoute le bon item. Le client voit le total descendre. Effet "magique" recherché.

---

## 7. La création / édition d'une promo

Page **Promotions list** (`/products/promotions`) :

- Liste de toutes les promos (actives, planifiées, expirées).
- Cards (`PromotionCard`) avec : nom, type, période, conditions résumées, statut, compteur d'utilisations.
- Stats agrégées (`PromotionsStats`) en haut : nombre de promos actives, total remises appliquées sur la période, top promo en volume.
- Bouton "Nouvelle promotion" → formulaire de création.

### 7.1 Le formulaire

Le formulaire suit les conventions de `promotionFormConstants` :

- **Identité** : nom, description (vu sur le ticket), code interne, code promo client optionnel.
- **Type** : percentage / fixed_amount / buy_x_get_y / free_product.
- **Valeur** : selon le type (% ou montant ou ratio X:Y).
- **Période** : date début, date fin, jours de la semaine, plages horaires.
- **Cibles** : produits / catégories / "tout le panier".
- **Conditions** : minimum, type de client, type de commande, méthode de paiement.
- **Limites** : max utilisations totales, max par client, max par jour.
- **Statut** : active / désactivée / brouillon.

### 7.2 Validation

Le formulaire bloque les configurations incohérentes :

- Date fin < date début.
- Pourcentage > 100 %.
- Buy_x_get_y avec X = 0 ou Y = 0.
- Produit gratuit sans produit cible.

Bénéfice métier : **créer une promo en 2 minutes**, sans devoir appeler le dev, sans risque de configuration cassée.

---

## 8. Les Combos — Produits composés à prix groupé

Un **combo** est un produit virtuel composé d'**autres produits**, vendu à un prix global réduit par rapport à la somme des composants.

Exemple type : "Petit-déjeuner Breakery" = 1 viennoiserie + 1 boisson chaude + 1 jus, vendu 45 000 IDR au lieu de 58 000 IDR à la carte.

### 8.1 Structure d'un combo

Un combo a :

- **Une identité** : nom, description, image, prix global, période de disponibilité.
- **Des `combo_groups`** : groupes de composants où le client choisit.

Chaque groupe a :

- Un libellé ("Viennoiserie", "Boisson chaude", "Jus").
- Une **règle de sélection** : "1 parmi" / "exactement N parmi" / "jusqu'à N parmi".
- Une liste de **produits éligibles**.
- Un **surcoût optionnel** par produit (le croissant aux amandes coûte +3 000 IDR par rapport au croissant nature dans le même groupe).

### 8.2 Création — Page `/products/combos`

- Liste des combos existants avec `ComboCard`, header (`CombosHeader`), stats (`CombosStats`).
- Formulaire 3 onglets :
  - **General** (`ComboFormGeneral`) : identité du combo, prix, période.
  - **Groups** (`ComboFormGroupEditor`) : édition des groupes de composants et règles.
  - **Price preview** (`ComboFormPricePreview`) : aperçu du calcul de marge selon les choix possibles du client.

Bénéfice métier : **packager une formule** sans devoir créer un nouveau produit en stock — le combo n'est qu'un assemblage virtuel des produits existants.

---

## 9. Sélection d'un combo au POS

Au POS, l'ajout d'un combo déclenche le **`ComboSelectorModal`** :

- Affichage de chaque groupe avec ses composants éligibles.
- Indication des règles ("Choisissez 1 viennoiserie", "Choisissez 2 boissons").
- Surcoût visible si applicable.
- Validation bloquée tant que toutes les règles ne sont pas satisfaites.
- Une fois confirmé : ajout au panier en une seule ligne avec décomposition technique des composants en dessous.

Bénéfice métier : **le combo se vend comme un produit unique** côté client tout en restant traçable côté stock (chaque composant est déduit individuellement).

---

## 10. Le ticket et l'affichage des promos

Quand une promo est appliquée :

- **Au cart** : la ligne d'item montre son prix unitaire barré + le prix après promo + le nom de la promo.
- **Au sous-total** : ligne explicite "Remise [nom de la promo] −X 000 IDR".
- **Sur le ticket imprimé** : les promos sont listées avec leur libellé et leur montant.
- **Sur le customer display** : le client voit la remise apparaître en direct quand elle se déclenche.
- **Dans l'historique de commande** : la trace est conservée pour audit (quelle promo, quel montant, qui l'a déclenchée).

Bénéfice métier : **la transparence comme outil de confiance**. Le client voit qu'on lui a fait un cadeau ; ça crée la mémoire positive (vs une remise muette qui ne marque pas).

---

## 11. Les limites d'usage — Le contrôle quantitatif

Chaque promo peut être plafonnée :

| Limite | Effet |
|---|---|
| **Max total** | "Cette promo ne peut être utilisée que 100 fois au total." Au 101ᵉ, elle ne s'applique plus. |
| **Max par client** | "Cette promo n'est utilisable qu'une fois par client." (nécessite client lié). |
| **Max par jour** | "Maximum 30 utilisations / jour." |
| **Max par transaction** | "Une seule application par ticket." |

Le moteur tient un **compteur d'utilisations** mis à jour à chaque commande complétée — incrémenté à la validation, décrémenté en cas de void.

Bénéfice métier : **budgétiser une opération promo**. Un lancement de produit avec 200 cadeaux offerts s'arrête tout seul au 201ᵉ — pas de débordement budgétaire.

---

## 12. Les codes promo — La promo activable manuellement

Une promo peut être configurée avec un **code client** (`promo_code`) :

- Le client tape le code à la caisse ou au scan QR.
- Le moteur ne déclenche la promo **que si** le code correspond.
- Permet de cibler des canaux marketing (campagne réseau social, mailing, partenariat) sans rendre la promo automatique.

Cas d'usage : "WEEKEND20" partagé sur Instagram pendant 3 jours → seuls les clients qui ont vu le post et tapent le code en profitent.

Bénéfice métier : **mesurer le ROI d'un canal** d'acquisition. Le compteur d'utilisations du code = preuve d'effet.

---

## 13. Mécaniques transverses — Comment le module dialogue avec le reste

| Module | Relation |
|---|---|
| **POS / Cart** | `useCartPromotions` évalue automatiquement à chaque mutation cart. |
| **Products** | Les combos consomment les produits du catalogue ; les promos ciblent produits ou catégories. |
| **Customers** | Tier loyalty, type retail/B2B, anniversaire client → conditions d'éligibilité. |
| **Reports** | `promotion_effectiveness` (backlog) — mesure de l'impact marge des promos. |
| **Accounting** | La remise est comptabilisée en moins du chiffre d'affaires (compte 4900 ou équivalent). |
| **Settings** | Réglage de la politique "stacking" (cumul autorisé ou pas), seuils par défaut. |
| **Inventory** | Les composants d'un combo sont décrémentés individuellement à la vente. |

---

## 14. Ce que le module ne fait **pas** (par design)

- Le module **ne supporte pas le stacking** (cumul) de plusieurs promos par défaut. Une seule promo par item — la meilleure pour le client. Cumuler exige une configuration explicite par cas (rare).
- Le module **ne gère pas les promotions négociées B2B**. Pour les prix B2B sur mesure, c'est le système de **listes de prix B2B** (module B2B) qui prend le relais.
- Le module **ne fait pas d'A/B testing** automatique. Pas de "50 % des clients voient la promo A, 50 % la promo B".
- Le module **ne supporte pas les coupons à usage unique** sérialisés (un QR code unique par client). Les codes promo sont des chaînes partagées.
- Le module **ne génère pas de visuels marketing**. Pas d'export d'affiche, de bandeau ; c'est à l'extérieur de l'app.
- Le module **ne gère pas les programmes de parrainage** (referral). Différent de la fidélité.

---

## 15. Ce que le module doit (encore) faire — backlog métier

| Priorité | Évolution | Bénéfice attendu |
|---|---|---|
| 🔴 | **Stacking configurable** | Permettre la combinaison explicite de promos (ex: "promo fidélité Gold + happy hour") quand le commerçant le souhaite. |
| 🔴 | **Promotion effectiveness report** | Mesurer pour chaque promo : volume incrémental, marge sacrifiée, ROI. (cf. backlog Reports). |
| 🟠 | **Coupons sérialisés** | QR code unique par client envoyé par e-mail, à scanner au comptoir. |
| 🟠 | **Promotions par segment client** | Définir une promo automatiquement réservée aux clients identifiés "dormants depuis 60 jours". |
| 🟠 | **A/B testing intégré** | Tester deux variantes de promo simultanément avec mesure de performance. |
| 🟡 | **Combos dynamiques** | Combos avec règles conditionnelles ("si vous prenez 3 viennoiseries, la 4ᵉ à −50 %"). |
| 🟡 | **Programme de parrainage** | "Apportez un ami, vous avez tous les deux 10 % la prochaine visite." |
| 🟢 | **Smart suggest au POS** | Le système suggère au caissier "ajoutez 1 baguette pour activer la promo BOGO" pour aider à closer. |
| 🟢 | **Calendrier visuel des promos** | Vue mensuelle des promos planifiées pour anticiper les conflits. |

---

## 16. En une phrase

Le module Promotions & Combos est **le bras commercial automatique** de The Breakery : il transforme une règle écrite ("−15 % le mercredi sur les viennoiseries", "menu petit-déj à 35k") en calcul qui s'applique tout seul à chaque panier en moins de 100 ms, évalue les conditions sans erreur ni oubli caissier, plafonne l'usage pour budgétiser une campagne, trace chaque remise sur le ticket pour la transparence client, et libère le commerçant de la mémorisation — pour qu'une bonne idée commerciale formulée le lundi devienne un mécanisme appliqué sans faute dès le mardi matin.
