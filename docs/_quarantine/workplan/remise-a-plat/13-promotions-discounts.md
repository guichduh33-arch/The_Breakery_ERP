# Module 13 — Promotions & remises

> ⚠️ **Mise à jour S60 (2026-07-05, `swarm/session-60`)** : **D1.1 livré** — `ReceiptPayload.promotions[]` + `totals.promotion_total` alimentés depuis `appliedPromotions` snapshoté au succès (⚠️ le **template du print-bridge externe** doit être mis à jour pour rendre le champ — action utilisateur). **D1.2 livré** — `useOrderDetail` embed `promotion_applications(amount, description, promotions(name))`, lignes promo nommées dans `OrderDetailPage` ET `OrderDetailDrawer` (libellé = `description`, snapshot). B1.4 passe 🟠→✅ côté données (ticket papier dépend du bridge). Voir `docs/workplan/plans/archive/2026-07-05-session-60-INDEX.md`.

> **Remise à plat — analyse comparative.** Doc : Description v1.2 (2026-07-03), module 13. Code : commit `5b0fa92` (2026-07-03).
> **Statut annoncé par la doc :** Opérationnel.
> **Verdict global de l'analyse :** Fidèle sur le moteur (types de promo, plafonds hard-gatés serveur, combos server-priced, ROI) — c'est le module le plus à jour de la doc (S57 intégré). Deux surclames : la remise **n'est pas nommée sur le ticket imprimé** ni détaillée dans l'historique BO (agrégat seul), et le ciblage **par palier de fidélité est vestigial** (jamais appliqué).

## A. Ce qui fonctionne réellement (code vérifié)

- **4 types de promotion + conditions riches** [DB + UI câblée] : enum `promotion_type` = `percentage | fixed_amount | bogo | free_product`, scope `cart | product | category`, conditions `min_items_total` (seuil panier), `customer_category_ids`, `day_of_week_mask`, `start_hour/end_hour` (happy hour), dates, stacking `priority/stackable_*` (`supabase/migrations/20260511000001:6-85`). Plafonds `max_uses`/`max_uses_per_customer` ajoutés par `20260710000089` (`types.generated.ts:3728-3729`).
- **CRUD BO complet** [UI câblée] : page `Promotions` (route gate `promotions.read`, `routes/index.tsx:210-217` ; sidebar `Sidebar.tsx:78`), `PromotionFormModal` monté en create/edit (`apps/backoffice/src/pages/Promotions.tsx:283-284`), form partagé `packages/ui/src/components/promotion-form/` : GeneralTab (les 4 types, BOGO trigger/reward, produit cadeau), ConditionsTab (seuil, jours, heures 0-23, **caps** l.80-101), StackingTab. Écritures directes table sous RLS `has_permission('promotions.create/update/delete')` (`20260511000001:104-117`).
- **Évaluation automatique au panier** [UI câblée + RPC] : `usePromotionsAutoEval` monté une fois dans `ActiveOrderPanel` (`ActiveOrderPanel.tsx:71`), debounce 200 ms, re-run sur panier/client/dismissals ; appelle `evaluate_promotions_v2` (`useEvaluatePromotions.ts:10`) avec fallback TS BOGO ; gifts poussés/retirés avec toasts ; remises nommées affichées dans le panier (`PromotionsList` → `PromotionLineRow`).
- **Plafonds hard-gatés serveur (multi-caisses)** [RPC] : `evaluate_promotions_v2` filtre en advisory (comptage `promotion_applications` × orders **non-voided** — un void libère le compteur, `20260710000091:140-154`) ; gate dur atomique `pg_advisory_xact_lock(hashtext(promotion_id))` + re-count + `RAISE 'promo_cap_exceeded'` avant INSERT dans **`complete_order_with_payment_v17`** (`20260710000092:778-803`) **et** **`pay_existing_order_v11`** (`20260710000096:440-452`). L'EF `process-payment` remonte les 409. NULL = illimité ; per-customer ignoré sans client rattaché.
- **Combos vérifiés et facturés serveur** [RPC] : `_resolve_combo_price_v1` (`20260710000090`, REVOKE ×3) rejette `combo_invalid_component` (produit hors options du groupe, l.67) et `combo_group_violation` (cardinalité min/max, l.88), et facture `base + Σ surcharges` ; appelé par v17 (`_092:257,644`). La fuite « supplément non facturé » est bien fermée (S57 A-D1).
- **Traçabilité par commande** [DB] : `promotion_applications` (une ligne par promo appliquée par commande, `20260511000002`) + `orders.total_promotion_discount` ; insérées par v17/v11 sous le gate.
- **Rapport ROI par campagne** [UI câblée + RPC] : `get_promo_roi_v1(p_promotion_id, dates)` (`20260517000221:241`) → page `marketing/promo-roi` (route gate `reports.read`, `routes/index.tsx:595-602` ; sidebar `Sidebar.tsx:192`) : redemptions, discount total, revenue, ROI % — avec caveat honnête « incremental_revenue est un proxy » (`usePromoRoi.ts:6-7`).
- **Ciblage par palier de fidélité : vestigial** [DB seulement] : la colonne `customer_tier_ids` existe mais (1) le form BO ne propose **aucune option** (« loyalty_tiers is not a table… deferred », `usePromotionReferenceData.ts:24-26`), (2) l'évaluateur laisse `v_customer_tier` à NULL — « une promo restreinte par tiers ne s'applique jamais » (`20260710000095:6-8`).
- **Ticket imprimé** : `ReceiptPayload` ne porte **aucune ligne promotion** — items, totaux (`items_total, redemption_amount, total, tax_amount`), paiement, loyalty (`apps/pos/src/services/print/printService.ts:54-80`). Historique BO : `OrderDetailPage` n'affiche qu'un `discount_amount` agrégé (`useOrderDetail.ts:53,73` ; `OrderDetailPage.tsx:168`) — `promotion_applications` n'est lue par aucune UI.

