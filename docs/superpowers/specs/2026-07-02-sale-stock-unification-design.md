# S53 — P1.4 : Unification de la déduction stock à la vente (`_record_sale_stock_v1`)

- **Date** : 2026-07-02
- **Session** : S53 (`swarm/session-53`)
- **Audit source** : §4 P1 — T2 de `docs/workplan/audits/2026-06-27-audit-integral-par-module.md`
- **Statut** : design approuvé (brainstorming) — à transformer en plan d'implémentation

## 1. Problème

La déduction de stock à la vente est **dupliquée en 9 `INSERT INTO stock_movements` bruts** répartis sur 3 RPCs, chacun ré-implémentant : insert `stock_movements` (`sale`, négatif), `UPDATE products.current_stock`, et — sauf B2B — l'isolation `display_stock`/`display_movements`. Conséquences :

- **Dette** : toute évolution (nouveau champ, nouvelle garde) doit être répétée 9 fois.
- **Incohérences réelles constatées** (vérifiées dans le SQL, cf. §2) :
  - `create_b2b_order_v2` **ne décrémente pas `display_stock`** pour un article vitrine (les autres chemins oui).
  - `pay_existing_order_v10` **rejette inconditionnellement** le stock négatif — il ignore `business_config.allow_negative_stock`, contrairement à `complete_order_with_payment_v15` et `create_b2b_order_v2`.
- **Contournement du ledger** : les inserts bruts n'ont jamais transité par un point unique auditable.

Note : `record_stock_movement_v1` (la primitive existante) **ne peut pas** porter ces mouvements — elle rejette en dur `movement_type IN ('sale','sale_void')` et ne connaît pas `display_stock`. Elle reste dédiée aux mouvements non-vente (receive/adjust/waste/transfer/production/opname).

## 2. État actuel vérifié (carte de code)

Sources (fichiers `supabase/migrations/`) :

| Chemin | RPC (migration) | Sous-blocs de déduction (raw insert) | display-aware ? | flag-aware (`allow_negative`) ? |
|---|---|---|---|---|
| Encaissement direct | `complete_order_with_payment_v15` (`…064`) | ligne trackée, composant combo, conso recette, ingrédient modifier (4) | oui | oui |
| B2B | `create_b2b_order_v2` (`…069`) | ligne trackée, conso recette (2) | **non** | oui |
| Paiement différé (fire→pay) | `pay_existing_order_v10` (`…20260705000016`) | composant combo, ligne simple, ingrédient modifier (3) | oui | **non** |

Primitives d'expansion réutilisées (inchangées par cette vague) :
- `_resolve_recipe_consumption_v1(p_product_id, p_qty, p_max_depth=5)` → `TABLE(product_id, qty_base, unit)` : descend la BOM par les composants non-trackés, émet les nœuds terminaux trackés.
- `_resolve_line_price_v1(...)` : résolution prix serveur — **hors périmètre** (ne touche pas au stock).

Tables display (isolation, cf. mémoire projet `pos_display_stock_isolation`) :
- `display_stock(product_id, quantity, …)` — 1 ligne/produit vitrine.
- `display_movements(product_id, movement_type, quantity, reason, reference_type, reference_id, created_by, …)` — ledger append-only séparé de `stock_movements`.

Contrepassations (`sale_void`) — **hors périmètre de cette vague** (suivi) : `void_order_rpc`, `refund_order_rpc_v2`, `cancel_b2b_order_v1`.

## 3. Objectif

Une **procédure interne unique** `_record_sale_stock_v1` possède toute la mécanique de déduction stock d'une vente **pour un produit terminal résolu**. Les 3 RPCs gardent l'expansion métier (boucle combo, `_resolve_recipe_consumption_v1`, `jsonb_to_recordset` des ingrédients) et appellent le helper une fois par produit. Zéro `INSERT INTO stock_movements` brut restant dans les flux de vente.

