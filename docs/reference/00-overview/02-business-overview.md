<!-- STALE-V2 -->
> ⚠️ **DOC HISTORIQUE — PÉRIMÉE (V2), NE FAIT PLUS FOI.** Ce fichier décrit en grande partie l'architecture **V2** (mono-app AppGrav, npm/Vercel, PWA/Capacitor, projet Supabase `abjabuniwkqpfsenxljp` = **prod incompatible**, versions RPC obsolètes). **Ne jamais l'appliquer tel quel** (migration, config, archi). Sources de vérité actuelles : `CLAUDE.md` (patterns + workplan) et `docs/workplan/remise-a-plat/` (référence modules réel-vs-demandé). Hiérarchie complète : `docs/README.md`. Régénération depuis le code prévue en Phase 3.

# AppGrav — Vue d'ensemble métier (POS + Backoffice)

> **Last verified**: 2026-05-13
> **Place dans la doc** : carte d'orientation **fonctionnelle** des 18 modules métier. Pose le principe directeur de **deux applications distinctes** — POS et Backoffice — et renvoie pour chaque module vers sa fiche complète dans [`../04-modules/`](../04-modules/) (fusion fonctionnel + technique).
> **Voir aussi** : [`01-product-context.md`](01-product-context.md) (contexte produit), [`../04-modules/00-modules-index.md`](../04-modules/00-modules-index.md) (carte des dépendances code).

---

## 1. Le contexte — The Breakery

The Breakery est une **boulangerie française artisanale** installée à Lombok (Indonésie). Volume opérationnel :

- **~200 transactions / jour** au comptoir.
- **~20 utilisateurs** actifs sur l'application (cashiers, baristas, cuisiniers, serveurs, manager, gérant, comptable).
- **Mix de canaux** : vente comptoir (retail), service en salle (dine-in), emporter (takeaway), livraison (delivery), wholesale (B2B avec hôtels / cafés / restaurants).
- **Devise** : IDR, taxe **PB1 10% inclusive**.
- **Conformité comptable** : norme indonésienne **SAK EMKM**.

AppGrav V2 est l'**ERP/POS unifié** qui pilote la totalité de cette activité — caisse, stock, recettes, achats, ventes, encaissement, comptabilité, fidélité, B2B, reporting.

---

## 2. Le principe directeur — 2 applications, 2 missions

Bien que techniquement déployé comme une seule SPA React, AppGrav doit être pensé conceptuellement comme **deux applications distinctes** qui partagent la même base Supabase :

| Application | Mission | Tempo | Surface UI |
|---|---|---|---|
| **POS App** | Opérations temps réel sur le terrain | Seconde par seconde | Plein écran tactile, sans menu back-office |
| **Backoffice App** | Administration, configuration, pilotage | Heure / jour / mois | Layout structuré avec navigation latérale, multi-pages |

Cette distinction n'est pas qu'esthétique : elle **détermine tout** — les permissions, le tempo cognitif, les contraintes de friction acceptable, les profils utilisateurs cibles.

### Le contrat implicite

- **POS** = "j'agis maintenant sur un client présent". Latence < 1s exigée. Erreur visible immédiatement. Pas de "Save & Continue Later".
- **Backoffice** = "je configure, je consulte, je décide". Latence acceptable jusqu'à 3-5s. Erreur récupérable. Drafts, validations à plusieurs étapes.

---

## 3. L'application POS — Le poste de combat

### 3.1 Mission

Encaisser, servir, préparer, signaler — sans aucune friction qui coûterait des secondes au comptoir.

### 3.2 Les 5 fiches qui composent le POS

| Fiche | Rôle dans le POS |
|---|---|
| **[POS](../04-modules/02-pos-cart-orders.md)** | L'écran principal de caisse : `/pos` fullscreen, tactile, prise de commande, encaissement |
| **[CASH_REGISTER](../04-modules/12-cash-register-shift.md)** | Le cycle session : ouverture fond de caisse → service → fermeture réconciliée |
| **[KDS](../04-modules/04-kds-kitchen.md)** | L'écran cuisine : `/kds` réception des commandes par station, statuts item-level |
| **[TABLET_ORDERING](../04-modules/17-tablet-ordering.md)** | La tablette serveur : `/tablet` prise de commande à table, envoi au comptoir |
| **[CUSTOMER_DISPLAY](../04-modules/16-display-customer.md)** | L'écran face client : `/display` cart live, promos en idle, notifications |

### 3.3 Les 6 invariants du monde POS

