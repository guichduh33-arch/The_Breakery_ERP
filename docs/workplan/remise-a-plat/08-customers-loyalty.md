# Module 08 — Clients & fidélité

> ⚠️ **Mise à jour S62 (2026-07-06, `swarm/session-62`)** : **D2.3 soldé par PURGE** (décision propriétaire 3 du 2026-07-06) — le champ `discount` des `TIERS` est retiré du domaine : les paliers ne servent plus qu'au multiplicateur de POINTS (`points_multiplier`, intact serveur et client). Besoin futur de remise → promotion par catégorie client (mécanisme existant). Voir `docs/workplan/plans/2026-07-06-session-62-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 8. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel.
> **Verdict global de l'analyse :** Le socle (fiche client, earn/redeem, ledger infalsifiable, import, segments, anniversaires) est réel et solide. Mais la doc surclame trois points visibles du client : **pas de numéro de membre ni de QR code** (onglet « coming soon »), **les remises de palier (5/8/10 %) ne sont jamais appliquées**, et la **gestion des catégories tarifaires est en lecture seule** (aucun RPC d'écriture).

## A. Ce qui fonctionne réellement (code vérifié)

- **Création rapide en caisse** [UI câblée + RPC] : onglet « NEW » du `CustomerAttachModal` (`apps/pos/src/features/cart/CustomerAttachModal.tsx:475-482`, `QuickCreateForm`), RPC `create_customer_v2` (`20260621000017`, défaut catégorie fixé par `20260621000019`). Recherche nom/téléphone via `search_customers_v3` gatée (`20260710000054`), favoris épinglables.
- **Rattachement client → prix automatique** [UI câblée + RPC] : à l'ajout d'article le POS résout `get_customer_product_price` (`apps/pos/src/features/products/ProductTapHandler.tsx:57-64`) ; et l'autorité finale est le serveur : `_resolve_line_price_v1` re-résout le prix par catégorie du client dans la money-path (`supabase/migrations/20260710000063:45`).
- **Catégories tarifaires (lecture)** [UI câblée, **read-only**] : table `customer_categories` (retail/wholesale/discount_percentage/custom + `points_multiplier`, `20260509000001`), overrides `product_category_prices` (`20260509000003`). Page BO `CustomerCategoriesPage` routée + sidebar (`routes/index.tsx:491-498`, `Sidebar.tsx:74`) mais **explicitement READ-ONLY** : « no create/update RPC exists… deviation D-W6-CUSTCAT-01 » (`apps/backoffice/src/pages/customers/CustomerCategoriesPage.tsx:9-13`) — bouton « New Category » disabled (l.95-102), Edit/Delete sans handler (l.145-151). `PricingTab` du détail client : lecture seule aussi (`useCustomerCategoryPrices.ts:8`).
- **Fidélité — earn** [RPC] : `complete_order_with_payment_v17` crédite `FLOOR(total × multiplicateur / 1000)` points (`20260710000092:871-882`) où multiplicateur = `get_loyalty_multiplier(lifetime_points) × customer_categories.points_multiplier` (`20260628000010`). JE fidélité via `LOYALTY_LIABILITY` (`_092:839-845`).
- **Fidélité — paliers** [domaine + SQL, **affichage seulement**] : 4 paliers Bronze/Silver/Gold/Platinum à 0/500/2000/5000 points cumulés, miroir TS/SQL (`packages/domain/src/loyalty/tiers.ts:3-8` ↔ `get_loyalty_tier`, `20260514000001`). La « promotion » de palier est intrinsèque (palier dérivé de `lifetime_points`, jamais stocké). Le palier est affiché (badge POS `OrderSummaryPanel.tsx:60-67`, listes BO) et booste le multiplicateur de points (1.0/1.05/1.1/1.2). **Les `discount: 5/8/10` de `tiers.ts` ne sont consommés nulle part** — ni au POS ni dans v17.
- **Fidélité — redeem** [UI câblée + RPC] : `RedeemPointsModal` ouvert depuis le menu du panier (`apps/pos/src/features/cart/BottomActionBar.tsx:290-300,429-440`) → `setRedeemPoints` → `p_loyalty_points_redeemed` dans le checkout (`useCheckout.ts:152`). Serveur : multiples de 100 pts, 1 pt = 10 IDR, solde vérifié (`_092:200-215`), débit + ligne `loyalty_transactions` type `redeem` (`_092:854-866`).
- **Historique de points infalsifiable** [DB] : `loyalty_transactions` append-only au niveau rôle — `REVOKE INSERT/UPDATE/DELETE FROM authenticated, anon, PUBLIC` (`20260621000014`) ; écritures uniquement via RPCs SECURITY DEFINER. Ajustement manuel gouverné : `adjust_loyalty_points` (`20260514000002`, durci `20260515000004`) + `LoyaltyAdjustModal`/`LoyaltyHistoryDrawer` en BO.
- **Fiche client complète** [UI câblée] : `CustomerDetailPage` (route `customers/:id`, gate `customers.read`) avec 5 onglets Info/Orders/Loyalty/Analytics/Pricing (`apps/backoffice/src/pages/customers/customer-detail/`), analytics dépenses/visites/top-produits calculées depuis `orders` (`useCustomerAnalytics.ts:77+`). Deux surfaces BO : `CustomersListPage` (+ export `useCustomersExport`) et page `Loyalty` (stats, tiers, ajustements).
- **Import en masse + doublons** [UI câblée + RPC] : `import_customers_v1` (`20260706000026`) — doublons in-file et vs DB par téléphone puis email, erreurs typées `duplicate_in_file`/`duplicate_exists` (l.75-88), catégorie par nom/slug, gate `customers.create` ; monté via `ImportEntityModal` sur `CustomersListPage.tsx:339`.
- **Segments & anniversaires** [UI câblée + RPC] : `get_customer_segments_v1` (champions/loyal/at_risk/new/dormant/lost, `20260517000221:139`) + `SegmentsPage` ; `BirthdayPage` (clients à J-30 + log de notifications) + cron anniversaire e-mail (`20260517000222`, `20260525000011`) ; routes `marketing/*` gatées `reports.read` (`routes/index.tsx:579-610`) et présentes dans la sidebar (`Sidebar.tsx:190-193`).
- **QR / membre** : l'onglet « QR » du `CustomerAttachModal` est un **placeholder « QR scan coming soon »** (`CustomerAttachModal.tsx:462-473`). Aucune colonne `member_number`/`qr_code` dans le schéma (grep négatif sur `types.generated.ts`), aucune génération de QR côté BO.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Fiche client en 15 s à la caisse (nom + téléphone) ; **numéro de membre + QR code scanné** pour reconnaissance instantanée.
- B1.2 Catégories tarifaires (normal, grossiste, remise %, prix négociés produit par produit) appliquées automatiquement au rattachement.
- B1.3 Fidélité : 1 point / 1 000 IDR, 4 paliers Bronze→Platine avec **remises croissantes** et promotion automatique de palier.
- B1.4 Échange points → remise en caisse, historique de points infalsifiable.
- B1.5 Fiche complète : dépenses, visites, commandes, points, tendance.
- B1.6 Import client en masse avec détection des doublons.
- B1.7 Segments automatiques (champions, fidèles, à risque, dormants, perdus) + anniversaires du mois.