Effets de bord voulus (décidés au brainstorming) :
- **B2B devient display-aware** (corrige l'incohérence) — un article vitrine vendu en B2B décrémente `display_stock`.
- **`pay_existing` devient flag-aware** — respecte `business_config.allow_negative_stock` comme les autres.

## 4. Le helper `_record_sale_stock_v1`

### 4.1 Signature

```sql
CREATE OR REPLACE FUNCTION public._record_sale_stock_v1(
  p_product_id     uuid,
  p_quantity       numeric,       -- magnitude POSITIVE à sortir (le helper écrit -p_quantity)
  p_reference_id   uuid,          -- order_id
  p_created_by     uuid,          -- profile_id
  p_reason         text,          -- libellé display_movements ('POS sale', 'POS combo sale', 'POS modifier: X'…)
  p_movement_type  movement_type DEFAULT 'sale',    -- extensible 'sale_void' (suivi)
  p_reference_type text          DEFAULT 'orders',
  p_unit           text          DEFAULT NULL,       -- résolu depuis products.unit si NULL
  p_allow_negative boolean       DEFAULT false
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
```

### 4.2 Responsabilités (atomique, dans la transaction de l'appelant)

1. Résoudre `is_display_item`, `current_stock`, `unit` depuis `products` (avec `FOR UPDATE` sur la ligne produit — cohérent avec les verrous existants).
2. **Valider la suffisance** :
   - `is_display_item` → comparer à `display_stock.quantity` ;
   - sinon → comparer à `products.current_stock` ;
   - rejeter (`RAISE EXCEPTION`) si `< p_quantity` **sauf si** `p_allow_negative = true`.
   - Message d'erreur homogène : `Insufficient stock for product % (need %, have %)`.
3. `INSERT INTO stock_movements (product_id, movement_type, quantity, unit, reference_type, reference_id, created_by)` avec `quantity = -p_quantity`, `unit = COALESCE(p_unit, products.unit, 'pcs')`.
4. `UPDATE products SET current_stock = current_stock - p_quantity, updated_at = now()`.
5. Si `is_display_item` → `INSERT INTO display_movements (…, p_movement_type, -p_quantity, p_reason, p_reference_type, p_reference_id, p_created_by)` + `UPDATE display_stock SET quantity = quantity - p_quantity, updated_at = now()`.

### 4.3 Hors périmètre du helper (restent dans les RPCs)

Loyalty, écritures comptables (JE), `order_items`, promotions, paiements, résolution prix. **Helper = stock pur.**

### 4.4 Pas de clé d'idempotence

L'idempotence est portée au niveau **ordre** (le `p_idempotency_key` de chaque RPC empêche le double-passage de la commande entière). Le helper n'ajoute pas de clé par mouvement — cohérent avec les inserts bruts actuels.

### 4.5 Sécurité

```sql
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(uuid, numeric, uuid, uuid, text, movement_type, text, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(...) FROM anon;
REVOKE ALL ON FUNCTION public._record_sale_stock_v1(...) FROM authenticated;
ALTER DEFAULT PRIVILEGES ... -- déjà couvert par le défaut projet S20
```

Appelable uniquement depuis les RPCs `SECURITY DEFINER` (jamais depuis le client). Pas de `GRANT` à `authenticated`.

## 5. Migration par RPC & versioning

Règle projet : bump quand le **comportement** change (précédent v14→v15, signature identique bumpée) ; `CREATE OR REPLACE` en place pour un refactor sans changement de comportement (précédent #122).

| RPC | Changement | Traitement | Signature |
|---|---|---|---|
| `complete_order_with_payment_v15` | refactor pur (déjà display+flag-aware) | `CREATE OR REPLACE` **en place**, reste **v15** | inchangée (16 args) |
| `create_b2b_order_v2` → **`create_b2b_order_v3`** | comportement (devient display-aware) | **bump** + `DROP FUNCTION create_b2b_order_v2(uuid, jsonb, text, date, uuid)` même migration + REVOKE pair + GRANT authenticated | identique à v2 (5 args) |
| `pay_existing_order_v10` → **`pay_existing_order_v11`** | comportement (devient flag-aware) | **bump** + `DROP FUNCTION pay_existing_order_v10(uuid, jsonb, uuid, integer, uuid, numeric, text, numeric, text, uuid, jsonb, jsonb)` même migration + REVOKE pair + GRANT roles d'origine | identique à v10 (12 args) |

Dans chaque RPC : remplacer les blocs `INSERT stock_movements + UPDATE products + display` par un appel `_record_sale_stock_v1(...)` ; **supprimer les boucles de validation stock amont** (le helper valide au point de déduction ; même garantie « fail avant écriture partielle » car une seule transaction).

`pay_existing_order_v11` : lire `business_config.allow_negative_stock` (comme v15/b2b) et passer le flag résolu à `p_allow_negative`.

## 6. Call-sites & tests à repointer

**App (repoint obligatoire) :**
- `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts:124` → `rpc('create_b2b_order_v3', …)` (mêmes args) + commentaire d'en-tête.
- `apps/pos/src/features/payment/hooks/useCheckout.ts:8,169` → type `Functions['pay_existing_order_v11']['Args']` + `rpc('pay_existing_order_v11', …)`.

**Types :** regen `packages/supabase/src/types.generated.ts` (v3/v11 changent le catalogue) après migrations.

**pgTAP existants à repointer (nom+signature) :**
- `create_b2b_order_v2` → v3 : `b2b_foundation.test.sql`, `b2b_settlement.test.sql`, `b2b_order_flag_aware_stock.test.sql`.
- `pay_existing_order_v10` → v11 : `combo_fire_pay.test.sql` (dont l'assert anon EXECUTE avec la signature 12-arg), `s44_display_symmetry.test.sql`, `modifier_ingredient_deduction.test.sql`, `pay_existing_discount_gate.test.sql`.

**Vitest / smoke à repointer (assertions sur la chaîne du nom RPC) :**
- `supabase/tests/functions/record-b2b-payment.test.ts` (appelle `create_b2b_order_v2`).
- `apps/pos/src/__tests__/pay-existing.smoke.test.tsx`, `apps/pos/src/features/payment/__tests__/checkout-fired-order-sync.smoke.test.tsx`.

## 7. Plan de tests

Nouvelle suite pgTAP `supabase/tests/sale_stock_unification.test.sql` (via MCP `execute_sql`, enveloppe `BEGIN … ROLLBACK`) :

1. `_record_sale_stock_v1` existe ; `anon` **et** `authenticated` n'ont PAS EXECUTE (REVOKE défense-en-profondeur).
2. **Régression par type** — pour ligne trackée, composant combo, conso recette, ingrédient modifier : les deltas `stock_movements` + `products.current_stock` + `display_stock` sont identiques à l'avant-refactor (valeurs de référence figées dans le test).
3. **B2B display (nouveau)** : un article `is_display_item` vendu via `create_b2b_order_v3` décrémente `display_stock` **et** insère une ligne `display_movements`.
4. **`pay_existing_v11` flag-aware** : avec `allow_negative_stock = ON`, une vente au-delà du stock passe (négatif) ; avec `OFF`, elle est rejetée.
5. **Garde négatif par chemin** quand `OFF` : chaque RPC rejette la survente.
6. **Idempotence ordre préservée** : rejouer un ordre (même `p_idempotency_key`) ne double-déduit pas.

**Ancres de régression déjà en place** (doivent rester vertes après repoint) : `s44_display_symmetry` (parité display de pay_existing), `b2b_order_flag_aware_stock` (flag-aware B2B), `modifier_ingredient_deduction`, `combo_fire_pay`.

Re-run des suites `inventory*`, `b2b_*`, `orders`, + `pnpm build && pnpm typecheck` + smokes POS/BO repointés.

## 8. Séquencement des migrations

Prochain numéro libre : **`20260710000073`** (le plus haut existant est `…072`).

1. `20260710000073_record_sale_stock_v1.sql` — helper + REVOKE pair.
2. `20260710000074_complete_order_v15_use_sale_helper.sql` — `CREATE OR REPLACE` v15 (refactor, comportement identique).
3. `20260710000075_create_b2b_order_v3.sql` — v3 display-aware via helper + `DROP v2` + REVOKE/GRANT.
4. `20260710000076_pay_existing_order_v11.sql` — v11 flag-aware via helper + `DROP v10` + REVOKE/GRANT.
5. Regen types → commit `packages/supabase/src/types.generated.ts`.
6. Repoint hooks (`useCreateB2bOrder`→v3, `useCheckout`→v11) + tests.
7. pgTAP `sale_stock_unification` + re-run ancres + build/typecheck.

Chaque migration appliquée via MCP `apply_migration` sur le projet cloud V3 dev `ikcyvlovptebroadgtvd` (Docker retiré).

## 9. Risques & garde-fous

- **Money-path critique** : `complete_order_with_payment_v15` est le cœur de l'encaissement. Le refactor doit être **comportementalement identique** — la suite de régression §7.2 est bloquante avant tout commit du `…074`.
- **`v15` GRANT** : conserver `GRANT EXECUTE TO authenticated` (l'EF `process-payment` appelle via JWT utilisateur — sans grant, toute la money-path casse en `permission denied`).
- **Ordre de verrou** : le helper prend `FOR UPDATE` sur `products` — vérifier qu'aucun appelant ne détient déjà un verrou incompatible créant un risque de deadlock (les RPCs verrouillent déjà les lignes produit ; le helper doit être le point de verrou unique, sinon double-lock inoffensif mais à confirmer).
- **Suppression de la validation amont** : s'assurer qu'aucun effet de bord (JE, loyalty) n'est écrit **avant** l'appel helper dans un ordre qui rendrait un `RAISE` tardif visible — tout est dans une transaction, donc rollback total, mais l'ordre des writes doit rester : stock d'abord (ou au moins avant tout commit), cohérent avec l'actuel.
- **Bump = blast radius** : v3/v11 imposent le repoint de 2 hooks + ~7 fichiers de test. Aucun EF n'appelle directement `create_b2b_order` (BO direct) ; `pay_existing` est appelé par le POS (`useCheckout`), pas par une EF — à reconfirmer à l'implémentation.

## 10. Critères d'acceptation

- [ ] `_record_sale_stock_v1` créé, REVOKE anon+authenticated+PUBLIC vérifié.
- [ ] Zéro `INSERT INTO stock_movements` brut restant dans `complete_order_with_payment_v15`, `create_b2b_order_v3`, `pay_existing_order_v11` (grep = 0 hit hors helper).
- [ ] `create_b2b_order_v3` décrémente `display_stock` pour un article vitrine (test §7.3 vert).
- [ ] `pay_existing_order_v11` respecte `allow_negative_stock` (test §7.4 vert).
- [ ] Deltas stock identiques à l'avant-refactor sur les 4 types (test §7.2 vert).
- [ ] `v2`/`v10` `DROP`és ; call-sites app + tests repointés ; types regénérés & commités.
- [ ] Ancres `s44_display_symmetry`, `b2b_order_flag_aware_stock`, `modifier_ingredient_deduction`, `combo_fire_pay` vertes.
- [ ] `pnpm build && pnpm typecheck` OK ; smokes POS/BO OK.
