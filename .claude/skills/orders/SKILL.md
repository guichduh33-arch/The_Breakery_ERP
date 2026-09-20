---
name: orders
description: >-
  Commandes Breakery : cycle de vie, édition de lignes, held, void/refund, liste BO, filtres, tri, pagination et realtime. Pour modifier ou vérifier ces contrats. Symptôme du parcours caisse/tablette : pos-flow-audit.
---

# Orders — The Breakery ERP

Identifier le parcours et son appelant avant de lire le contrat SQL. Pour une liste, vérifier ensemble filtres, compteurs, tri et curseur ; pour une écriture, suivre ses effets atomiques.

## Lecture proportionnée

Les règles d’AGENTS.md restent applicables. Les liens ci-dessous sont conditionnels : ne pas charger tout le dossier ni tous les skills voisins. Réutiliser les lectures déjà faites dans la session ; rouvrir si le code ou le périmètre a changé.

| Quand lire | Ressource |
|---|---|
| Pour le contrat, le parcours ou la surface concernée ; avant toute modification de sa logique. | [modèle, contrats et repères](references/model.md) |
| Avant une modification et avant de conclure : sélectionner les contrôles du parcours, puis exécuter les tests requis par AGENTS.md. | [contrôles et sources](references/verification.md) |

## Critical patterns (ordres-spécifiques)

1. **Jamais d'INSERT direct dans `orders`** — toujours via RPC. Les RPCs gèrent atomiquement :
   JE triggers, loyalty, promotions, déduction de stock, `table_state`.
2. **Le POS n'appelle pas le money-path en direct** — il poste l'EF `process-payment`, qui
   appelle `complete_order_with_payment` côté serveur. Idem `refund-order`, `void-order`,
   `cancel-item`.
3. **Status guard sur edit-items** — `('draft', 'pending_payment')` uniquement, `P0002` sinon.
   Ne pas ajouter `'open'` (valeur inexistante dans l'enum).
4. **Prix de ligne = domaine/serveur, jamais recomposé** — côté SQL, `_resolve_line_price` ;
   côté TS, `lineTotalOf`/`lineUnitEach` de `packages/domain`. Recomposer
   `unit_price + price_adjustment` est le bug de sous-facturation des combos, ressuscité trois
   fois avant que la garde CI `line-total-formula` ne l'interdise.
5. **Idempotency keys propres par RPC** — ne pas partager une même `p_idempotency_key` entre
   deux appels distincts dans `useEditOrderItems`. Générer un UUID par call.
6. **Transport du PIN — deux véhicules, aucun n'est un défaut.** Vers une **Edge Function**,
   le PIN voyage en en-tête `x-manager-pin`, jamais dans le body JSON (les bodies sont loggés).
   Vers une **RPC Postgres**, un PIN se transporte en **argument** `p_manager_pin` : c'est le
   seul véhicule qu'une RPC peut valider, une fonction SQL ne lit pas d'en-tête HTTP. Dans le
   domaine ordres, aucune RPC live ne reçoit le PIN : les EF `refund-order`, `void-order`,
   `cancel-item` et `verify-manager-pin` le vérifient en amont et passent une **identité
   d'autorisation** (`p_authorized_by` / `p_acting_auth_user_id`) ou un **nonce**
   (`discount_authorizations`).
7. **Realtime StrictMode-safe** — `useOrdersRealtime` nomme son channel avec `useId()` ; jamais
   de nom statique (collisions silencieuses au double-mount).
8. **Déduction de stock de vente = `_record_sale_stock`, helper unique.** Pour un produit
   `is_display_item`, il décrémente `display_stock.quantity` **et** `products.current_stock`,
   et écrit dans `display_movements`. Pour un non-display suivi, `current_stock` seulement.
   La rupture de vitrine lève `P0002` (mappé `insufficient_stock` 409 par `process-payment`).
   Ne pas réécrire cette logique dans une RPC appelante.
9. **`orders.session_id` nullable — trois exemptions**, cf. la section schéma. Ne jamais
   resserrer à NOT NULL global.

---

## Qualité de restitution

Répondre d’abord au problème demandé. Distinguer fait observé, intention métier et hypothèse ; ancrer les constats dans le code lu ou le résultat mesuré. Un ancien relevé n’est pas une preuve actuelle. Donner impact, correction ou décision attendue, vérification effectuée et limite éventuelle ; ne pas remplir des rubriques sans résultat utile. Une consigne de skill n’élargit pas l’autorisation donnée par Mamat.