### B2. Annoncé « À venir »
- B2.1 Expiration automatique des points.
- B2.2 Envoi WhatsApp/SMS (seul l'e-mail fonctionne).
- B2.3 Fusion assistée des fiches en doublon.
- B2.4 Félicitation visible en caisse au changement de palier.
- B2.5 Programme de parrainage automatisé.
- B2.6 Conformité UU PDP (consentement, droit à l'effacement).

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | Création 15 s + numéro de membre + QR scanné | Création rapide ✓ (`QuickCreateForm` + `create_customer_v2`) ; **numéro de membre : inexistant** (aucune colonne) ; **QR : onglet « coming soon »** (`CustomerAttachModal.tsx:462-473`) | 🟠 PARTIEL |
| B1.2 | Catégories tarifaires appliquées automatiquement | Application automatique ✓ (POS + serveur `_resolve_line_price_v1`) ; **mais CRUD catégories désactivé** (page read-only, D-W6-CUSTCAT-01) et **aucune UI d'écriture des prix négociés** — configuration possible uniquement en SQL direct | 🟠 PARTIEL |
| B1.3 | 1 pt/1000, 4 paliers, remises croissantes, promotion auto | Earn 1 pt/1000 × multiplicateurs ✓ ; paliers auto-dérivés ✓ ; **remises de palier (5/8/10 %) jamais appliquées à l'encaissement** — constantes `tiers.ts` non consommées, rien dans v17 | 🟠 PARTIEL |
| B1.4 | Redeem en caisse + historique infalsifiable | `RedeemPointsModal` → v17 (100 pts min, 1 pt = 10 IDR) ; `loyalty_transactions` append-only (REVOKE S37) | ✅ CONFORME |
| B1.5 | Fiche complète (dépenses, visites, commandes, points, tendance) | `CustomerDetailPage` 5 onglets + analytics/top produits ; compteurs `total_spent`/`total_visits`/`last_visit_at` tenus par la money-path | ✅ CONFORME |
| B1.6 | Import en masse + doublons | `import_customers_v1` (phone/email, in-file + DB) + `ImportEntityModal` | ✅ CONFORME |
| B1.7 | Segments + anniversaires | `get_customer_segments_v1` (6 buckets) + `BirthdayPage` + cron e-mail | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Cohortes de rétention (`CohortHeatmap`, `get_customer_cohort_v1`, page `marketing/cohort`).
- 🔵 Export Excel des clients (`useCustomersExport`).
- 🔵 Favoris caissier (épinglage one-tap dans `CustomerAttachModal`).
- 🔵 `marketing_consent` + `birth_date` déjà en schéma (base pour UU PDP/B2.6).
- 🔵 Ajustement manuel de points gouverné avec historique dédié (drawer BO).
- 🔵 Multiplicateur de points par catégorie client (`points_multiplier`) cumulé au palier.

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Trancher les remises de palier** : soit (a) les appliquer (proposition : remise % automatique dans le POS via `cartDiscount` dédié + validation serveur), soit (b) supprimer `discount` de `tiers.ts` et amender la doc. L'option (a) touche la money-path → si retenue, la basculer en D2. Done = comportement et doc alignés.
2. **Nettoyage** : le composant orphelin `RedeemButton.tsx` (jamais importé — le redeem passe par `BottomActionBar`) — supprimer ou brancher.

### D2. Chantiers moyens (1 session, plan requis)
1. **CRUD catégories tarifaires + prix négociés** (ferme D-W6-CUSTCAT-01, ouvert depuis S14) : RPCs `create/update/delete_customer_category_v1` + `upsert_product_category_price_v1` (perms `customer_categories.create/update/delete` existent déjà — vérifier le seed), activer les boutons de `CustomerCategoriesPage` et rendre `PricingTab` éditable. Done = le scénario doc « le responsable B2B enregistre le tarif produit par produit » passe en vrai.
2. **QR membre** : générer un QR (payload = customer id signé ou member number), l'afficher/exporter depuis la fiche BO, câbler l'onglet « QR » du POS sur un scan caméra/douchette → attach. Nécessite décision hardware (douchette vs caméra tablette). Done = scan → client rattaché.
3. **Remise de palier appliquée serveur** (si D1.1 option a) : v17/`pay_existing_v11` + affichage POS + JE discount — pattern identique à la remise catégorie.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Expiration des points** (B2.1) : politique (durée, FIFO d'expiration), cron, lignes `loyalty_transactions` type `adjust` négatives, communication client — spec requise (impact compta `LOYALTY_LIABILITY`).
2. **WhatsApp/SMS** (B2.2) : choix fournisseur (WA Business API), gabarits, opt-in UU PDP — spec commune avec module 19 (templates).
3. **Fusion de doublons** (B2.3) : réaffectation orders/loyalty_transactions/allocations B2B → transaction dédiée + audit ; spec requise.
4. **UU PDP** (B2.6) : consentement, effacement (le soft-delete existe mais pas de purge PII), registre — spec transverse avec module 25.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- B1.1 : retirer « numéro de membre et QR code » du présent (le déplacer en « À venir », où la doc mentionne déjà la reconnaissance) — aujourd'hui la reconnaissance = recherche nom/téléphone + favoris.
- B1.2 : préciser « catégories tarifaires **préconfigurées** (la création/édition depuis l'écran arrive) ».
- B1.3 : remplacer « remises croissantes » par « multiplicateur de points croissant » tant que D1.1/D2.3 n'est pas tranché.

## E. Dépendances croisées
- **Module 5 (Catalogue)** : les prix négociés (`product_category_prices`) sont partagés — D2.1 ici débloque D2.1 du module 5.
- **Module 2/3 (Caisse & encaissement)** : earn/redeem/prix client vivent dans `complete_order_with_payment_v17` — toute évolution (remise de palier) = bump money-path + pgTAP.
- **Module 9 (B2B)** : la fiche client porte plafond de crédit/conditions (B2BFieldsSection) ; la fusion de doublons (D3.3) impacte les allocations B2B.
- **Module 10 (Comptabilité)** : `LOYALTY_LIABILITY`/discount JE ; l'expiration de points (D3.1) devra contre-passer la dette fidélité.
- **Module 19 (Réglages)** : templates e-mail anniversaire ; canal WhatsApp/SMS (D3.2).
- **Module 25 (Sécurité)** : UU PDP, PII, droit à l'effacement.
