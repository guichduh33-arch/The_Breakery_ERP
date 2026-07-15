# Spec — Câblage `track_inventory` / `deduct_stock` + réglage global « stock négatif »

- **Date :** 2026-06-26
- **Statut :** Design validé (brainstorming) — en attente de relecture utilisateur avant plan d'implémentation
- **Branche cible :** `feat/stock-tracking-deduct-flags`
- **Skill domaine :** `stock-management`
- **Fichiers de référence :** `CLAUDE.md` (Critical patterns), `docs/reference/04-modules/15-production-recipes.md`

---

## 1. Problème

Deux options existent dans les réglages produit du BackOffice (`GeneralPanel.tsx`) — **« Track inventory »** et **« Deduct stock »** — mais elles ne produisent pas le comportement métier attendu :

- **`deduct_stock`** est une **colonne orpheline** : persistée par `create_product_v1` / `update_product_v1`, mais **lue par aucun RPC de consommation**. Elle ne fait rien aujourd'hui.
- **`track_inventory`** n'est **qu'à moitié câblé** : il sert uniquement à une *validation* pré-vente (« bloquer si stock insuffisant »), mais la **décrémentation réelle du stock fini se fait toujours, inconditionnellement** (`complete_order_with_payment_v14`, lignes 618-621), sans regarder le flag.

Conséquences :
- Un produit fait-à-la-commande (café, `track_inventory=false`) voit quand même son « stock de cappuccino » passer en négatif.
- Ses matières premières (grains, lait) ne sont **jamais** déduites à la vente — aucune cascade de recette dans le chemin de vente.

Par ailleurs, il n'existe **aucun réglage global** permettant d'autoriser ou non la vente/production quand le stock des matières premières est insuffisant : la production bloque en dur (`record_production_v1`, `insufficient_stock` P0002 ligne 301), la vente ne contrôle rien à la décrémentation.

## 2. Objectif

1. **Câbler les deux flags** avec une sémantique métier claire et orthogonale, dans la vente **et** la production.
2. **Ajouter un réglage global** « autoriser le stock négatif » (vente + production), par **défaut AUTORISER**, configurable depuis une page Réglages Inventory du BackOffice.

## 3. Sémantique canonique des flags

- **`track_inventory`** = « on compte et suit le stock du produit lui-même » → décrémenté à la vente, incrémenté à la production/réception.
- **`deduct_stock`** = « ce produit consomme ses matières premières / semi-finis du stock ». Le **moment** dépend de `track_inventory` : à la **production** si le produit est suivi (croissant), à la **vente** s'il ne l'est pas (café).

### Table de vérité

| Profil | `track_inventory` | `deduct_stock` | Entrée stock | Sortie stock |
|---|---|---|---|---|
| Matière première (lait, grains) | `true` | `false` | PO (`purchase`) | `production_out` **ou** cascade vente |
| Semi-fini suivi (espresso préparé) | `true` | `true` | `production_in` | `production_out`/cascade vente ; sa propre production déduit ses matières |
| Fini préparé à l'avance (croissant) | `true` | `true` | `production_in` | vente (1 fini) ; sa production déduit ses matières |
| Fini fait à la commande (café/latté) | `false` | `true` | — (illimité) | vente = cascade recette |
| Service / revendu non suivi | `false` | `false` | — | rien |

### Invariant « matière première »
Une matière première = `track_inventory=true` + `deduct_stock=false`, **entrée** par purchase order (mouvement `purchase`, met aussi à jour le WAC via `tr_update_product_cost_on_purchase`), **sortie** par `production_out` **ou** par cascade de vente.

### Règle de cascade : « arrêt aux nœuds suivis »
Lorsqu'un produit fait-à-la-commande (`track_inventory=false`, `deduct_stock=true`, recette active) est vendu, la déduction descend dans la recette via `recipe_bom_full_v1` (depth-5, S17) avec la règle :

> Pour chaque composant : s'il est `track_inventory=true` (matière première **ou** semi-fini suivi), on déduit **son** stock comme une unité et on **s'arrête** sur cette branche. S'il est `track_inventory=false`, on **descend** dans sa recette.