1. **Touch-first.** Tout est dimensionné pour le doigt. Le clavier physique est optionnel.
2. **Pas de menu back-office accessible.** L'utilisateur ne peut pas se "perdre" dans des sous-menus de configuration.
3. **Tempo < 1s.** Toute action doit retourner un feedback visible / audible en moins d'une seconde.
4. **Atomicity.** Une transaction passe ou échoue, jamais à moitié — `complete_order_with_payments` RPC.
5. **Realtime native.** Les écrans POS dialoguent entre eux via LAN BroadcastChannel + Supabase Realtime en fallback.
6. **Session caisse obligatoire.** Aucune vente possible sans `pos_sessions` ouverte au préalable.

### 3.4 Profils utilisateurs POS

| Rôle | Écran principal |
|---|---|
| **Cashier** | `/pos` |
| **Barista** | `/pos` (ses cafés) + `/kds` station barista |
| **Cuisinier** | `/kds` station hot_kitchen |
| **Serveur** | `/tablet` + `/kds` station waiter |
| **Client** | `/display` (passif, regarde) |

---

## 4. L'application Backoffice — La salle de commandement

### 4.1 Mission

Configurer le catalogue, gérer les clients, suivre les stocks, valider les achats, consulter les analyses, tenir la compta, piloter le business.

### 4.2 Les 13 fiches qui composent le Backoffice

| Fiche | Rôle dans le Backoffice |
|---|---|
| **[PRODUCTS](../04-modules/05-products-categories.md)** | Catalogue : produits, catégories, variantes, modifiers, recettes, pricing |
| **[CUSTOMERS](../04-modules/08-customers-loyalty.md)** | Base clients retail + B2B, fidélité, segments |
| **[INVENTORY](../04-modules/06-inventory-stock.md)** | 7 onglets stock : Stock, Incoming, Transfers, Wastage, Production, Opname, Movements |
| **[PURCHASING_AND_SUPPLIERS](../04-modules/07-purchasing-suppliers.md)** | Fournisseurs, PO, réceptions, paiements |
| **[B2B](../04-modules/09-b2b-wholesale.md)** | Wholesale : commandes, livraisons, paiements FIFO, listes de prix |
| **[ORDERS](../04-modules/02b-orders.md)** | Dashboard temps réel des commandes (suivi opérationnel + historique) |
| **[PRODUCTION](../04-modules/15-production-recipes.md)** | Recettes + saisie des lots de production, déduction ingrédients |
| **[EXPENSES](../04-modules/11-expenses.md)** | Dépenses opérationnelles, workflow Draft → Approved → Paid |
| **[ACCOUNTING](../04-modules/10-accounting-double-entry.md)** | Plan comptable, journal, GL, balance, bilan, P&L, PB1, AR aging, réconciliation banque |
| **[PROMOTIONS_AND_COMBOS](../04-modules/13-promotions-discounts.md)** | Configuration des règles commerciales (auto-appliquées côté POS) |
| **[REPORTS](../04-modules/14-reports-analytics.md)** | ~61 reports répartis en 7 catégories (Overview, Sales, Inventory, Purchases, Finance, Operations, Logs) |
| **[USERS_AND_PERMISSIONS](../04-modules/01-auth-permissions.md)** | RBAC : utilisateurs, rôles, ~70 permissions atomiques, audit log |
| **[SETTINGS](../04-modules/19-settings-configuration.md)** | Configuration transverse : entreprise, taxe, paiement, fidélité, KDS, sécurité, LAN |

### 4.3 Les 6 invariants du monde Backoffice

1. **Layout structuré.** Navigation latérale, breadcrumbs, sous-pages, drill-down.
2. **Filtres + recherche partout.** Toute liste est filtrable par date, statut, propriété.
3. **Save explicite.** Aucune modification n'est appliquée tant que l'utilisateur n'a pas cliqué "Save".
4. **History systématique.** Chaque modification est tracée (qui, quoi, quand, ancienne → nouvelle valeur).
5. **Workflows à validation.** Les actions sensibles (approbation dépense, clôture session, validation B2B) passent par des étapes formelles.
6. **Export universel.** Toute liste est exportable en CSV / PDF pour usage hors app (comptable externe, partage, archivage).

### 4.4 Profils utilisateurs Backoffice

