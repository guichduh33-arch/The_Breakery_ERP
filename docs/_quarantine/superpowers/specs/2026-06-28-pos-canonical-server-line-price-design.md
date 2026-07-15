# Spec — Résolution canonique du prix de ligne côté serveur (`_resolve_line_price_v1` + money-path `v14 → v15`)

> **Date** : 2026-06-28 · **Session** : 50 / Vague 2a (tranche money-path) · **Branche** : `swarm/session-51` (base `swarm/session-50` incluant la tranche isolée 2a-i, PR #130)
> **Source roadmap** : `docs/workplan/audits/2026-06-27-audit-integral-par-module.md` § P1.1 (findings **C8/C9**) + plan `2026-06-27-session-50-vague2a-isolated-plan.md` (« le prix-ligne serveur canonique fera l'objet d'une spec dédiée ensuite »).
> **Périmètre décidé (2026-06-28)** : prix-ligne canonique **uniquement**. Le settlement B2B par facture (P1.2) part dans une vague suivante.
> **Statut** : SPEC — à valider avant tout code (la money-path est le blast-radius le plus élevé de l'audit).

---

## 1. Contexte & motivation

La money-path actuelle `complete_order_with_payment_v14` re-valide bien **deux** choses côté serveur :
- le **prix de base** de chaque ligne, via `get_customer_product_price()` (override + log d'audit si le client diverge) ;
- les **promotions**, par comparaison stricte client vs `evaluate_promotions_v1` (mismatch ⇒ `check_violation`).

Mais elle **fait confiance au client** sur trois surfaces de prix, ce qui ouvre des fraudes/erreurs d'encaissement (findings audit C8/C9) :

| # | Surface | Comportement actuel | Risque |
|---|---|---|---|
| G1 | **`price_adjustment` des modifiers** | sommé tel quel depuis le JSON client (`v14:310-312, 565-567`) — aucun lookup serveur | un modifier facturé 0 (ou négatif) → sous-facturation ; surcharge gonflée → sur-facturation |
| G2 | **Surcharges d'options combo** | même mécanisme (`price_adjustment` client cru) | idem G1 sur les combos |
| G3 | **Lignes-cadeau** (`is_promo_gift`) | seul le `promotion_id` doit être déclaré (`v14:287-293`) ; **le `product_id` et la `quantity` offerts ne sont pas validés** contre la règle de promotion | encaisser gratuitement **n'importe quel** produit cher en le taguant `is_promo_gift` avec un `promotion_id` valide mais sans rapport |
| G4 | **Reçu & affichage client** | recalcul **client** via `calculateTotals(cart, DEFAULT_TAX_RATE)` avec `DEFAULT_TAX_RATE = 0.10` **hardcodé** ; ignore promos et valeurs serveur | reçu/affichage divergent du débit réel ; taux de taxe figé → désynchro si `business_config.tax_rate` change |

**Objectif** : faire du **serveur la seule autorité** sur le prix de chaque ligne (base + modifiers + surcharges combo + cadeaux) et exposer une **ventilation par ligne** que le reçu et l'affichage client **consomment** au lieu de recalculer.

### Source de vérité confirmée (code, worktree `swarm/session-51`)

- Prix de modifier : **`product_modifiers.price_adjustment DECIMAL(12,2)`**, clé `(product_id XOR category_id, group_name, option_label)`, `is_active AND deleted_at IS NULL` (`supabase/migrations/20260505000001_init_modifiers.sql:11-38`).
- Prix de base combo : `products.combo_base_price` (`20260704000010_combo_schema.sql:5`) — déjà override serveur dans v14 (`:216-217`).
- Taux de taxe : `business_config.tax_rate` (déjà lu serveur, `v14:197`) ; **hardcodé client** dans `packages/domain/src/orders/taxRate.ts:15` (`DEFAULT_TAX_RATE = 0.10`) consommé par `ActiveOrderPanel`, `BottomActionBar`, `usePrintBill`, `CustomerDisplayPage`.
- Items envoyés par le client : `buildOrderPayload.ts` → `{product_id, quantity, unit_price, modifiers[], is_promo_gift?, promotion_id?, combo_components?}`. `unit_price` et `modifiers[].price_adjustment` traversent l'EF `process-payment` **verbatim**.
- Cadeaux autorisés : `evaluate_promotions_v1` retourne déjà les **free items** dans `applied_promotions` — base d'autorité pour valider G3.

---

## 2. Comportement actuel (résumé ancré, baseline de non-régression)

- `complete_order_with_payment_v14(p_session_id, p_order_type, p_items, p_payment, p_idempotency_key, p_customer_id, p_loyalty_points_redeemed, p_table_number, p_discount_amount, p_discount_type, p_discount_value, p_discount_reason, p_discount_authorized_by, p_promotions, p_payments, p_manager_pin)` → `jsonb` (`order_id, order_number, subtotal, tax_amount, total, discount_amount, promotion_total, loyalty_*, customer_id, table_number, tender_count, change_given`). Déf : `20260710000023_complete_order_v14_flag_aware_deduction.sql`.
- Ligne : `v_line_total := round_idr((v_unit_price + v_modifiers_per_unit) * v_quantity) - v_line_discount` (`v14:318,571`).
- Taxe (TTC→ventilée) : `tax = round_idr(total * rate / (1 + rate))` (`v14:446`).
- Helpers réutilisables : `get_customer_product_price`, `evaluate_promotions_v1`, `_resolve_modifier_ingredients_v1`, `_resolve_recipe_consumption_v1`, `round_idr`.
- Tests money-path existants : `s44_money_gates`, `order_discount_gate`, `combo_sale`, `complete_order_v10_display`, `modifier_ingredient_deduction`, `recipe_consumption_cascade` (pgTAP) + `functions/process-payment.test.ts`, `functions/promotions-evaluate-v1.test.ts` (live). **Ces suites sont la baseline : v15 doit toutes les garder vertes** (en alignant les appels `v14→v15`).

---

## 3. Conception proposée

### 3.1 Helper `_resolve_line_price_v1` (SECURITY DEFINER, IO interne, REVOKE complet)

Fonction interne pure-lecture qui, pour **une ligne**, recalcule le prix **depuis les tables source** et renvoie une ventilation.

```sql
_resolve_line_price_v1(
  p_product_id   uuid,
  p_quantity     numeric,
  p_modifiers    jsonb,        -- [{group_name, option_label, ...}] — price_adjustment client IGNORÉ
  p_customer_id  uuid,         -- pour get_customer_product_price (catégorie tarifaire)
  p_is_gift      boolean,
  p_combo        boolean       -- true → base = products.combo_base_price
) RETURNS TABLE (
  unit_price        numeric,   -- base serveur (0 si is_gift)
  modifiers_total   numeric,   -- Σ price_adjustment serveur par unité
  line_subtotal     numeric,   -- round_idr((unit_price + modifiers_total) * quantity) ; 0 si is_gift
  modifiers_resolved jsonb     -- modifiers ré-enrichis du price_adjustment serveur (pour snapshot order_items)
)
```

Règles :
1. **Base** = `combo_base_price` si `p_combo`, sinon `get_customer_product_price(p_product_id, p_customer_id)`. Si `p_is_gift` ⇒ base forcée à `0`.
2. **Modifiers** : pour chaque entrée `{group_name, option_label}`, lookup `product_modifiers.price_adjustment` par scope résolu (produit puis fallback catégorie), `is_active AND deleted_at IS NULL`. **Le `price_adjustment` du client est ignoré.** Une option introuvable/inactive ⇒ `RAISE EXCEPTION ... ERRCODE='check_violation'` (`Unknown or inactive modifier option`). Si `p_is_gift` ⇒ `modifiers_total = 0` (un cadeau ne facture pas ses modifiers).
3. `line_subtotal = round_idr((unit_price + modifiers_total) * p_quantity)` (le `line_discount` reste géré par l'appelant, inchangé).
4. **Pas de réseau, pas d'écriture.** `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` (+ `ALTER DEFAULT PRIVILEGES`). Appelée uniquement par les RPC money-path (DEFINER).

### 3.2 Validation des lignes-cadeau (G3) — dans `v15`, après l'éval serveur des promos

Aujourd'hui v15 appelle déjà `evaluate_promotions_v1` qui renvoie les **free items autorisés**. Pour chaque ligne `is_promo_gift` :
- vérifier qu'il existe, dans `applied_promotions` du résultat serveur, un free-item **(product_id, quantity)** correspondant à la ligne (match exact `product_id` + `quantity ≤ qté offerte autorisée`) ;
- sinon `RAISE EXCEPTION 'Gift line not authorized by server-evaluated promotion' USING ERRCODE='check_violation'`.

> **Dépendance** : confirmer la forme exacte des free-items dans la sortie de `evaluate_promotions_v1` (clé `free_items` / `free_product` ?) — **à vérifier dans l'impl** (`20260517000082`). Si la sortie ne porte pas la qté/produit exploitable, étendre `evaluate_promotions_v1` est **hors périmètre** ⇒ repli : valider que le `product_id` offert appartient au scope `free_product` de la promo déclarée (gate plus faible mais ferme la fraude « produit arbitraire »). **Décision D2 ci-dessous.**

### 3.3 `complete_order_with_payment_v15` (bump, DROP v14 même migration)

- **Signature inchangée** (mêmes 16 args, même ordre) → réduit le blast-radius EF/client. Bump justifié par le **changement de sémantique** (ignore désormais `unit_price`/`price_adjustment` client) + **enrichissement du retour**.
- Remplacer le calcul de `v_unit_price`/`v_modifiers_per_unit` par un appel `_resolve_line_price_v1` par ligne (gift et non-gift). Le `unit_price` client devient **informatif** : si divergence avec la base serveur, conserver le log d'audit `price_override` existant (continuité).
- Ajouter la validation cadeau (§3.2).
- **Retour enrichi (additif, non-breaking)** : nouvelle clé `lines` = `[{ line_id, product_id, quantity, unit_price, modifiers_total, line_subtotal, line_discount, line_total }]` (valeurs **serveur**), + conserver `subtotal/tax_amount/total/...` existants. Le reçu/affichage consomment `lines` + `tax_amount` + `total`.
- `combo_components` : la surcharge éventuelle passe déjà par les modifiers ⇒ couverte par §3.1. Le snapshot `order_items.modifiers` utilise `modifiers_resolved` (price_adjustment serveur) pour que l'historique reflète le prix réellement facturé.
- REVOKE pair complet sur v15 (mirror v14), `DROP FUNCTION complete_order_with_payment_v14(<16 args>)` dans la **même** migration, regen types.

### 3.4 Client — consommer les valeurs serveur

- **Reçu post-paiement & affichage client post-encaissement** : consommer `lines`, `tax_amount`, `total` renvoyés par v15 (via la réponse de l'EF `process-payment`). Plus aucun recalcul.
- **Taux de taxe** : remplacer `DEFAULT_TAX_RATE` hardcodé par la valeur serveur. Introduire un `useTaxRate()` (lecture `business_config.tax_rate`, déjà exposée ?) — **à vérifier** ; sinon l'exposer en lecture gatée. Tous les call-sites (`ActiveOrderPanel`, `BottomActionBar`, `usePrintBill`, `CustomerDisplayPage`) basculent dessus.
- **Reçu pré-paiement (`usePrintBill`)** : imprimé **avant** la commande → pas d'`order_id`, donc pas de retour v15. **Décision D1** : (a) garder un calcul client mais via le **même taux serveur** (estimation explicite « non définitif ») ; ou (b) introduire un RPC lecture seule `quote_order_pricing_v1` réutilisant `_resolve_line_price_v1` pour une ventilation serveur sans écriture. **Reco : (a)** pour cette vague (périmètre serré), (b) en dette si une divergence pré/post-paiement est constatée.

---

## 4. Décisions ouvertes à valider (avant code)

| ID | Décision | Options | Reco |
|---|---|---|---|
| **D1** | Reçu pré-paiement (pas d'order_id) | (a) calcul client au taux serveur ; (b) RPC `quote_order_pricing_v1` lecture seule | **(a)** — périmètre serré, (b) en dette |
| **D2** | Granularité validation cadeau | (a) match exact `(product_id, quantity)` vs free-items serveur ; (b) repli : produit ∈ scope `free_product` de la promo | **(a) si** `evaluate_promotions_v1` expose la qté ; sinon **(b)** |
| **D3** | Signature v15 | (a) inchangée (16 args, retour enrichi) ; (b) nettoyer `p_items` du `unit_price`/`price_adjustment` client | **(a)** — minimise le blast-radius EF/client ; le client garde le droit d'envoyer ces champs (ignorés serveur) |
| **D4** | Override prix de base divergent | (a) override silencieux + audit (actuel) ; (b) rejeter `check_violation` | **(a)** — continuité, évite de casser des paniers legitimes au rounding |

---

## 5. Périmètre

**Inclus** : helper `_resolve_line_price_v1`, bump `v14→v15` (modifiers/combo/cadeau autoritatifs serveur + retour `lines`), bascule reçu/affichage + taux de taxe serveur, pgTAP + alignement des suites money-path, regen types, MAJ EF `process-payment` (si la forme du retour consommée change) et call-sites client.

**Exclus (vagues suivantes)** : settlement B2B par facture (P1.2), unification stock flag-aware combo/modifier (P1.4 — partiellement traité 2a-i), clôture annuelle / garde fiscale fail-closed (P1.3 reliquat), durcissement EF restant (P1.5 reliquat), FIFO/lots (P3).

---

## 6. Plan de vagues (pour le swarm de code, après validation de cette spec)

> Contrainte d'exécution : les subagents n'ont **pas** le MCP Supabase → migrations + pgTAP via la session principale (lead). EF (Deno) + code app délégables, déployés/commités par le lead. Money-path = revue `pattern-guardian` + `db-engineer` obligatoire sur le diff DB.

- **W1 — Helper + RPC (db-engineer + lead MCP)** : migration `20260710000063_resolve_line_price_v1` ; migration `20260710000064_complete_order_v15_canonical_line_price` (CREATE v15 + DROP v14 + REVOKE pair) ; pgTAP `canonical_line_price.test.sql` (modifier price ignoré/relu, cadeau produit arbitraire rejeté, surcharge combo serveur, retour `lines` cohérent) ; regen types. **Apply + pgTAP live par le lead.**
- **W2 — EF + client (pos-specialist / edge-functions-engineer)** : EF `process-payment` propage le retour enrichi ; `useCheckout` + reçu post-paiement + `CustomerDisplay` consomment `lines/tax_amount/total` ; `useTaxRate()` remplace `DEFAULT_TAX_RATE` ; alignement appels `v14→v15`. Typecheck + smoke.
- **W3 — Tests + closeout (test-engineer + coordinator)** : aligner `s44_money_gates`, `order_discount_gate`, `combo_sale` sur v15 ; Vitest live `process-payment` ; INDEX de session + déviations numérotées + bump CLAUDE.md Active Workplan ; PR squash empilée sur `swarm/session-50`.

---

## 7. Critères d'acceptation

- **A1** — Un modifier au `price_adjustment` client falsifié (0 ou gonflé) est **ignoré** : la ligne est facturée au `product_modifiers.price_adjustment` réel. pgTAP rouge→vert.
- **A2** — Une option de modifier inexistante/inactive ⇒ `check_violation` (pas d'encaissement silencieux).
- **A3** — Une ligne `is_promo_gift` sur un produit **non autorisé** par la promo serveur ⇒ `check_violation`. Un cadeau légitime passe inchangé.
- **A4** — La surcharge d'option combo est recalculée serveur (client ignoré).
- **A5** — v15 renvoie `lines[]` (valeurs serveur) ; reçu post-paiement + affichage client les consomment ; **aucun** recalcul client du total/taxe encaissés.
- **A6** — Taux de taxe client = valeur serveur (`business_config.tax_rate`), plus de `0.10` hardcodé sur les chemins d'encaissement.
- **A7** — Baseline non-régressée : `s44_money_gates`, `order_discount_gate`, `combo_sale`, `complete_order_v10_display`, `modifier_ingredient_deduction`, `recipe_consumption_cascade` **toutes vertes** sur v15 ; promotions toujours strictement re-validées ; idempotence préservée.
- **A8** — REVOKE pair complet sur `_resolve_line_price_v1` (PUBLIC+anon+authenticated) et v15 ; `v14` droppée ; types regénérés et commités.

---

## 8. Risques & mitigations

| Risque | Mitigation |
|---|---|
| Casser un panier légitime (rounding modifier/promo) | D4 = override+audit (pas de rejet sur la base) ; pgTAP sur paniers réels combo+modifier+promo |
| `evaluate_promotions_v1` n'expose pas la qté offerte | repli D2(b) ; ne **pas** étendre l'évaluateur dans cette vague |
| Divergence reçu pré-paiement vs encaissement | D1(a) au taux serveur ; dette (b) si constatée |
| Blast-radius money-path | signature inchangée (D3a), DROP v14 même migration, revue pattern-guardian+db-engineer, apply+pgTAP live par le lead, baseline complète re-jouée |
| `schema_migrations` cloud endommagé (caveat actif) | n'impacte pas le workflow MCP `apply_migration` ; ne pas tenter de réparer ici (hors périmètre) |
