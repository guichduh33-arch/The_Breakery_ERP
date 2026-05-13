# Travail — Promotions & Discounts

> Last updated: 2026-05-03
> Référence : [docs/reference/04-modules/13-promotions-discounts.md](../04-modules/13-promotions-discounts.md)
> Sources d'audit : `docs/audit/00-executive-summary.md` ("Promotion engine est connecté — useCartPromotions auto-evaluates"), `docs/audit/07-product-backlog-audit.md` (Customer segmentation/marketing manquant — Gap Important #14), `docs/audit/05-uiux-design-audit.md` (clarté UI)

## Objectifs du module

1. **Étendre l'engine** au-delà du single-product : BOGO multi-produit (achète 1 croissant + 1 café = café gratuit), bundle dynamique, threshold orders.
2. **Clarifier les règles de stacking** dans l'UI (côté caissier ET côté produit) — quelles promos peuvent se cumuler, lesquelles non.
3. **Coupon codes** côté client (codes one-shot ou réutilisables, expiration, usage_limit).
4. **Promotions time-based** (happy hour, jour de la semaine, plage horaire) via UI claire (pas du JSON brut).
5. **Promotions par segment client** (loyalty tier ; tag client ; nouveau client).
6. **Analytics promo effectiveness** : ROI par promo (CA généré vs coût réduction), uplift mesuré.

## Tâches

### TASK-13-001 — Engine extension : BOGO multi-produit + threshold cart [P1] [TODO]
**Contexte** : `useCartPromotions` (CLAUDE.md pitfall) auto-évalue les promotions sur le panier mais l'engine actuel ne supporte que single-product (X% sur produit Y, ou Y% sur catégorie Z). Audit produit Gap "promotion engine is well-built but limited rules".
**Critère d'acceptation** :
- [ ] Type promo `BUY_X_GET_Y_FREE` : `buy_product_ids[], get_product_ids[], discount_percentage` (ex. achète 2 croissants → 1 café à 50%).
- [ ] Type `CART_THRESHOLD` : `min_cart_total, discount_amount_or_percent` (ex. > 200k IDR → 10% off).
- [ ] Type `BUNDLE` : `required_items[{product_id, quantity}], bundle_price` (force fix price).
- [ ] `promotionEngine.evaluate(cart)` retourne `applied_promotions[{promo_id, discount_amount, lines_affected}]`.
- [ ] Tests unitaires : 10+ scénarios edge (panier vide, plusieurs promos applicables, BOGO partiel).
**Fichiers concernés** : `src/services/promotion/promotionEngine.ts`, types, `src/hooks/useCartPromotions.ts`, `src/services/promotion/__tests__/promotionEngine.test.ts`.
**Dépend de** : aucune
**Estimation** : L
**Risques** : breaking change si algo de calcul change — tests régression sur promos existantes.
**Notes** : modèle d'inspiration : Shopify Functions ou Square Loyalty.

### TASK-13-002 — Stacking rules UI clarification (caissier + admin) [P1] [TODO]
**Contexte** : Audit Sally `05-uiux-design-audit.md` souligne plusieurs UI peu lisibles. Pour les promos : aujourd'hui pas clair si 2 promos sur même panier se cumulent ou pas. Cas réel : "promo loyalty Gold 8% + promo BOGO" = +8% sur le solde après BOGO ou pas ?
**Critère d'acceptation** :
- [ ] Champ `promotions.stacking_priority` (INTEGER) : ordre d'application si plusieurs applicables.
- [ ] Champ `promotions.stacking_mode` (enum: `exclusive | stackable | additive`) : `exclusive` = bloque toute autre promo ; `stackable` = compose ; `additive` = sommes les % (à éviter).
- [ ] UI Promotion Form expose ces options avec helper text.
- [ ] UI Cart affiche les promos appliquées avec icône + tooltip "Cette promo est exclusive : aucune autre n'est applicable".
- [ ] Admin Settings : visualisation matrice "promos applicables ensemble vs exclusives" pour preview.
**Fichiers concernés** : migration colonnes `promotions`, formulaire admin, composant `CartPromotionList`.
**Dépend de** : `TASK-13-001` (engine doit supporter le concept).
**Estimation** : M
**Risques** : confusion comptable si calcul change rétroactivement — appliquer uniquement nouvelles promos.
**Notes** : screenshot UI clair vaut mille mots — design ux-pro-max skill peut aider.