| Rôle | Pages typiques |
|---|---|
| **Owner / Gérant** | Tout — dashboard reports, accounting, settings, users |
| **Manager** | Inventory, customers, orders, expenses, sales reports |
| **Comptable** | Accounting, expenses, VAT, AR aging, bank reconciliation |
| **Stockman** | Inventory (7 onglets), purchasing, suppliers |
| **Chef de production** | Products (recettes), production records |
| **Acheteur** | Purchasing, suppliers, expenses |

---

## 5. Le substrat commun — Ce que les deux apps partagent

Les deux applications vivent sur le **même socle technique et conceptuel** :

### 5.1 Base de données unique

Une seule instance Supabase (`abjabuniwkqpfsenxljp.supabase.co`, région Singapore) héberge toutes les tables. Les deux apps lisent et écrivent dans la même base, protégées par les mêmes RLS policies.

### 5.2 RBAC unifié

Le même système de **permissions atomiques** (`sales.create`, `inventory.adjust`, `accounting.manage`, etc.) cloisonne l'accès dans les deux apps. Voir [USERS_AND_PERMISSIONS](../04-modules/01-auth-permissions.md).

### 5.3 Audit log centralisé

Toute action sensible (POS comme Backoffice) atterrit dans le même audit log consultable via Backoffice. Voir SETTINGS § Audit Log.

### 5.4 Realtime + LAN

Les écrans POS dialoguent en LAN local + Realtime cloud. Le Backoffice consomme aussi Realtime pour ses dashboards live (page Orders, alertes stock).

### 5.5 Configuration centralisée

Les réglages SETTINGS (taxe, paiements, KDS, fidélité, sessions) sont saisis en Backoffice et **propagés automatiquement** au POS via Realtime — pas de redémarrage requis.

### 5.6 Comptabilité par triggers

Les opérations métier des deux apps (vente POS, dépense Backoffice, livraison B2B, production, casse) génèrent **automatiquement** les écritures comptables via triggers Postgres. Voir [ACCOUNTING](../04-modules/10-accounting-double-entry.md) § Génération automatique.

---

## 6. Les ponts entre POS et Backoffice — Les modules qui touchent les deux mondes

Certains modules ont **une partie POS et une partie Backoffice**. Leur fiche couvre les deux mondes ; voici comment les distinguer.

### 6.1 Inventory — Stock

| POS-side | Backoffice-side |
|---|---|
| `/pos/live-stock` (vue temps réel) | `/inventory` 7 onglets |
| `/pos/cafe` (Cafe Stock Reception, sous-flux barista) | Stock by Location, Movements, Opname, Production records |

Les saisies POS-side sont **simplifiées et touch-first** ; les opérations complètes (opname, transfert formel, ajustement avec justificatif) restent en Backoffice.

### 6.2 Customers — Fichier clients

| POS-side | Backoffice-side |
|---|---|
| Recherche client (`CustomerSearchModal`) | Liste complète, segments |
| Quick create (`CreateCustomerForm`) | Fiche détaillée 360°, historique |
| Application auto du pricing tier + fidélité | Configuration des paliers, catégories, prix par catégorie |

### 6.3 Promotions & Combos

| POS-side | Backoffice-side |
|---|---|
| Application automatique (`useCartPromotions`) | Configuration des règles + combos |
| `ComboSelectorModal` pour assemblage | `/products/promotions`, `/products/combos` |

Le commerçant **configure** en Backoffice ; le système **applique** en POS sans intervention humaine.

### 6.4 Production

| POS-side | Backoffice-side |
|---|---|
| Indirect : la vente d'un produit fini décrémente le stock issu de production | `/inventory/production` saisie des lots, recettes, suggestions de production |

La production en elle-même est saisie en Backoffice (le boulanger ou le chef ouvre la page après son service). Les ventes POS en consomment les résultats.

### 6.5 Orders

| POS-side | Backoffice-side |
|---|---|
| Création des commandes via `/pos` | Dashboard `/orders` pour suivi et action (refund, void, mark paid) |

Le POS **crée**, le Backoffice **inspecte et corrige**.

### 6.6 Cash Register

| POS-side | Backoffice-side |
|---|---|
| Modales d'ouverture / fermeture session depuis `/pos` | Réglage des seuils dans Settings → POS Configuration, consultation historique via Reports |
| Comptage cash physique sur tablette caisse | Audit des écarts via report `cash_variance_trend` |

L'opération est POS ; la **politique** et le **suivi long-terme** sont Backoffice.

---

## 7. Cartographie complète des 18 fiches

