# POS refund modal test investigation (C2 timeout) — Investigation Plan (V1)

> **For agentic workers:** REQUIRED SUB-SKILL: invoke `superpowers:writing-plans` to align on structure, then execute task-by-task. This is an **investigation plan**, not a feature build — phases are *reproduce → isolate → decide (fix vs tracked-skip)*. **No blind fix.** Decision criteria are explicit. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Trancher le verdict sur le timeout 15s du cas **C2** de `refund-modal-pin-header.smoke.test.tsx` : est-ce une **régression** (à corriger obligatoirement avant tout merge touchant refund/order-history) ou un **pré-existant baseline** (à documenter + `it.skip` tracké avec ID) ? Au passage, écarter explicitement un éventuel **vrai bug latent** de lifecycle UUID/close du `RefundOrderModal` (idempotency). Ferme le finding P0 « test C2 du refund modal timeout ».

**Architecture (méthode d'investigation, pas de code livré par défaut):** 3 waves séquentielles.
- **Wave 1 — Reproduce & isolate** : confirmer C1 PASS / C2 timeout, localiser l'étape exacte de blocage (close→reopen Radix Portal suspecté).
- **Wave 2 — Pré-existant vs régression + diagnostic Radix/jsdom + écarter bug latent** : git history/blame, exécution sur `master`@S25, bump deps, hypothèses Radix Portal + jsdom, lecture lifecycle `idempotencyKeyRef`.
- **Wave 3 — Decide & land** : appliquer le critère de décision → soit **fix déterministe** (3-5× anti-flake), soit **`it.skip` tracké + baseline doc** ; closeout.

**Tech Stack:** Vitest + @testing-library/react + jsdom + Radix Dialog (`@radix-ui/react-dialog` via `FullScreenModal`). Pas de DB, pas d'EF (tout HTTP/Supabase mocké dans le test).

**Spec:** [`../specs/2026-06-01-pos-refund-test-investigation-spec.md`](../specs/2026-06-01-pos-refund-test-investigation-spec.md)
**Branch:** `fix/pos-refund-modal-test` (à créer depuis `master` @ `70c5cf1` — ne créer que si la conclusion mène à un changement de code/test ; sinon documenter sur `master` ou branche docs).

---

## Code facts vérifiés (avant planification)

- **Test** `apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` :
  - **C1** (`:125-186`) hook-level (`useRefundOrder` header `x-manager-pin` + `x-idempotency-key`, body sans `manager_pin`) — réputé PASS.
  - **C2** (`:195-283`) modal-level via `<Harness>` (`:209-225`) : 1er submit échec → capture UUID (`:238`) ; resubmit → UUID identique (`:252` `expect(retryUuid).toBe(firstUuid)`) ; **Close** via `getByRole('button', { name: /^Close$/i })` (`:258`) → `waitFor` dialog removed (`:261-263`) ; toggle reopen (`:266`) → `waitFor` checkbox remonte (`:269-271`) ; 3e submit succès → UUID tourné (`:281`).
  - Mocks : `sonner` (`:26-29`), `@/lib/supabase` (`:31-40`, mock `auth.getSession` + `supabaseUrl`). **C2 n'est donc PAS env-gated** (`VITE_SUPABASE_URL`) de la même façon que la baseline BO — point à confirmer vs DEV-S25-2.A-02.
- **Modal** `apps/pos/src/features/order-history/components/RefundOrderModal.tsx` :
  - `idempotencyKeyRef = useRef(crypto.randomUUID())` (`:51`) — sticky par re-render.
  - `handlePinSubmit` (`:130`) appelle `onSubmit({..., idempotencyKey: idempotencyKeyRef.current})` (`:146`) puis `handleClose()` en succès (`:148`) ; en échec → `setPinKey(k+1)` (`:150`) **sans rotation** (sticky retry ✅ cohérent avec C2).
  - `handleClose` (`:120-128`) : reset state + `setPinKey(k+1)` + **`idempotencyKeyRef.current = crypto.randomUUID()`** (`:126`) + `onClose()`. → rotation sur close ✅.
  - Bouton Close : **un seul** `<button aria-label="Close">` (X icon, `:175`) appelant `handleClose`. Le footer a un `<Button>Cancel</Button>` (`:258`, label « Cancel », pas « Close »). `NumpadPin` peut exposer un reset/clear. → `getByRole('button',{name:/^Close$/i})` devrait matcher **exactement un** bouton (le X). **Le commentaire du test `:255-257` parlant de « multiple Cancel » concerne les Cancel, pas les Close** — l'ambiguïté Close est probablement un faux suspect ; à confirmer en Wave 2.
- **`FullScreenModal`** `packages/ui/src/components/FullScreenModal.tsx` : `DialogPrimitive.Root` + `Portal` + `Overlay` + `Content` (Radix). **Pas** de `DialogPrimitive.Close` injecté (le modal gère sa propre fermeture via `onOpenChange`/X). Le démontage/remontage du Portal sous jsdom (close→reopen) est le **suspect prioritaire** du timeout.

> **Correction d'imprécision spec** : la spec attribue le timeout à une éventuelle ambiguïté du label « Close » (`:255-257`). La lecture du code montre que le commentaire vise les boutons **Cancel** ; le bouton **Close** (X, `aria-label="Close"`) est unique. Le suspect le plus probable est le **cycle Portal Radix démonte→remonte sous jsdom** (`waitFor` `:261-263` / `:269-271`), pas le sélecteur. À valider en Wave 1/2.

---

## Wave 0 — branche & contexte (BLOQUANT léger)

> 1 subagent. ~10 min.

- [ ] **W0.1** Créer `fix/pos-refund-modal-test` depuis `master` @ `70c5cf1` (ne committer du code que si Wave 3 le requiert ; sinon le verdict baseline peut être documenté sans branche de fix). Committer spec + plan.
- [ ] **W0.2** Relire intégralement le test (C1 + C2) + `RefundOrderModal` + `FullScreenModal` (déjà résumé ci-dessus) pour ancrer les `fichier:ligne` exacts avant repro.

---

## Wave 1 — Reproduce & isolate

> Séquentiel (chaque étape informe la suivante). 1 subagent. Critère : **savoir précisément où ça bloque.**

- [ ] **W1.1 — Reproduire le fichier complet.** `pnpm --filter @breakery/app-pos test refund-modal-pin-header` (run unique). Confirmer : C1 **PASS**, C2 **timeout** (~15s). Noter le timeout exact et le dernier `waitFor` atteint (message d'erreur Vitest : « Timed out in waitFor » + ligne).
- [ ] **W1.2 — Isoler C2 seul.** Ajouter temporairement `.only` sur le `describe`/`it` C2 ; insérer `screen.debug()` (ou `console.log(document.body.innerHTML)`) **juste avant** chaque `waitFor` critique :
  - avant le Close (`:258`) — état du dialog ouvert + UUID retry capturé OK ?
  - après le Close, dans le `waitFor` removal (`:261-263`) — le `[role="dialog"]` part-il du DOM ?
  - après le toggle reopen (`:266`), dans le `waitFor` remount (`:269-271`) — la checkbox revient-elle ?
  - avant le 3e submit (`:276-278`).
- [ ] **W1.3 — Localiser l'étape de timeout.** Conclure laquelle des 3 attentes ne se satisfait jamais :
  - **(a)** dialog never removed (`:261-263`) — Portal Radix ne se démonte pas sous jsdom, OU `handleClose` jamais déclenché (sélecteur Close).
  - **(b)** dialog never remounts (`:269-271`) — state `open` désynchronisé après toggle, OU Portal ne re-mount pas.
  - **(c)** 3e submit jamais à 3 (`:278`) — flux re-drive échoue (state wipe inattendu).
  - Retirer `.only` et `screen.debug()` après diagnostic (ne pas committer de debug).

**Critère de sortie Wave 1 :** étape exacte du blocage identifiée (a/b/c) + hypothèse de cause priorisée.

---

## Wave 2 — Pré-existant vs régression + diagnostic + écarter bug latent

> Phases parallélisables (2.1 git/exec ⟂ 2.2 deps ⟂ 2.3 Radix/jsdom ⟂ 2.4 lifecycle). Idéalement 1-2 subagents (un « historian » 2.1/2.2, un « diagnostician » 2.3/2.4). Convergent sur le verdict.

### 2.1 — Pré-existant vs régression (preuve git/exécution)
- [ ] **W2.1.1** `git log --oneline -- apps/pos/src/features/order-history/__tests__/refund-modal-pin-header.smoke.test.tsx` + `git blame -L 195,283` sur le bloc C2 — qui a écrit/modifié C2, et quand (S25 d'origine ? touché depuis ?).
- [ ] **W2.1.2** Checkout du commit de merge S25 (ou `master` au moment S25) et exécuter `pnpm --filter @breakery/app-pos test refund-modal-pin-header` : **C2 passait-il à S25 ?**
  - Si **vert à S25** → **régression** introduite depuis (suspect : bump deps Wave 2.2).
  - Si **déjà rouge/timeout à S25** → **pré-existant** (jamais vert en CI), cohérent avec baseline « ~3 POS échecs env-gated » — mais C2 n'est PAS env-gated (mocks `:31-40`), donc à classer comme pré-existant **non-env-gated** (nuance à documenter).
- [ ] **W2.1.3** Confronter à la baseline CLAUDE.md : DEV-S25-2.A-02 (« 13 backoffice test files fail VITE_SUPABASE_URL ») vise BO env-gated, **pas** ce POS smoke. Vérifier que C2 ne figure pas déjà comme connu-rouge ailleurs (grep des INDEX/follow-ups S25). Établir le statut exact.

### 2.2 — Bump de dépendances depuis S25
- [ ] **W2.2.1** Comparer les versions de `@radix-ui/react-dialog`, `@testing-library/react`, `jsdom`, `vitest` entre S25 et `master`@`70c5cf1` (`git log -p -- pnpm-lock.yaml` ciblé, ou diff des `package.json`). PRs récentes notées : turbo 2.9.14 (S27c), #55/#56/#57. Un bump majeur Radix/testing-library/jsdom expliquerait une régression de comportement Portal.

### 2.3 — Diagnostic Radix Portal + jsdom (hypothèses, suspect prioritaire)
- [ ] **W2.3.1 — Hypothèse (a) Portal non démonté.** Vérifier si `[role="dialog"]` (rendu par le modal `:166`, PAS par Radix `Content` directement) reste dans le DOM après `handleClose`. Note : le `role="dialog"` est sur le `<div>` interne (`:166`), enfant du `DialogPrimitive.Content` — quand `open=false`, Radix démonte le `Portal` → le div part. Si jsdom ne flush pas l'unmount async, `waitFor` (`:261-263`) timeout. Tester : augmenter le `waitFor` timeout, ou utiliser `findBy*`, ou `await act(async()=>{})` post-click.
- [ ] **W2.3.2 — Hypothèse sélecteur Close (faux suspect probable).** Confirmer par `screen.getAllByRole('button',{name:/^Close$/i})` qu'il n'y a **qu'un** bouton Close. Si >1 → `getByRole` throw (pas timeout) ; donc si timeout (pas throw), le sélecteur n'est pas la cause. Écarter ou confirmer.
- [ ] **W2.3.3 — Hypothèse (b) remount.** Après toggle (`:266`), `open` repasse `true` → Radix re-mount le Portal via `useEffect` (async). Vérifier que le `waitFor` (`:269-271`) couvre le délai ; tester `findByLabelText`.
- [ ] **W2.3.4 — Timers/act.** Vérifier absence de fake timers actifs (le test n'en déclare pas) et warnings `act()` qui masqueraient un état non-flush.

### 2.4 — Écarter le vrai bug latent (idempotency lifecycle)
- [ ] **W2.4.1** Relire `idempotencyKeyRef` lifecycle (`RefundOrderModal:51,126,146`). **Confirmer en lecture de code** (pas seulement via le test) :
  - retry après échec **ne rotate pas** (handlePinSubmit échec → `setPinKey` seulement, `:150`) → sticky ✅.
  - close (X ou Cancel ou onOpenChange false) **rotate** (`handleClose:126`) → fresh UUID au reopen ✅.
  - **Risque réel à écarter (cf. S25 DEV-S25-2.A-01)** : si en prod un retry **après reopen** rejouait l'ancienne clé, ce serait un bug d'idempotency (rejeu d'un refund). La lecture montre que reopen passe par `handleClose` (rotation) → pas de rejeu. **Conclure explicitement** : artefact de test (Radix/jsdom) OU bug applicatif réel. Le verdict attendu (vu le code) = **artefact de test**, mais le documenter noir sur blanc.

**Critère de sortie Wave 2 :** verdict tranché **régression** OU **pré-existant** (avec preuve git + exécution sur master) ; cause Radix/jsdom isolée ; bug latent idempotency **écarté ou confirmé** par lecture de code.

---

## Wave 3 — Decide & land (critère de décision explicite)

> Séquentiel. Le chemin emprunté dépend du verdict Wave 2. 1 subagent + coordinator closeout.

### Critère de décision (appliquer strictement)

| Verdict Wave 2 | Action Wave 3 | Branche/PR |
|---|---|---|
| **Régression** (vert à S25, cassé depuis) | **Fix obligatoire** : corriger le test (sélecteur Close non-ambigu si confirmé, `findBy*` au lieu de `queryBy*`+`waitFor`, `waitFor` timeout explicite, ou ajustement flux close/reopen) OU corriger un vrai bug modal si Wave 2.4 en révèle un. **3-5× run anti-flake.** | `fix/pos-refund-modal-test` → PR |
| **Pré-existant** (déjà rouge à S25, jamais vert CI) | **`it.skip` tracké** avec nouvel ID `DEV-…` + raison (Radix Portal + jsdom limitation env, non un bug applicatif) + **documenter baseline CLAUDE.md follow-ups**. Plus de timeout 15s silencieux. | branche docs/test → PR légère |
| **Bug latent réel** (Wave 2.4 le révèle) | **Fix modal** (lifecycle `idempotencyKeyRef`) + test couvrant le scénario réel. Escalader à l'utilisateur si la sémantique idempotency change. | `fix/pos-refund-modal-test` → PR |

> **Dans TOUS les cas : ne pas merger** un périmètre refund/order-history sans verdict tranché (exigence P0 audit).

### Tâches
- [ ] **W3.1 — Brancher selon le verdict** (un des 3 chemins ci-dessus).
- [ ] **W3.2a (si fix)** Appliquer le correctif minimal de test (préférer `findByRole`/`findByLabelText` avec timeout explicite plutôt que `waitFor`+`queryBy`; cibler le Close unique). **Exécuter C2 5× consécutifs** (`pnpm --filter @breakery/app-pos test refund-modal-pin-header --run` répété, ou `vitest --retry=0` boucle) → **0 flake** requis.
- [ ] **W3.2b (si pré-existant)** Remplacer le `it(...)` C2 par `it.skip(...)` avec un commentaire `// SKIP <DEV-ID>: Radix Portal close/reopen unmount/remount not deterministic under jsdom — pre-existing, not a regression (vert→? à S25 : <preuve>). Lifecycle idempotency verified OK in code (RefundOrderModal:51,126). Re-enable if Radix/jsdom env supports it.` C1 reste actif.
- [ ] **W3.2c (si bug latent)** Fix `RefundOrderModal` + escalade utilisateur si la rotation UUID/sémantique change. (Probabilité faible vu la lecture code.)
- [ ] **W3.3 — Non-régression refund POS.** `pnpm --filter @breakery/app-pos test refund` (C1 + tout autre fichier refund POS) → vert. `pnpm --filter @breakery/app-pos test order-history` → **se termine sans timeout** (critère spec §3).
- [ ] **W3.4 — INDEX** `docs/workplan/plans/2026-06-01-pos-refund-test-investigation-INDEX.md` : summary, verdict (régression/pré-existant/bug + preuve git), étape de blocage (Wave 1.3), cause (Radix/jsdom), action prise (fix/skip), runs anti-flake si fix, bug latent écarté/confirmé, tests run, deviations, acceptance.
- [ ] **W3.5 — CLAUDE.md.** Si **pré-existant→skip** : ajouter l'entrée baseline dans §follow-ups avec l'ID `DEV-…` (raison + preuve). Si **fix** : noter le correctif. Mettre à jour la note baseline « ~3 POS échecs env-gated » pour distinguer C2 (non-env-gated, Radix/jsdom) des env-gated `VITE_SUPABASE_URL`.
- [ ] **W3.6 — PR** selon le chemin. Titre : `fix(pos): refund modal C2 — <deterministic fix | tracked skip> (Radix Portal/jsdom)`. Corps : verdict + preuve + bug latent écarté.

**Critère de sortie Wave 3 :** verdict appliqué ; suite POS refund/order-history sans timeout silencieux ; INDEX + CLAUDE.md à jour ; PR prête.

---

## Acceptance criteria (miroir spec §3)

- [ ] Timeout C2 reproduit + étape exacte de blocage identifiée. *(W1.1-W1.3)*
- [ ] Verdict tranché : **régression** OU **pré-existant baseline** (preuve git/exécution sur master). *(W2.1)*
- [ ] Si régression → C2 PASS déterministe (0 flake sur 3-5 runs) OU bug modal corrigé. *(W3.2a/c)*
- [ ] Si pré-existant → entrée baseline documentée (CLAUDE.md) + `it.skip` tracké (ID + raison), plus de timeout 15s. *(W3.2b, W3.5)*
- [ ] Suite POS refund sans timeout silencieux. *(W3.3)*
- [ ] `pnpm --filter @breakery/app-pos test order-history` se termine sans timeout. *(W3.3)*

---

## Critical patterns à respecter (CLAUDE.md)

- **Pas de fix à l'aveugle** — reproduire et isoler avant toute modification (Wave 1/2 obligatoires avant Wave 3).
- **Baseline pré-existante** — ~3 POS + ~24 BO échecs env-gated (`VITE_SUPABASE_URL`, DEV-S25-2.A-02) ne sont PAS des régressions ; vérifier contre `master` en cas de doute. C2 est un cas distinct (mocks Supabase présents → non-env-gated).
- **Idempotency 2-flavors (S25)** — le `idempotencyKeyRef` du modal = flavor « HTTP retry safety » (UUID v4 dans un `useRef`, propagé header `x-idempotency-key`). Toute modif du lifecycle (rotation close/reopen) touche la sémantique de rejeu — escalader si changement.
- **PIN en header (S25)** — C1 vérifie déjà `x-manager-pin` header (pas body) ; ne pas régresser ce contrat.
- **Pas de debug committé** — retirer `.only`/`screen.debug()`/logs avant PR.
- **Ne pas merger sans verdict** — exigence P0 : aucun merge refund/order-history tant que C2 n'est pas tranché.

---

## Dependencies & risques (miroir spec §6)

1. **Bloquant P0** — aucun merge refund/order-history avant verdict. Investigation prioritaire. *(Wave 3 gate)*
2. **Possible vrai bug latent** — close→reopen doit réellement rotate l'UUID (sinon rejeu d'un refund). Écarté par lecture code en W2.4, à confirmer noir sur blanc. *(W2.4)*
3. **Dépendance baseline** — comparaison à `master`@S25 dépend de la baseline documentée ; vérifier que C2 n'y figure pas déjà comme connu-rouge. *(W2.1.3)*
4. **jsdom + Radix Portal** — limitation d'environnement potentielle (non un bug applicatif) → correction côté test (sélecteur/`waitFor`/`findBy*`), pas côté modal. *(W2.3, W3.2b)*

## Dépendances inter-specs

- **`pos-print-bridge-deploy`** (l'autre P0 du 2026-06-01) : **aucune dépendance fonctionnelle** — périmètres disjoints (order-history refund vs printing). Parallélisable. Lien indirect : les deux exigent une suite `pnpm --filter @breakery/app-pos test` propre avant merge. Si C2 finit en `it.skip` tracké (verdict pré-existant), la suite POS redevient sans-timeout, ce qui **stabilise la validation de non-régression** du plan print-bridge (qui s'appuie sur les 5 smokes S34 + le nouveau smoke URL). Recommandation d'ordonnancement : **trancher C2 en premier** (quick win, débloque la confiance suite POS), puis livrer print-bridge.

---

## Deviations log (à remplir en cours d'exécution)

| ID | Section | Original | What happened | Reason | Risk |
|---|---|---|---|---|---|
| _(à compléter)_ | | | | | |

Candidats anticipés :
- **DEV-RT-W2-01** (informational) — la spec attribuait le timeout à l'ambiguïté du label « Close » ; la lecture code montre un Close unique (le commentaire `:255-257` vise les Cancel). Suspect réel = cycle Portal Radix close/reopen sous jsdom.
- **DEV-RT-W3-01** (selon verdict) — si pré-existant : `it.skip` C2 tracké (Radix Portal/jsdom non-déterministe sous jsdom, non-régression) ; lifecycle idempotency vérifié OK en code.
- **DEV-RT-W3-02** (selon verdict) — si régression : cause = bump deps (Radix/testing-library/jsdom) depuis S25 ; fix côté test.
