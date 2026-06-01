# Spec — POS refund modal test investigation (C2 timeout) (V1)

- **Date** : 2026-06-01
- **Topic** : `pos-refund-test-investigation`
- **Type** : investigation (déterminer fix vs baseline) — hors cycle session numéroté
- **Branche cible suggérée** : `fix/pos-refund-modal-test` (selon conclusion)
- **Base** : `master` @ `70c5cf1`
- **Effort estimé** : **S-M** (~0.5-1 jour d'investigation ; effort de correction inconnu jusqu'à diagnostic)
- **Status** : draft pour ratification
- **Origine** : audit POS `pos-specialist` 2026-06-01 — finding **P0 « test C2 du refund modal timeout »** (doit être confirmé contre la baseline env-gated avant tout merge)

---

## 1. Contexte — ce qui est cassé (preuve `fichier:ligne`)

Le test smoke `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` (S25) contient deux cas :

- **C1** (`:126-185`) — hook-level : `useRefundOrder` envoie le PIN en header `x-manager-pin` + `x-idempotency-key`, body sans `manager_pin`. **Passe.**
- **C2** (`:195-283`) — modal-level : « retry reuses UUID; close+reopen rotates UUID; both are UUID v4 ». **Timeout à 15s** (selon audit).

Le cas C2 (`:209-282`) pilote `<RefundOrderModal>` via une `<Harness>` qui ouvre/ferme le modal, puis :
1. 1er submit (échoue) → capture l'UUID (`:236-239`).
2. Re-saisie PIN + resubmit → l'UUID doit être identique (sticky retry, `:244-252`).
3. **Close** via le bouton `Close` (`:258`) → attente que le `[role="dialog"]` disparaisse (`:261-263`).
4. **Reopen** via toggle (`:266`) → attente que le contenu remonte (`:269-271`).
5. 3e submit (succès) → l'UUID doit avoir tourné (`:276-281`).

