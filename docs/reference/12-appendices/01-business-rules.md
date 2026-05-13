# 01 — Business rules

> **Last verified**: 2026-05-03

Règles métier transverses de The Breakery (POS/ERP). Source de vérité : `CLAUDE.md` § "Business Rules" + modules `04-modules/*`.

---

## 1. Currency — IDR (Indonesian Rupiah)

| Règle | Valeur |
|---|---|
| Devise | IDR — Rupiah indonésien |
| Symbole UI | `Rp` (préfixe) |
| Formatage thousands | `.` ou ` ` selon contexte (display : `Rp 12.500`, comptabilité : `12,500.00` en-US) |
| Locale standardisée pour numbers | `en-US` (Sprint 2 U2) — virgule = milliers, point = décimales |
| Décimales monétaires | `0` à l'affichage POS, `2` en comptabilité (numeric(12,2) en DB) |
| Arrondi | **Au 100 le plus proche** (rounding nearest) |

### Helper d'arrondi

```ts
// src/utils/formatters.ts (ou similaire)
export function roundIdr(amount: number): number {
  return Math.round(amount / 100) * 100
}
```

| Avant arrondi | Après arrondi |
|---|---|
| `12.450` | `12.500` |
| `12.449` | `12.400` |
| `12.500` | `12.500` |
| `99.999` | `100.000` |

### Affichage

```ts
function formatIdr(amount: number): string {
  return `Rp ${amount.toLocaleString('en-US')}`
  // 12500 → "Rp 12,500"
}
```

---

## 2. Tax — PB1 (Pajak Restoran Lombok) 10 %

> **Important** : V2 utilise **PB1** (taxe restaurant locale Indonésie), **PAS** PPN.

| Règle | Valeur |
|---|---|
| Type de taxe | **PB1** — Pajak Restoran (taxe restaurant régionale Lombok) |
| Taux | **10 %** (fixe — pas de variation, pas de paliers) |
| Mode | **Inclus dans le prix** affiché (TTC) |
| Reporting | Aucun reporting DJP automatique (PB1 ≠ PPN, ne passe pas par e-Faktur) |
| Compte taxe collectée | **2110** — PB1 Collected |
| Compte taxe à payer | **2143** — PB1 Payable |

### Formule (taxe extraite d'un prix TTC)

```
tax = total_ttc × 10 / 110
ht = total_ttc × 100 / 110
```

| Total TTC | Tax (PB1) | HT |
|---|---|---|
| `Rp 11.000` | `Rp 1.000` | `Rp 10.000` |
| `Rp 22.000` | `Rp 2.000` | `Rp 20.000` |
| `Rp 100.000` | `Rp 9.091` | `Rp 90.909` |

### Anti-pattern à éviter

```ts
// ❌ Calcul "ajout" de taxe (cas hors taxe)
const tax = subtotal * 0.10
const total = subtotal + tax

// ✅ Calcul "extraction" (taxe incluse)
const tax = total * 10 / 110
const subtotal = total - tax
```

---

## 3. Loyalty — Points + Tiers

### Acquisition de points

**1 point = 1.000 IDR dépensés** (calculé sur `total_amount` après remises, hors arrondi).

```
points_earned = floor(total_amount / 1000)
```

| Total achat | Points gagnés |
|---|---|
| `Rp 999` | `0` |
| `Rp 1.000` | `1` |
| `Rp 12.500` | `12` |
| `Rp 100.000` | `100` |

### Tiers de fidélité

| Tier | Seuil (points cumulés) | Discount auto sur tous achats |
|---|---|---|
| **Bronze** | `0 – 499` | `0 %` |
| **Silver** | `500 – 1 999` | `5 %` |
| **Gold** | `2 000 – 4 999` | `8 %` |
| **Platinum** | `≥ 5 000` | `10 %` |

### RPCs DB

| Fonction | Usage |
|---|---|
| `add_loyalty_points(customer_id, points)` | Trigger ou call manuel après order completion |
| `redeem_loyalty_points(customer_id, points, order_id)` | Conversion points → discount |

> Voir [`04-modules/08-customers-loyalty.md`](../04-modules/08-customers-loyalty.md) et [`08-flows-end-to-end/07-loyalty-earn-redeem.md`](../08-flows-end-to-end/07-loyalty-earn-redeem.md).

---

## 4. Customer pricing modes

Quatre modes de pricing par client :

| Mode | Champ DB / table | Comportement |
|---|---|---|
| **`retail`** | `customers.pricing_mode = 'retail'` | Prix standard `products.price` |
| **`wholesale`** | `customers.pricing_mode = 'wholesale'` | Utilise `products.wholesale_price` (si défini, sinon fallback `price`) |
| **`discount_percentage`** | `customers.pricing_mode + customers.discount_percentage` | Applique `price × (1 - discount/100)` |
| **`custom`** | Table `product_category_prices` jointe via `customers.product_category_id` | Prix par catégorie produit, override `price` |