| # | Fiche | App principale | Touche aussi |
|---|---|---|---|
| 1 | [POS](../04-modules/02-pos-cart-orders.md) | **POS** | — |
| 2 | [CASH_REGISTER](../04-modules/12-cash-register-shift.md) | **POS** | Reports, Accounting |
| 3 | [KDS](../04-modules/04-kds-kitchen.md) | **POS** | Settings (config), Reports (service speed backlog) |
| 4 | [TABLET_ORDERING](../04-modules/17-tablet-ordering.md) | **POS** | — |
| 5 | [CUSTOMER_DISPLAY](../04-modules/16-display-customer.md) | **POS** | Settings (config) |
| 6 | [ORDERS](../04-modules/02b-orders.md) | **Backoffice** | POS (source) |
| 7 | [PRODUCTS](../04-modules/05-products-categories.md) | **Backoffice** | POS (lecture catalogue) |
| 8 | [CUSTOMERS](../04-modules/08-customers-loyalty.md) | **Backoffice** | POS (recherche, quick create) |
| 9 | [INVENTORY](../04-modules/06-inventory-stock.md) | **Backoffice** | POS (live stock, cafe reception) |
| 10 | [PURCHASING_AND_SUPPLIERS](../04-modules/07-purchasing-suppliers.md) | **Backoffice** | Inventory, Accounting |
| 11 | [B2B](../04-modules/09-b2b-wholesale.md) | **Backoffice** | Customers, Inventory, Accounting |
| 12 | [PRODUCTION](../04-modules/15-production-recipes.md) | **Backoffice** | Inventory (déduction), POS (vente stock fini) |
| 13 | [EXPENSES](../04-modules/11-expenses.md) | **Backoffice** | Accounting |
| 14 | [ACCOUNTING](../04-modules/10-accounting-double-entry.md) | **Backoffice** | (récepteur de tous les flux) |
| 15 | [PROMOTIONS_AND_COMBOS](../04-modules/13-promotions-discounts.md) | **Backoffice** | POS (application auto) |
| 16 | [REPORTS](../04-modules/14-reports-analytics.md) | **Backoffice** | — |
| 17 | [USERS_AND_PERMISSIONS](../04-modules/01-auth-permissions.md) | **Backoffice** | POS (PIN flow, permission checks) |
| 18 | [SETTINGS](../04-modules/19-settings-configuration.md) | **Backoffice** | POS (propagation realtime config) |

**Résumé** : **5 fiches POS**, **13 fiches Backoffice**, dont **~7 fiches** font le pont entre les deux mondes.

---

## 8. Architecture utilisateurs × écrans

| Utilisateur | App POS | App Backoffice |
|---|---|---|
| **Owner / Gérant** | Supervise, ouvre session manager | Tout — dashboard, configuration, accounting, RBAC |
| **Manager de salle** | `/pos` (encaissement, validation), `/orders` (suivi) | Customers, expenses, sales reports, audit log |
| **Cashier** | `/pos` (toute la journée) | Pas d'accès (ou très limité — sa fiche profil) |
| **Barista** | `/pos`, `/kds` station barista | Pas d'accès |
| **Cuisinier** | `/kds` station hot_kitchen | Pas d'accès |
| **Serveur** | `/tablet`, `/kds` station waiter | Pas d'accès |
| **Comptable** | Pas d'accès | Accounting, expenses, VAT, AR aging, bank reconciliation, reports financiers |
| **Stockman** | `/pos/live-stock` (consultation) | Inventory (7 onglets), purchasing, suppliers |
| **Chef de production** | Pas d'accès (ou `/pos/cafe` pour réception) | Products → Recipes, Inventory → Production |
| **Acheteur** | Pas d'accès | Purchasing, suppliers, expenses |
| **Client** | `/display` (passif) | Pas d'accès |

Le cloisonnement est **principalement réalisé par permissions** (cf. [USERS_AND_PERMISSIONS](../04-modules/01-auth-permissions.md)), pas par séparation physique des apps. Un cashier connecté **peut techniquement** ouvrir `/inventory` — il sera juste bloqué par les RLS + PermissionGuard.

---

## 9. Les 4 grands flux métier transverses

Pour comprendre comment les modules s'articulent, voici les 4 cycles qui traversent les deux apps :

### 9.1 Le cycle de vente

```
Backoffice (catalogue + pricing + promos)
    ↓
POS (saisie + encaissement)
    ↓
KDS (préparation)
    ↓
Customer Display (notification)
    ↓
Backoffice (orders dashboard + reporting + comptabilité auto)
```

### 9.2 Le cycle d'approvisionnement