### TASK-13-003 — Coupon codes (one-shot, réutilisables, expirables) [P2] [TODO]
**Contexte** : Marketing veut "donner un code -10% à 50 abonnés newsletter". Impossible aujourd'hui. Audit produit Gap #14 "customer segmentation/marketing".
**Critère d'acceptation** :
- [ ] Table `coupon_codes(code TEXT UNIQUE, promotion_id FK, max_uses INT, used_count INT, expires_at, created_for_customer_id NULLABLE, is_active)`.
- [ ] UI Cart : champ "Coupon code" + bouton Apply.
- [ ] Validation : actif, non expiré, non épuisé, customer correspondant si scope client.
- [ ] Atomic increment `used_count` via RPC `redeem_coupon(code, order_id)` (évite race condition).
- [ ] Settings `/promotions/coupons` : générer batch (ex. 100 codes uniques), export CSV, tracker usage.
**Fichiers concernés** : migration table + RPC, hook `useCoupon`, UI cart + admin page.
**Dépend de** : `TASK-13-001` (couplé à promotion existante).
**Estimation** : M
**Risques** : race condition double-redemption — RPC atomic obligatoire.
**Notes** : permettre code prefix (ex. NEWSLETTER-XXXX) pour traçabilité campagne.

### TASK-13-004 — Time-based promotions UI (happy hour, jour) [P2] [TODO]
**Contexte** : Bakery type "happy hour 16h-18h -20%" ou "Lundi croissants -1k". Schema actuel a `start_date`/`end_date` mais pas plages horaires/jours.
**Critère d'acceptation** :
- [ ] Colonnes `promotions.time_window` JSONB : `{days_of_week: [1..7], hours: {from: '16:00', to: '18:00'}, timezone}`.
- [ ] Engine respecte `time_window` côté évaluation cart.
- [ ] UI form : selectors jours + time picker (pas de JSON brut).
- [ ] Preview : "Active demain (Mardi) de 16h à 18h".
- [ ] Affichage caissier : badge "Happy Hour" pendant la fenêtre.
**Fichiers concernés** : migration + engine update + form composants UI.
**Dépend de** : `TASK-13-001`.
**Estimation** : M
**Risques** : timezone — toujours stocker UTC, afficher en local Asia/Makassar.
**Notes** : synchronisation horloge (NTP) terminal ↔ serveur critique sinon promo se déclenche au mauvais moment.

### TASK-13-005 — Promotions par segment client (loyalty tier, tag) [P2] [TODO]
**Contexte** : "Promo VIP Gold/Platinum -15%" demandé par owner. Engine actuel n'a pas de notion segment.
**Critère d'acceptation** :
- [ ] `promotions.target_segment` JSONB : `{tier: ['Gold','Platinum'] | null, tag: ['vip','tourist'] | null, is_new_customer: bool | null}`.
- [ ] `customers.tags` (TEXT[]) si pas existant.
- [ ] Engine filtre selon `cart.customer_id` → tier + tags + first_order_date < N jours.
- [ ] UI form : selector tier + tags + checkbox "Nouveau client (< 30j)".
- [ ] Admin peut tagger clients en bulk.
**Fichiers concernés** : migration `promotions.target_segment` + `customers.tags`, engine update, form, page customers (tag manager).
**Dépend de** : `TASK-13-001`.
**Estimation** : M
**Risques** : confusion si caissier ne comprend pas pourquoi promo non appliquée (client non loggé).
**Notes** : afficher "Connectez le client pour appliquer cette promo Gold" dans UI cart.

### TASK-13-006 — Analytics promotion effectiveness [P2] [TODO]
**Contexte** : Pas de rapport sur les promos. ROI inconnu. Owner ne sait pas quelle promo "vaut le coup".
**Critère d'acceptation** :
- [ ] Vue `view_promotion_performance` : par `promotion_id` → orders_count, revenue_generated, discount_total, avg_basket_with_promo, avg_basket_without_promo (uplift).
- [ ] Nouveau report `/reports/promotion-effectiveness` (catégorie Sales) avec tableau + bar chart top 10 promos.
- [ ] Date range selector + comparaison période précédente.
- [ ] Drilldown : cliquer une promo → liste des orders concernés.
- [ ] Export CSV/PDF aligné sur autres reports.
**Fichiers concernés** : vue SQL, hook `usePromotionPerformance`, page report, ReportsConfig.
**Dépend de** : `TASK-14-001` (cohérence reports framework).
**Estimation** : M
**Risques** : "uplift" vs "without promo" est conceptuellement piégeux — comparer par tranches horaires/jour similaires.
**Notes** : commencer simple (volumes + discount cost), affiner uplift en V2.