Le test repose lourdement sur **Radix Dialog + Portal sous jsdom** : montage async via `useEffect`, `waitFor` sur l'apparition/disparition du portal (`:231-233`, `:261-263`, `:269-271`). Le timeout survient probablement à l'étape **close→reopen** (étape 3/4) : si le portal Radix ne se démonte/remonte pas proprement sous jsdom (ou si un `waitFor` n'est jamais satisfait), le test attend indéfiniment jusqu'au timeout 15s.

**Note baseline (critique avant tout verdict)** : le CLAUDE.md documente une **baseline pré-existante env-gated** POS (~3 échecs) et BO (~24) — `DEV-S25-2.A-02` : « 13 backoffice test files fail with `Invalid environment variables: VITE_SUPABASE_URL Required` — pre-existing env-gating pattern ». Ce test C2 mocke `@/lib/supabase` (`:31-40`) donc n'est PAS env-gated de la même façon — mais il faut **confirmer** s'il fait partie de la baseline rouge connue ou s'il s'agit d'une **régression** introduite après S25.

---

## 2. Architecture / approche d'investigation proposée

Investigation structurée, **pas de fix à l'aveugle**. Étapes :

### A. Reproduire et isoler
- Lancer le seul fichier : `pnpm --filter @breakery/app-pos test refund-modal-pin-header`. Confirmer : C1 PASS, C2 timeout.
- Lancer C2 seul (`.only`) avec logs/`screen.debug()` aux étapes close (`:258`) et reopen (`:266`) pour voir où le `waitFor` bloque.
- Identifier l'étape exacte du timeout : disparition du dialog (`:261-263`) ou remontage (`:269-271`) ou 3e submit (`:278`).

### B. Pré-existant vs régression
- `git log --oneline -- apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` + `git blame` sur les lignes C2.
- Checkout `master` (S25 merge) et exécuter le test : passait-il alors ? Vérifier contre la baseline documentée (CLAUDE.md DEV-S25-2.A-02 + « ~3 POS échecs env-gated »).
- Vérifier si une dépendance (Radix, testing-library, jsdom, vitest) a bumpé depuis S25 (cf. PR #55/#56/#57 récents, turbo bump 2.9.14 S27c).

### C. Diagnostic Radix Portal + jsdom
Hypothèses à tester :
- Le bouton `Close` (`getByRole('button', { name: /^Close$/i })`, `:258`) ne déclenche pas le démontage attendu (ambiguïté de label : le commentaire `:255-257` note plusieurs boutons « Cancel »).
- `removeChannel`/portal cleanup async non flush sous jsdom → le `[role="dialog"]` reste dans le DOM.
- Le `toggle` (`:266`) re-render mais Radix ne remonte pas le portal (state `open` désynchronisé).
- Fake timers vs real timers / `act()` warnings.

### D. Décider : fix vs documenter baseline
Critères de décision :
- **Si régression** (passait sur master @ S25) → **fix obligatoire** avant tout merge touchant ce périmètre. Corriger le test (sélecteur Close non-ambigu, `waitFor` avec timeout explicite, `findBy*` au lieu de `queryBy*`+`waitFor`, ou ajustement du flux close/reopen) OU corriger un vrai bug du modal s'il y en a un.
- **Si pré-existant et non-régression** (déjà rouge à S25, jamais vert en CI) → **documenter dans la baseline** (CLAUDE.md follow-ups, nouvel ID type `DEV-…`) avec justification, et décider d'un `skip` explicite tracké plutôt qu'un timeout silencieux qui ralentit la suite.
- Dans les deux cas : **ne pas merger** un périmètre refund/order-history sans avoir tranché (exigence P0 de l'audit).

---

## 3. Critères d'acceptation

- [ ] Le timeout C2 est reproduit et l'étape exacte de blocage identifiée.
- [ ] Verdict tranché : **régression** OU **pré-existant baseline** (avec preuve git/exécution sur master).
- [ ] Si régression → C2 PASS de façon déterministe (pas de flake), ou bug modal corrigé.
- [ ] Si pré-existant → entrée baseline documentée (CLAUDE.md) + `it.skip` tracké avec ID + raison, plus de timeout 15s qui pénalise la suite.
- [ ] La suite POS refund ne contient plus de timeout silencieux.
- [ ] `pnpm --filter @breakery/app-pos test order-history` se termine sans timeout.

## 4. Tests attendus

- C1 reste PASS (non touché).
- C2 : soit PASS déterministe (fix), soit `skip` explicite documenté (baseline).
- Si fix du test : exécuter 3-5× pour confirmer l'absence de flake (`waitFor` timeouts déterministes).
- Non-régression : `pnpm --filter @breakery/app-pos test refund` (autres tests refund : `refund-modal-pin-header` C1, et tout autre fichier refund POS).

## 5. Hors scope

- Refonte fonctionnelle du `RefundOrderModal` (sauf si l'investigation révèle un vrai bug de lifecycle UUID/close).
- Audit des autres tests timeout/flaky du projet (sauf si le même pattern Radix Portal + jsdom les touche — à noter alors).
- Migration vers un autre framework de test / harness Radix.
- Le refund-from-BO (déféré S34+ par S33) — c'est le refund POS qui est en cause.

## 6. Risques / dépendances

1. **Bloquant P0** : tant que le verdict n'est pas tranché, aucun merge touchant refund/order-history ne devrait passer (l'audit le qualifie P0). Investigation prioritaire.
2. **Possible vrai bug latent** : si le close→reopen ne rotate pas réellement l'UUID en prod (pas qu'un artefact de test), c'est un bug d'idempotency (un retry post-reopen rejouerait l'ancienne clé). À écarter explicitement pendant l'investigation (lire `RefundOrderModal` `idempotencyKeyRef` lifecycle, cf. S25 DEV-S25-2.A-01).
3. **Dépendance baseline** : la comparaison à `master` dépend de la baseline env-gated documentée (CLAUDE.md DEV-S25-2.A-02, « ~3 POS échecs ») — vérifier que C2 n'y figure pas déjà comme connu-rouge.
4. **jsdom + Radix Portal** : limitation d'environnement potentielle, non un bug applicatif — auquel cas la correction est côté test (sélecteur/`waitFor`), pas côté modal.