Exemple : cappuccino (non suivi) → si l'espresso est un semi-fini **suivi**, on déduit 1 espresso ; si l'espresso est non suivi, on descend jusqu'aux grains + lait. Cela évite de double-compter un semi-fini déjà produit et stocké.

## 4. Conception détaillée

### 4.1 Vente — `complete_order_with_payment_v14` → **v15**

Changements dans le RPC money-path :

1. **Décrémentation du stock fini conditionnelle** : `UPDATE products SET current_stock = current_stock - qty` n'est exécuté **que si `track_inventory=true`** (aujourd'hui inconditionnel = bug).
2. **Cascade recette à la vente** : si `track_inventory=false AND deduct_stock=true AND` le produit a une recette active → résoudre la consommation via `recipe_bom_full_v1` avec la règle « arrêt aux nœuds suivis ». Pour chaque nœud suivi consommé : émettre un mouvement `sale` (signe négatif) + `UPDATE products.current_stock`. `lot_id = NULL` (cohérent avec l'état FIFO non câblé du projet).
3. **Service / illimité** : `track_inventory=false AND deduct_stock=false` → **aucune** déduction.
4. **Boucles combo et ingrédients de modificateurs** : appliquer la même règle par composant (le code v14 a déjà ces boucles ; on les aligne sur la nouvelle logique track/deduct).
5. **`is_display_item`** (vitrine POS) : comportement conservé tel quel (double déduction `display_stock` + `current_stock` documentée).
6. **Validation pré-vente** : valider la disponibilité de **ce qui sera réellement décrémenté** (le fini si suivi, sinon les nœuds de la cascade), en respectant le réglage stock négatif (§4.3).
7. **REVOKE pair** S25 sur la nouvelle signature ; **DROP** de `v14` dans la même migration.

> ⚠️ **Impact EF** : le POS passe par l'Edge Function `process-payment`, qui appelle `complete_order_with_payment_v14`. L'EF (`supabase/functions/process-payment/index.ts`) doit être repointée sur `v15` dans le même lot.

### 4.2 Production — `record_production_v1` → **v2** (et `record_batch_production_v2` en miroir)

1. **Consommation des matières gardée par `deduct_stock`** du produit fabriqué : si `deduct_stock=false`, on n'émet pas de `production_out` (cohérence du flag partout). Cas normal : produit fabriqué = `deduct_stock=true`.
2. **`production_in`** (montée du stock fini) inchangé — valorisation au coût réel conservée (`20260626000015`).
3. **Gate `insufficient_stock`** (ligne 301) **contourné si stock négatif autorisé** (§4.3).
4. RPC versioning monotone : nouvelle signature + DROP de l'ancienne + REVOKE pair. Mettre à jour tous les call-sites (`Grep` sur `record_production_v1`).

### 4.3 Réglage global « autoriser le stock négatif »

- **Schéma** : nouvelle colonne `allow_negative_stock BOOLEAN NOT NULL DEFAULT true` sur le singleton `business_config` (`id=1`).
- **Lecture** : lue **une seule fois** en début de la vente (v15) et de la production (v2). Elle gouverne **tous** les décréments de ces flux :
  - `true` (défaut) → on laisse passer en négatif, **pas** de raise.
  - `false` → on lève `insufficient_stock` (P0002) avec détail JSON `{ product_id, name, required, available, shortfall, unit }` comme aujourd'hui.
- **Portée** : s'applique à tout stock décrémenté par la vente (fini suivi **et** nœuds de cascade) et par la production (matières).
- **RPC de réglages** :
  - `get_settings_by_category_v1` : ajouter la catégorie **`inventory`** retournant `{ allow_negative_stock }`. Signature inchangée → `CREATE OR REPLACE` + REVOKE pair réaffirmé.
  - `set_setting_v1` : ajouter la clé `allow_negative_stock` à la whitelist (type booléen), sous permission `settings.manage`. Signature inchangée → `CREATE OR REPLACE` + REVOKE pair réaffirmé.

### 4.4 UI BackOffice

- **Page Réglages Inventory** (nouvelle) : un toggle « Autoriser le stock négatif (vente & production) », câblé sur les hooks `get_settings_by_category_v1('inventory')` / `set_setting_v1`. Emplacement à confirmer au plan : `apps/backoffice/src/features/settings/` (cohérent avec les autres pages settings) avec entrée de navigation, en réutilisant les primitifs `@breakery/ui` (`ToggleRow`/`Card`, cf. skill `breakery-ui-kit`).
- **Form produit** : les toggles `track_inventory` et `deduct_stock` s'affichent et se persistent déjà (`GeneralPanel.tsx` + RPC create/update). Vérifier/ajuster les libellés et sous-titres pour refléter la sémantique exacte (ex. « Deduct stock » → « Déduit les matières premières (recette) »). Aucun changement de schéma produit.

## 5. Tests

- **pgTAP** (`supabase/tests/`, via MCP `execute_sql` BEGIN/ROLLBACK) :
  - Vente café (`track_inventory=false`, `deduct_stock=true`) → grains + lait décrémentés, pas de stock fini.
  - Vente croissant (`track_inventory=true`, `deduct_stock=true`) → 1 fini décrémenté, matières **non** retouchées.
  - Vente service (`false/false`) → aucun mouvement.
  - Cascade « arrêt aux nœuds suivis » : semi-fini suivi déduit comme unité ; non suivi → descente jusqu'aux feuilles.
  - `allow_negative_stock=false` → raise `insufficient_stock` ; `=true` → passe en négatif.
  - Production : gate négatif respecté ; `deduct_stock=false` → pas de `production_out`.
  - Settings RPC : lecture/écriture catégorie `inventory`, perm denied pour rôle non autorisé, REVOKE anon.
- **Vitest live RPC** (`supabase/tests/functions/`) : un fichier par famille (vente cascade, production gate, settings).
- **BO smoke** : page Réglages Inventory (render + toggle).
- **Régression** : suite vente/order existante — fixer `allow_negative_stock=false` dans les setups qui attendent un blocage (cf. §7).

## 6. Migrations & propagation

- Numérotation monotone à partir de `20260710000020` (plus haute actuelle : `20260710000012`).
- Lot type : colonne `business_config` → `get/set settings` (CREATE OR REPLACE) → `complete_order ... v15` (+ DROP v14 + REVOKE) → `record_production_v1 v2` / `record_batch_production_v2` (+ DROP + REVOKE).
- **Régénérer les types** via MCP `generate_typescript_types` → `packages/supabase/src/types.generated.ts` + commit.
- Repointer l'EF `process-payment` sur `v15`.
- Mettre à jour tous les call-sites front (`useCheckout`, hooks production) si la signature change.

## 7. Risques & points d'attention

1. **Changement de comportement par défaut** : aujourd'hui la production **bloque** sur stock insuffisant ; on passe à **« autorisé par défaut »** (`allow_negative_stock=true`). Les tests existants qui attendent un blocage devront fixer `allow_negative_stock=false` dans leur setup, ou être mis à jour.
2. **Money-path = fort impact** : bump `v15` + mise à jour de l'EF `process-payment`. Zone la plus sensible du projet ; tests vente complets obligatoires avant merge.
3. **Idempotence** : la vente (`process-payment` via header `x-idempotency-key`) et la production (`p_idempotency_key`) conservent leur idempotence — la cascade ne doit pas casser le replay (la déduction reste sous la même clé / le même mouvement de référence).
4. **Double-déduction** : invariant central à protéger par test — un produit `track_inventory=true` ne doit **jamais** voir ses matières déduites à la vente (déjà faites en production).

## 8. Hors périmètre (noté, non traité ici)

- **Comptabilité COGS du fait-à-la-commande** : déduire les ingrédients à la vente donne une base COGS correcte, mais le mapping JE n'est pas modifié dans cette spec (`tr_stock_movement_je` n'émet pas de JE pour `sale` — les JE de vente viennent des triggers d'ordre). À traiter dans une spec comptable dédiée si besoin.
- **FIFO / `lot_id`** : non câblé sur le projet (statut M3, audit 2026-06-12). Les mouvements `sale` d'ingrédients porteront `lot_id NULL` comme le reste. Pas de changement FIFO ici.
- **Variantes parentes stockables** (m2 ouvert) : décision produit non tranchée — hors scope.