### TASK-13-007 — A/B test promotions [P3] [TODO]
**Contexte** : Marketing avancé : tester 2 variantes de promo (ex. -10% vs 1 produit gratuit) sur des sous-segments comparables.
**Critère d'acceptation** :
- [ ] Table `promotion_experiments(id, name, variant_a_promo_id, variant_b_promo_id, allocation_pct, started_at, ended_at, winning_variant)`.
- [ ] Engine alloue déterministiquement par `customer_id % 100 < allocation_pct` → variant.
- [ ] Rapport comparatif : conversion, AOV, satisfaction (si NPS).
- [ ] Bouton "Promote winning variant" : convertit le gagnant en promo standard et clôt l'expé.
**Fichiers concernés** : migration, engine extension, page admin expé.
**Dépend de** : `TASK-13-006` (analytics de base).
**Estimation** : XL — décomposer.
**Risques** : volumes The Breakery (~200 tx/j) potentiellement insuffisants pour significativité statistique.
**Notes** : peut rester P3 longtemps, pédagogique mais pas urgent.

### TASK-13-008 — Audit promotion appliquée à chaque order (traçabilité) [P2] [TODO]
**Contexte** : Aujourd'hui, modifier ou supprimer une promo perd l'historique (orders passés référencent un promo_id orphelin ou changent de comportement). Pas d'audit trail clair.
**Critère d'acceptation** :
- [ ] Snapshot `orders.applied_promotions` JSONB : `[{promo_id, name, discount_amount, rules_at_time}]` figé au moment de la commande.
- [ ] Trigger `freeze_promotions_on_order_complete` capture le snapshot quand `status='completed'`.
- [ ] UI OrderDetail affiche les promos appliquées avec montant figé (pas re-calculé).
- [ ] Rapports lisent le snapshot, pas la table `promotions` (évite drift).
**Fichiers concernés** : migration `orders.applied_promotions`, trigger SQL, hook `useOrderDetail`.
**Dépend de** : aucune (peut être fait avant les autres tasks)
**Estimation** : M
**Risques** : storage marginal supplémentaire ; tests régressions sur reports.
**Notes** : pattern usuel POS — figer le prix/promo au moment commande.

## Vue transversale

### Dépendances inter-tâches

```
TASK-13-008 (snapshot orders) ← prérequis traçabilité — peut commencer en premier
    ↓
TASK-13-001 (engine BOGO/threshold) ← cœur du module
    ↓
TASK-13-002 (stacking UI) → TASK-13-004 (time-based) → TASK-13-005 (segments)
                          ↘ TASK-13-003 (coupons) → TASK-13-007 (A/B test)
TASK-13-006 (analytics) ← prérequis pour TASK-13-007
```

### Métriques de succès

| Métrique | Baseline 2026-04 | Cible Q3 2026 |
|---|---|---|
| Types de promo supportés | 2 (single product, category) | 5+ (BOGO, threshold, bundle, time, segment) |
| Visibilité ROI promo | aucune | rapport mensuel (TASK-13-006) |
| Coupons actifs simultanés | impossible | illimité (TASK-13-003) |
| Promotion errors caissier | quelques/sem | < 1/sem (UI claire TASK-13-002) |

### Pitfalls connus

- `useCartPromotions` auto-evaluates sur tout changement cart — surveiller perf si engine extension trop lourd (TASK-13-001).
- `calculateTotals` est consommateur — toute modif engine doit pass tests existants.
- Promotions `is_active` flag n'est PAS retro (orders complétés gardent leur snapshot — d'où TASK-13-008).
- Stacking mal compris caissier = sur/sous-discount → impact cash variance (cf. module 12).

### Risques transversaux

- **Régression silencieuse** : modifier l'engine peut changer les totals sur de nouvelles commandes. Tests régression critiques.
- **UX caissier** : promos invisibles ou ambiguës = friction. Audit Sally souligne lacunes UI.
- **Marketing alignment** : TASK-13-003 (coupons) + TASK-13-005 (segments) doivent être co-construits avec marketing/owner.

### Couverture audits

| Tâche | Source audit | Section |
|---|---|---|
| TASK-13-001 | 07-product-backlog-audit.md | engine limité |
| TASK-13-002 | 05-uiux-design-audit.md | clarté UI |
| TASK-13-003 | 07-product-backlog-audit.md | gap "customer segmentation/marketing" |
| TASK-13-004 | besoin métier (happy hour) | — |
| TASK-13-005 | 07-product-backlog-audit.md | gap segmentation |
| TASK-13-006 | 04-reports-testing-audit.md | report missing |
| TASK-13-007 | nice-to-have marketing avancé | — |
| TASK-13-008 | 02-accounting-business-audit.md | traçabilité audit JE |