## B. Ce que la doc demande

### B1. Revendiqué comme fonctionnant (« Ce qu'on peut faire aujourd'hui »)
- B1.1 Créer une promo % / montant fixe / « 2 achetés = 1 offert » / produit cadeau / seuil de panier / formule à prix imposé ; limitée par dates, plafond global et plafond par client.
- B1.2 Plafonds verrouillés côté serveur (multi-caisses, la 101e utilisation refusée, un void libère le compteur).
- B1.3 Menus/combos vérifiés et facturés par le système central (composition contrôlée, suppléments facturés).
- B1.4 Chaque remise nommée **sur le ticket** et **dans l'historique** ; rapport ROI par campagne.
- (Liens) Promos réservées à un niveau de fidélité ; chaque composant d'un menu déduit individuellement du stock.

### B2. Annoncé « À venir »
- B2.1 Codes coupon (newsletter, QR personnalisé).
- B2.2 Promos à créneau horaire avec une interface simple.
- B2.3 Promos par segment de clientèle (VIP, nouveaux clients).
- B2.4 Clarification des règles de cumul.
- B2.5 Suggestion au caissier (« ajoutez une baguette pour déclencher l'offre »).

## C. Écarts (revendications vs code)

| # | Revendication doc | Réalité code | Verdict |
|---|---|---|---|
| B1.1 | 6 formes de remise + dates + plafonds | 4 types promo (`percentage/fixed_amount/bogo/free_product`) + seuil panier (`min_items_total`, ThresholdForm) + prix imposé via **combos** (module 5) ; caps global/par-client dans le form (ConditionsTab) et en DB (`_089`) | ✅ CONFORME |
| B1.2 | Plafonds verrouillés serveur, void libère | Advisory dans `evaluate_promotions_v2` + gate dur `pg_advisory_xact_lock` + re-count dans v17 **et** `pay_existing_order_v11` ; comptage exclut les voided | ✅ CONFORME |
| B1.3 | Combos vérifiés/facturés central | `_resolve_combo_price_v1` (composition + surcharges) appelé par v17 | ✅ CONFORME |
| B1.4 | Remise nommée sur ticket + historique ; ROI | Nommée **à l'écran POS** (panier + écran client) ✓ et stockée (`promotion_applications`) ✓ ; **absente du ticket imprimé** (`ReceiptPayload` sans promos) et **non détaillée dans l'historique BO** (agrégat `discount_amount` seul) ; ROI ✓ (`get_promo_roi_v1` + page) | 🟠 PARTIEL |
| B1.5 (liens) | Promos réservées à un niveau de fidélité | `customer_tier_ids` vestigial : zéro option dans le form, jamais appliqué par l'évaluateur (`_095`) — seul le ciblage par **catégorie client** fonctionne | 🔴 MANQUANT |
| B1.6 (liens) | Composants de menu déduits individuellement du stock | Déduction par composant via `_record_sale_stock_v1` + reversals combo-aware (`20260704000018`) — vérifié par pgTAP `combo_sale` (module 6) | ✅ CONFORME |

**Bonus code (le code fait plus que la doc) :**
- 🔵 Scope produit/catégorie sur les promos % et montant (pas seulement panier).
- 🔵 Règles de cumul déjà modélisées ET appliquées : `priority`, `stackable_with_promo`, `stackable_with_manual` (StackingTab + ancre stacking dans l'évaluateur) — la doc les met « à venir » (B2.4) alors que le moteur existe ; il manque surtout la pédagogie UI.
- 🔵 Dismissal par le caissier (promos écartées par panier, `dismissedPromotionIds`).
- 🔵 Happy hour déjà configurable (jours + heures dans ConditionsTab) — B2.2 est en fait livré, sauf à vouloir une UI « plus simple ».
- 🔵 BOGO paramétrable en % de remise sur l'article offert (`bogo_reward_discount_pct`, 100 % = gratuit).
- 🔵 Realtime : invalidation du cache promos POS sur changement BO (`usePromotionsRealtime`, canal unique par mount).

## D. Plan de correction du module

### D1. Quick wins (< 1 session, pas de spec)
1. **Nommer les remises sur le ticket** : ajouter `promotions: { name, amount }[]` (+ `total_promotion_discount`) à `ReceiptPayload` (`printService.ts`) et au template du print-bridge ; alimenter depuis `cart.appliedPromotions` au moment du print (`SuccessModal`/`usePaymentFlowLogic`). Done = ticket test avec une promo affiche « Happy Hour −15 % ».
2. **Détailler les promos dans l'historique BO** : joindre `promotion_applications` (+ nom promo) dans `useOrderDetail` et lister sous la ligne discount de `OrderDetailPage`. Done = commande avec BOGO montre la promo nommée.
3. **Doc B2.2/B2.4** : constater l'existant (voir D4).

### D2. Chantiers moyens (1 session, plan requis)
1. **Ciblage par palier de fidélité réel** (ferme le vestige `customer_tier_ids`) : décision de représentation (les paliers ne sont pas une table — options : table `loyalty_tiers` seedée, ou remplacer par `customer_tier_slugs TEXT[]` comparé à `get_loyalty_tier(lifetime_points)`) ; implémenter le matcher dans `evaluate_promotions_v2` + le gate v17/v11, remplir les options du form (`usePromotionReferenceData`). Pré-requis pour B2.3 (segments VIP).
2. **Pédagogie cumul** (B2.4) : aperçu « pourquoi cette promo ne s'applique pas » (stacking/priority/caps) dans le POS et le form BO — le moteur existe déjà.

### D3. Chantiers lourds (spec dédiée avant code)
1. **Codes coupon** (B2.1) : nouvelle surface (table coupons, unicité, canal de distribution, saisie/scan POS, anti-abus, interaction avec les caps) — spec dédiée.
2. **Promos par segment** (B2.3) : dépend de D2.1 + du moteur de segments (module 8) ; ciblage dynamique (segment recalculé) ≠ ciblage statique — à trancher en spec.
3. **Suggestions caissier** (B2.5) : évaluation « near-miss » (à 1 article du déclenchement) — extension de l'évaluateur + UX POS, spec courte.

### D4. Amendements à la doc (si c'est la doc qui doit bouger, pas le code)
- B1.4 : tant que D1.1/D1.2 ne sont pas faits, écrire « remise nommée à l'écran et tracée en base ; le détail sur ticket imprimé et dans l'historique arrive ».
- Liens : retirer « promos réservées à un niveau de fidélité » (ou le déplacer en À venir) — seul le ciblage par catégorie client fonctionne.
- B2.2 : reformuler — les promos à créneau horaire **existent** (jours + heures) ; ce qui manque est éventuellement une UI simplifiée.
- B2.4 : reformuler — les règles de cumul sont implémentées (priorité + flags) ; le besoin réel est leur **explication** à l'utilisateur.

## E. Dépendances croisées
- **Module 5 (Catalogue)** : combos = véhicule du « prix imposé » ; cibles produits/catégories des promos.
- **Module 8 (Clients)** : ciblage catégorie client ✓ / palier fidélité (D2.1) ; caps per-customer exigent un client rattaché.
- **Module 2/3 (Caisse & encaissement)** : le gate dur vit dans v17/`pay_existing_order_v11` — tout changement = bump money-path + pgTAP (`combo_sale`, caps) ; D1.1 touche le flux d'impression du POS.
- **Module 14 (Rapports)** : ROI promo ; l'ajout du détail promo dans l'historique (D1.2) profite aux rapports de remises.
- **Module 6 (Stock)** : déduction par composant de combo via `_record_sale_stock_v1`.