### Helper DB

```sql
get_customer_product_price(p_product_id uuid, p_category_slug text) RETURNS numeric
```

> Voir [`04-modules/05-products-categories.md`](../04-modules/05-products-categories.md) section "Pricing".

---

## 5. Stock alerts

| Niveau | Seuil par défaut | UI |
|---|---|---|
| **Warning** | `< 10` unités | Badge orange |
| **Critical** | `< 5` unités | Badge rouge + notification dashboard |

Seuils configurables par produit via `products.low_stock_threshold` (override des valeurs globales).

> Voir [`04-modules/06-inventory-stock.md`](../04-modules/06-inventory-stock.md).

---

## 6. Order types

| Type | Signification | Spécificités |
|---|---|---|
| **`dine_in`** | Consommation sur place | Table requise, KDS routing standard |
| **`takeaway`** | À emporter | Pas de table, packaging requis |
| **`delivery`** | Livraison | Adresse + delivery_fee + driver assignment |
| **`b2b`** | Commande grossiste | Client B2B, payment_terms, due_date, delivery_date |

Stocké dans `orders.order_type` (enum DB `order_type`).

---

## 7. Void & Refund — PIN manager obligatoire

| Action | Permission requise | Workflow |
|---|---|---|
| Void d'une order non payée | `sales.void` | Modal PIN manager → confirmation → soft delete + journal |
| Refund partiel ou total | `sales.refund` | Modal PIN manager → sélection items + raison → reverse JE auto |
| Discount > seuil | `sales.discount` | Selon config `pos_config.discount_pin_threshold` |

> Voir [`08-flows-end-to-end/03-void-refund.md`](../08-flows-end-to-end/03-void-refund.md).

---

## 8. Session timeout

| Règle | Valeur |
|---|---|
| Durée par défaut | **30 minutes** d'inactivité |
| Configurable via | Table `pos_config.session_timeout_minutes` |
| Source de vérité | `authStore` + hook `useSessionTimeout` (Sprint 0 C6 unification) |
| Comportement | Logout automatique → redirect login |
| Avertissement | Toast 2 minutes avant expiration |

---

## 9. Accounting standards

| Norme | Application |
|---|---|
| **SAK EMKM** | Standard accounting EMKM (PME) — applicable Breakery par défaut |
| **SAK ETAP** | Standard ETAP (entités sans accountabilité publique) — fallback |
| Méthode | **Double-entry** (partie double, débit = crédit toujours) |
| Période | Exercice fiscal calendaire (1er jan → 31 déc) |
| Devise comptable | IDR uniquement |

### Comptes critiques

| Compte | Libellé |
|---|---|
| **1110** | Cash (caisse) |
| **1120** | Bank (compte bancaire) |
| **1300** | Inventory (stock) |
| **2100** | Accounts Payable (dettes fournisseurs) |
| **2110** | PB1 Collected (taxe collectée) |
| **2143** | PB1 Payable (taxe à payer) |
| **4100** | Sales Revenue (ventes) |
| **5100** | COGS (coût des marchandises vendues) |

### Triggers automatiques

| Trigger | Déclenchement |
|---|---|
| `create_sale_journal_entry()` | `orders.status` → `completed` ou `voided` |
| `create_purchase_journal_entry()` | `purchase_orders.status` → `received` |
| `create_expense_journal_entry()` | `expenses.status` → `approved` (via RPC `approve_expense_with_journal`) |

> Voir [`04-modules/10-accounting-double-entry.md`](../04-modules/10-accounting-double-entry.md), [`03-database/04-triggers.md`](../03-database/04-triggers.md).

---

## 10. Rounding rule canonique

L'arrondi `round_idr` s'applique :

1. **Au total final d'une commande** (avant écriture en DB)
2. **Au montant rendu** dans un payment cash
3. **Aux exports comptables** Excel/PDF

Il **ne s'applique pas** :

- Aux line items individuels (sinon biais cumulatif)
- Aux montants stockés en DB pour les écritures comptables (numeric(12,2) précis)

---

## 11. Liens

- [`02-permission-codes-matrix.md`](./02-permission-codes-matrix.md) — matrice permissions × rôles
- [`../04-modules/00-modules-index.md`](../04-modules/00-modules-index.md) — modules métier
- [`../04-modules/10-accounting-double-entry.md`](../04-modules/10-accounting-double-entry.md) — comptabilité
- [`../08-flows-end-to-end/01-pos-sale-cash.md`](../08-flows-end-to-end/01-pos-sale-cash.md) — flow vente cash
- `CLAUDE.md` racine — section "Business Rules"
