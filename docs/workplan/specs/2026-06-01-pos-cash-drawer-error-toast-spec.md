# Spec — POS cash drawer error toast (échec d'ouverture tiroir surfacé) (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-cash-drawer-error-toast`
- **Type** : correctif ciblé post-audit (hors cycle session numéroté)
- **Branche cible suggérée** : `fix/pos-cash-drawer-error-toast`
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **S** (~0.25 jour — 1 fichier, 1 smoke)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P1 « échec d'ouverture du tiroir-caisse silencieux »** (déjà noté informationnel dans S34 INDEX §9, ici opérationnel)

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

À la fin du paiement, `SuccessModal` lance l'impression du reçu **et** l'ouverture du tiroir-caisse en parallèle :

- `apps/pos/src/features/payment/SuccessModal.tsx:87-90` :
  ```ts
  useEffect(() => {
    if (!open) return;
    void Promise.all([handlePrint(), openCashDrawer()]);
  }, [open]);
  ```
  `openCashDrawer()` (`apps/pos/src/services/print/printService.ts:146-164`) retourne `{ success: boolean; error?: string }`, mais **son résultat est ignoré** : le `Promise.all` ne lit pas la valeur de retour. Si le tiroir ne s'ouvre pas (bridge injoignable, drawer non câblé, HTTP non-ok), **aucun feedback au caissier** — il croit que le tiroir va s'ouvrir et reste planté devant un tiroir fermé.

Par contraste, l'échec d'impression **est** surfacé : `SuccessModal.tsx:81-83` affiche `toast.warning('Print server unreachable — receipt not printed')`. Le tiroir n'a pas l'équivalent.

C'est exactement l'antidote « échec visible, jamais silencieux » du pattern S34 (Choix 7 de la spec station-printing), appliqué au tiroir.

---

## 2. Architecture / approche proposée

Capturer le résultat de `openCashDrawer()` et afficher un **toast warning** en cas d'échec, **sans bloquer** le flux reçu (le reçu et le tiroir restent indépendants — un échec tiroir ne doit pas empêcher l'impression du reçu ni le passage à la commande suivante).

Remplacer le `Promise.all` qui jette/ignore par un traitement par-résultat :
```ts
useEffect(() => {
  if (!open) return;
  void (async () => {
    const [, drawer] = await Promise.all([handlePrint(), openCashDrawer()]);
    if (!drawer.success) {
      toast.warning('Cash drawer did not open — please open it manually');
    }
  })();
}, [open]);
```
`handlePrint()` continue de gérer son propre toast d'erreur en interne (`SuccessModal.tsx:81-83`) — on ne touche pas à ce comportement. Le tiroir gagne son propre toast indépendant.

**Décision à ratifier (mineure)** : faut-il n'ouvrir le tiroir **que** pour `cash` ? S34 a déjà conditionné l'ouverture au cash côté business (cf. S34 INDEX §9 / spec station-printing Choix 3bis « tiroir conditionnel cash »). Vérifier au point d'appel si `openCashDrawer()` est déjà gated cash avant d'ajouter le toast — sinon un paiement card déclencherait un toast « drawer didn't open » non pertinent. **Étape de vérif obligatoire avant le plan.** Si le gating cash n'existe pas encore, le toast ne doit s'afficher que quand l'ouverture était attendue (méthode cash).

---

## 3. Critères d'acceptation

- [ ] L'échec d'`openCashDrawer()` produit un `toast.warning` lisible par le caissier.
- [ ] L'échec tiroir **ne bloque pas** l'impression du reçu ni la fermeture du modal / new order.
- [ ] Le toast tiroir est distinct du toast d'échec d'impression (deux messages séparés).
- [ ] Le toast ne s'affiche pas pour une méthode où l'ouverture n'était pas attendue (gating cash vérifié / clarifié).
- [ ] `pnpm --filter @breakery/app-pos typecheck` PASS.

## 4. Tests attendus

- POS smoke `cash-drawer-error-toast.smoke.test.tsx` : mocker `openCashDrawer` → `{ success: false, error: 'HTTP 503' }`, rendre `<SuccessModal open paymentMethod='cash' />`, assert `toast.warning` appelé avec le message tiroir ; et le modal reste rendu (pas de crash, reçu non bloqué).
- POS smoke : `openCashDrawer` → `{ success: true }` → **aucun** toast tiroir.
- Non-régression : l'échec d'impression continue d'afficher son propre toast (`receipt not printed`).

## 5. Hors scope

- Réessai automatique d'ouverture du tiroir.
- Bouton « Open drawer » manuel dans le SuccessModal (pourrait être un follow-up UX).
- Implémentation `/drawer/open` côté print-bridge (externe — cf. spec `pos-print-bridge-deploy`).
- Refactor du gating cash de l'ouverture tiroir s'il s'avère absent (à scoper séparément si découvert).

## 6. Risques / dépendances

- **Risque faible** : changement localisé à l'`useEffect` de `SuccessModal`.
- **Dépendance de vérif** : confirmer le gating cash de `openCashDrawer` au point d'appel pour ne pas spammer de faux toasts sur paiement non-cash.
- Aucune migration DB / RPC / EF. Dépend opérationnellement du print-bridge (externe) pour le vrai signal de succès/échec.