```
Backoffice → Inventory (alertes stock bas)
    ↓
Backoffice → Purchasing (PO création)
    ↓
Backoffice → Purchasing (réception)
    ↓
Backoffice → Inventory (stock crédité)
    ↓
Backoffice → Accounting (AP créée auto)
    ↓
Backoffice → Expenses ou Purchasing (paiement)
    ↓
Backoffice → Accounting (règlement AP)
```

### 9.3 Le cycle de production

```
Backoffice → Products → Recipes (définition)
    ↓
Backoffice → Inventory → Production (saisie lot)
    ↓
Triggers Postgres : déduction matières + crédit produit fini + JE
    ↓
POS (vente du produit fini)
    ↓
Triggers Postgres : déduction stock + JE COGS
```

### 9.4 Le cycle B2B

```
Backoffice → Customers (création client B2B)
    ↓
Backoffice → B2B (commande)
    ↓
Backoffice → B2B (livraisons partielles + stock déduit)
    ↓
Backoffice → B2B (paiement FIFO)
    ↓
Backoffice → Accounting (AR géré auto)
    ↓
Backoffice → Reports → AR Aging (suivi)
```

---

## 10. La conformité comme fil rouge

Toutes les fiches respectent **trois exigences transverses** :

| Exigence | Comment elle apparaît |
|---|---|
| **PB1 10% inclusive** | Tous les prix POS incluent la taxe ; tax = total × 10/110 ; comptes 2110 / 2143 séparés |
| **SAK EMKM** | Plan comptable, structure bilan / P&L, format CALK |
| **Traçabilité nominative** | Toute action sensible (POS comme Backoffice) porte un nom utilisateur via PIN ou login |

Ces invariants sont **non négociables** et conditionnent le design de chaque module.

---

## 11. Roadmap V2 → V3 — La séparation explicite des apps

AppGrav V2 est conceptuellement bi-application mais techniquement mono-SPA. La **reconstruction V3** (en cours dans `breakery-platform/`) sépare explicitement en **4 applications** :

| App V3 | Couvre les fiches |
|---|---|
| **`caissapp`** | POS, CASH_REGISTER, parties POS de INVENTORY (live stock, cafe reception), CUSTOMERS (recherche), PROMOTIONS (application) |
| **`backoffice`** | PRODUCTS, CUSTOMERS, INVENTORY, PURCHASING, B2B, ORDERS, PRODUCTION, EXPENSES, PROMOTIONS (config), REPORTS, USERS, SETTINGS |
| **`kitchen`** | KDS + extensions production planning |
| **`comptable`** | ACCOUNTING (full) + REPORTS financiers + extensions déclarations fiscales |

La présente cartographie POS / Backoffice **anticipe** ce découpage et permet de penser chaque fiche dans la bonne app dès aujourd'hui.

---

## 12. Comment utiliser ce dossier

Selon ton intention, voici par où entrer :

| Tu es… | Lis dans cet ordre |
|---|---|
| **Nouveau dev sur V2** | OVERVIEW → POS → ORDERS → INVENTORY → ACCOUNTING (couvre 80% du système) |
| **Nouveau dev sur V3** | OVERVIEW → fiches correspondant à ton app V3 cible |
| **Auditeur métier** | OVERVIEW → ACCOUNTING → REPORTS → SETTINGS (vue gouvernance) |
| **Onboarding cashier** | POS → CASH_REGISTER (le reste tu n'y as pas accès) |
| **Onboarding manager** | OVERVIEW → POS → ORDERS → CUSTOMERS → INVENTORY → REPORTS |
| **Onboarding comptable** | OVERVIEW → ACCOUNTING → EXPENSES → B2B → REPORTS |
| **Prestataire externe / banque** | OVERVIEW → ACCOUNTING (P&L, bilan) → REPORTS (KPI) |
| **Architecte solution** | OVERVIEW → SETTINGS → USERS_AND_PERMISSIONS → tous les modules transverses |

---

## 13. En une phrase

AppGrav est **deux applications dans un seul ERP** : le **POS** qui fait tourner la boutique seconde par seconde au comptoir, en cuisine, en salle et devant le client ; le **Backoffice** qui pilote, configure, mesure et comptabilise — les deux partageant la même base, les mêmes permissions et le même langage métier — pour que The Breakery vende, prépare, livre, encaisse, gère son stock, ses clients, ses fournisseurs, ses recettes, ses promos, ses dépenses et ses comptes sur une seule colonne vertébrale numérique, sans qu'aucun écran ne soit jamais en désaccord avec un autre.
