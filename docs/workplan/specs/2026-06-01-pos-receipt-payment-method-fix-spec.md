# Spec — POS receipt payment method fix (reçu reflète la vraie méthode) (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-receipt-payment-method-fix`
- **Type** : correctif ciblé post-audit (hors cycle session numéroté)
- **Branche cible suggérée** : `fix/pos-receipt-payment-method`
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **S** (~0.5-1 jour — typage élargi + plumbing props + 1-2 smoke)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P1 « le reçu affiche toujours Cash »**

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

Le reçu client affiche **toujours « cash »** comme mode de paiement, même pour card / QRIS / EDC / transfer / store_credit.

- `apps/pos/src/features/payment/SuccessModal.tsx:58-63` — `buildReceiptPayload` hardcode le champ method :
  ```ts
  payment: {
    method: 'cash',          // ← hardcodé, ligne 59
    amount: props.total,
    cash_received: props.cashReceived,
    change_given: props.changeGiven ?? 0,
  },
  ```
  alors que **la vraie méthode est disponible** dans les props : `SuccessModalProps.paymentMethod: string` (`SuccessModal.tsx:27`). Elle est simplement ignorée par `buildReceiptPayload`.
- Le type de destination interdit toute autre valeur : `apps/pos/src/services/print/printService.ts:60` —
  ```ts
  payment: { method: 'cash'; amount: number; cash_received: number; change_given: number };
  ```
  Le littéral `'cash'` fige le type ; impossible d'y passer `'card'` sans erreur TS. C'est la cause-racine côté type.

Conséquence métier : un reçu fiscal payé en carte/QRIS imprime « Cash », ce qui est faux (et trompeur en cas de contrôle / rapprochement caisse). Finding distinct mais voisin du finding « tiroir-caisse cash-only » (cf. spec `pos-cash-drawer-error-toast`).

### Valeurs réelles de méthode de paiement (vérifié projet)
Les méthodes du projet sont `cash | card | qris | edc | transfer | store_credit` (cf. S30 `get_payments_by_method_v1`, et `ReceiptPayload.payment` consommé via `printService.printReceipt`). `cash_received` / `change_given` n'ont de sens **que** pour `cash` ; pour les autres méthodes, il n'y a pas de monnaie rendue.

---

## 2. Architecture / approche proposée

**Choix 1 — élargir le type `ReceiptPayload.payment.method`** dans `printService.ts:60` de `'cash'` à une union :
```ts
type ReceiptPaymentMethod = 'cash' | 'card' | 'qris' | 'edc' | 'transfer' | 'store_credit';
payment: { method: ReceiptPaymentMethod; amount: number; cash_received?: number; change_given?: number };
```
`cash_received` / `change_given` deviennent **optionnels** (n'ont de sens que pour cash). Garder rétro-compat : les callers cash continuent de les fournir.

**Choix 2 — propager la vraie méthode dans `buildReceiptPayload`** (`SuccessModal.tsx`) : remplacer `method: 'cash'` par `method: props.paymentMethod as ReceiptPaymentMethod`. Le prop `paymentMethod` existe déjà (`SuccessModal.tsx:27`) — vérifier sa valeur réelle au point d'appel (le parent qui rend `<SuccessModal>` après checkout). Pour les méthodes non-cash, omettre `cash_received`/`change_given` (ou les passer à 0 selon ce que le template d'impression attend).

**Choix 3 — split payments** : si une commande a plusieurs tenders (split-pay S10), `paymentMethod` est un scalaire insuffisant. **Décision à ratifier** : V1 affiche la méthode dominante (ou « Split ») ; le détail multi-tender sur reçu est un follow-up. Vérifier au point d'appel comment `paymentMethod` est dérivé pour un split avant de figer.

**Choix 4 — vérifier le point d'appel** : tracer où `<SuccessModal paymentMethod=... />` est rendu (cart/checkout flow) pour confirmer que la valeur passée est bien la méthode sélectionnée par le caissier (pas un défaut codé en dur ailleurs). C'est l'étape de vérif obligatoire avant de figer le plan.

> Le template d'impression réel vit dans le **print-bridge** (hors monorepo, cf. spec `pos-print-bridge-deploy`). On ne livre ici que le **payload correct** côté client ; le rendu fidèle dépend du bridge consommant `payment.method`.

---

## 3. Critères d'acceptation

- [ ] `ReceiptPayload.payment.method` accepte les 6 méthodes du projet (`cash|card|qris|edc|transfer|store_credit`).
- [ ] `buildReceiptPayload` propage `props.paymentMethod` au lieu du littéral `'cash'`.
- [ ] Un paiement card/QRIS produit un payload avec `payment.method` = la vraie méthode.
- [ ] `cash_received`/`change_given` ne sont fournis que pour `cash` (optionnels au type).
- [ ] Le point d'appel `<SuccessModal>` passe la méthode réelle (vérifié).
- [ ] Décision split-pay documentée (méthode dominante vs « Split ») dans le plan.
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

## 4. Tests attendus

- POS smoke `receipt-payment-method.smoke.test.tsx` : rendre `<SuccessModal>` avec `paymentMethod='card'` (mode `VITE_PRINT_MOCK=1`) → vérifier que le payload bufferisé (`getMockPrintBuffer()`) porte `payment.method === 'card'`, et avec `paymentMethod='qris'` → `'qris'`.
- POS smoke : `paymentMethod='cash'` → `payment.method === 'cash'` + `cash_received`/`change_given` présents (non-régression).
- Non-régression : `pnpm --filter @breakery/app-pos test receipt payment`. Vérifier `receipt-targets-cashier.smoke.test.tsx` (S34) reste vert.

## 5. Hors scope

- Détail multi-tender complet sur le reçu (split-pay ligne par ligne) — follow-up.
- Affichage NPWP / PB1 sur reçu (F-023 backlog S35+).
- Implémentation du rendu côté print-bridge (dépendance externe — cf. spec `pos-print-bridge-deploy`).
- Total recalculé client-side dans `buildReceiptPayload` via `calculateTotals` (déjà présent `SuccessModal.tsx:33`) — non touché ici.

## 6. Risques / dépendances

- **Dépendance** : le rendu fidèle du reçu dépend du print-bridge (externe) consommant `payment.method`. En mock, on valide seulement le payload.
- **Risque split-pay** : si `paymentMethod` au point d'appel est mal dérivé pour les splits, on pourrait afficher une méthode trompeuse — d'où la vérif obligatoire du point d'appel (Choix 4) avant le plan.
- Aucune migration DB, aucun changement RPC/EF.
