# Session 38 — Spec : PIN Lockout Hardening + Split-Bill étendu + Suites de tests E2E

- **Date** : 2026-06-11
- **Branche** : `swarm/session-38` (base `master` @ `4b235bd`, post-merge S37 PR #69)
- **Source du scope** : INDEX S37 §9 « Deferred S38+ » — items retenus par l'utilisateur : **SEC-06/07** (lockout PIN après N échecs), **POS-15** (split-bill / split tender étendu), **TEST-05/07** (suites de tests étendues).
- **Zéro nouvelle table.** Aucun changement de schéma (réutilise `user_profiles.failed_login_attempts` + `locked_until` existantes depuis `20260503000001`).

---

## 1. Contexte et constat (recherche pré-spec)

### 1.1 SEC-06/07 — l'état réel du lockout PIN

Le lockout PIN **existe déjà partiellement** :

- `user_profiles.failed_login_attempts INT NOT NULL DEFAULT 0` + `locked_until TIMESTAMPTZ` (migration `20260503000001`).
- L'EF `auth-verify-pin` (`supabase/functions/auth-verify-pin/index.ts:98-116`) compte les échecs : MAX_FAILED = 5, lockout 15 min, reset sur succès, audit `login.failed`, check `locked_until` avant vérification (403 `account_locked`). Rate-limit durable 3/min/IP en amont.
- `reset_user_pin_v1` clear le lockout lors d'un reset admin.

**Le trou (SEC-06)** : les RPCs qui valident un PIN **in-arg** appellent `verify_user_pin(p_user_id, p_pin)` (helper STABLE, pure comparaison bcrypt, `20260503000006_init_helpers.sql:24-37`) qui **ne compte jamais les échecs et ne vérifie jamais `locked_until`**. Un attaquant authentifié (cashier) peut donc brute-forcer un PIN manager **en boucle illimitée** via ces chemins, en contournant totalement le lockout de l'EF de login :

| RPC | Migration | PIN validé |
|---|---|---|
| `sign_zreport_v2` | `20260621000015` | PIN du caller (self) |
| `close_fiscal_period_v1` | `20260603000022` | PIN du caller (self) |
| `create_manual_je_v1` | `20260603000025` | PIN du caller (self) |
| `approve_expense_v3` | `20260601181353` | PIN du caller (self) |
| `complete_order_with_payment_v11` | `20260621000010` | PIN de `p_discount_authorized_by` (manager nommé) |

**Le trou (SEC-07)** : le helper EF `_shared/manager-pin.ts` (`verifyManagerPin`) identifie un manager **par PIN seul** : il itère tous les profils MANAGER/ADMIN/SUPER_ADMIN actifs et teste le PIN contre chacun. Il skippe déjà les comptes lockés (ligne 44) mais **n'incrémente aucun compteur d'échec**. Les EFs consommatrices (`void-order`, `cancel-item`, `refund-order`) ne sont protégées que par le rate-limit IP 10/min — soit ~14 400 essais/jour/IP, suffisant pour balayer un espace de PIN 6 chiffres en quelques semaines depuis le réseau du magasin.

⚠️ **Piège de conception identifié** : sur le chemin `verifyManagerPin` (PIN-only, pas de user_id), compter les échecs **per-manager** lockerait TOUS les managers à chaque PIN faux (le PIN faux échoue contre chaque candidat) — DoS trivial par un employé malveillant. Le comptage de ce chemin doit donc être **per-IP** (bucket durable dédié), pas per-user.

### 1.2 POS-15 — l'état réel du split-bill

Le split-bill **par items existe déjà** (S14, `apps/pos/src/features/payment/split/`) : state machine `payer_count → assign_items → per_payer_method → per_payer_cash`, 2-5 payers, sortie = `Tender[]` (1 tender par payer). Le multi-tender est supporté de bout en bout : `paymentStore.tenders[]` → `useCheckout` (`payments` array) → EF `process-payment` (validation 1..5 + règle SP2 cash-overpay-last-only) → `complete_order_with_payment_v11 p_payments` (boucle d'INSERT `order_payments`, somme = total vérifiée) → trigger JE split par méthode (S26). Idempotency : clé unique par ORDER (pas par tender), replay atomique — sûr.

**Le gap** : pas de mode « parts égales » ni « montants libres ». Pour une table de 3 qui veut juste payer 1/3 chacun, l'assignation item par item est inutilisable en service. C'est le sens de « split tender étendu » du backlog (`docs/workplan/backlog-by-module/03-payments-split.md`).

**Aucun changement DB requis** : les modes equal/custom produisent des `Tender[]` dont la somme = total — exactement ce que v11/v7 acceptent déjà.

### 1.3 TEST-05/07 — définition (l'audit 6-agents était éphémère, pas de texte détaillé)

Définis pour S38 comme : (a) couverture pgTAP/unit/smoke des chantiers SEC-06/07 et POS-15 ci-dessus, et (b) **première suite E2E navigateur** du projet sur le golden path POS (login PIN → panier → split → paiement → SuccessModal), exécutée via Playwright contre le dev server, documentée pour ré-exécution manuelle (pas de gate CI E2E cette session — le dev server requiert secrets + cloud).

---

## 2. SEC-06 — Lockout PIN sur les chemins RPC in-arg

### 2.1 Nouveau helper interne `_verify_pin_with_lockout(p_user_id UUID, p_pin TEXT) RETURNS BOOLEAN`

- `VOLATILE SECURITY DEFINER SET search_path = public, extensions` (il écrit).
- Logique :
  1. Charge `pin_hash, failed_login_attempts, locked_until` du profil (`deleted_at IS NULL`). Profil absent → `RETURN false` (pas d'énumération).
  2. Si `locked_until > now()` → `RAISE EXCEPTION 'account_locked' USING ERRCODE = 'P0004'` (code distinct de P0003 invalid_pin, pour que le front différencie).
  3. Compare bcrypt (`pin_hash = crypt(p_pin, pin_hash)`).
  4. **Échec** : `failed_login_attempts + 1` ; si `>= 5` → `locked_until = now() + interval '15 minutes'` + audit `pin.locked` ; sinon audit `pin.failed` (metadata : `{attempts, source: 'rpc'}`). `RETURN false`.
  5. **Succès** : reset `failed_login_attempts = 0, locked_until = NULL`. `RETURN true`.
- Constantes alignées sur l'EF `auth-verify-pin` (5 / 15 min) — **une seule politique de lockout** pour tout le système.
- REVOKE pair canonique S25 : `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + `ALTER DEFAULT PRIVILEGES` — helper interne appelé uniquement par les RPCs SECURITY DEFINER (même pattern que `_emit_expense_je` S28).
- `verify_user_pin` (STABLE, pur) **est conservé tel quel** : l'EF `auth-verify-pin` continue de l'appeler (elle fait son propre comptage — le basculer sur le helper compterait double), de même que `manager-pin.ts` (cf. §3, comptage per-IP, pas per-user).

### 2.2 Wiring des 5 RPCs PIN-in-arg

`CREATE OR REPLACE` de chacune des 5 RPCs du tableau §1.1 en remplaçant l'appel `verify_user_pin(...)` par `_verify_pin_with_lockout(...)`. **Signatures inchangées** → pas de bump de version (précédent : corrective `_015` S25 sur `refund_order_rpc_v2`). Le comportement ajouté (P0004 si locké, comptage) est un durcissement, pas un changement de contrat.

- Cas `complete_order_with_payment_v11` : le PIN validé est celui de `p_discount_authorized_by` (manager nommé). Le comptage per-user est correct ici (l'attaquant doit nommer sa cible ; un cashier malveillant peut au pire infliger 15 min de lockout à un manager — accepté, audité, et le manager peut toujours opérer via un admin `reset_user_pin_v1`).

### 2.3 Audit

Nouvelles actions `audit_logs` : `pin.failed` (chaque échec via le helper, metadata `{attempts, source}`) et `pin.locked` (passage en lockout). L'EF login conserve ses actions `login.failed` existantes.

---

## 3. SEC-07 — Hardening du chemin manager-PIN EF

### 3.1 `_shared/manager-pin.ts`

- Conserver l'itération + le skip des comptes lockés (déjà en place).
- Sur résultat `no_match`, l'EF appelante doit enregistrer l'échec dans un **bucket durable per-IP dédié** : `checkRateLimitDurable({functionName: 'manager-pin-fail', bucketKey: 'ip:'+ip, maxPerWindow: 5, windowSec: 900})` — consommé **uniquement sur échec** (un PIN correct ne consomme pas le bucket). 5 PIN faux / 15 min / IP → 429.
- Audit `manager_pin.failed` (metadata `{ip, function}`) sur chaque no_match — aujourd'hui ces échecs sont **invisibles** dans l'audit log.
- **Pas de comptage per-manager** sur ce chemin (cf. piège §1.1).

Implémentation : ajouter une fonction `recordManagerPinFailure(ip, functionName)` dans `_shared/manager-pin.ts` (ou étendre `verifyManagerPin` avec un paramètre `{ip, functionName}` qui fait le check-avant + record-après) pour que les 3 EFs ne dupliquent pas la logique.

### 3.2 EFs à redéployer

`void-order`, `cancel-item`, `refund-order` (consommatrices de `verifyManagerPin`) : intégrer le bucket fail + audit, redéployer sur V3 dev via MCP `deploy_edge_function`. `kiosk-issue-jwt` et `auth-verify-pin` inchangées.

---

## 4. POS-15 — Split-bill étendu : modes « parts égales » et « montants libres »

### 4.1 Domain (`@breakery/domain`, IO-free, TDD)

Nouveau module `packages/domain/src/payment/splitModes.ts` :

- `splitEqualAmounts(total: number, count: number): number[]` — N parts arrondies au IDR entier (centaines près si besoin de cohérence caisse : arrondi à l'unité, le **dernier** payer absorbe le reste pour que `sum === total` exactement). Erreurs sur `count < 2 || count > 5` ou `total <= 0`.
- `validateCustomSplit(total: number, amounts: number[]): { ok: true } | { ok: false; reason: 'sum_mismatch' | 'bad_count' | 'nonpositive_amount'; delta?: number }` — somme exacte requise, 2..5 montants, chaque montant > 0.
- Tests unitaires co-localisés `__tests__/` (arrondis, restes, bornes, IDR sans décimales).

### 4.2 POS UI (`apps/pos/src/features/payment/split/`)

- Nouveau step initial **`mode_select`** dans `SplitPaymentFlow` : 3 tuiles — « By items » (flux existant inchangé), « Equal parts », « Custom amounts ».
- **Equal** : `payer_count` → montants calculés via `splitEqualAmounts` → `per_payer_method` (affiche le montant assigné par payer) → `per_payer_cash` si cash. Pas d'`assign_items`.
- **Custom** : `payer_count` → nouveau step `custom_amounts` (numpad par payer, indicateur live `assigned / total / remaining`, bouton « Last payer takes remainder ») → `per_payer_method` → `per_payer_cash`.
- Types : `SplitMode = 'items' | 'equal' | 'custom'` ; `SplitPayer` gagne `assignedAmount?: number` ; `SplitStep` gagne `'mode_select' | 'custom_amounts'`.
- Sortie inchangée : `onComplete(tenders: Tender[])` — la somme des tenders = total post-promo/discount déjà calculé par le terminal. La règle SP2 (cash overpay dernier tender uniquement) s'applique telle quelle.
- **Aucun changement** à `useCheckout`, `process-payment`, RPC v11/v7.

### 4.3 Surfacing du lockout au POS (lien SEC-06)

Les chemins POS qui valident un PIN manager via RPC (checkout avec discount → v11 via EF) doivent mapper la nouvelle erreur `P0004 account_locked` sur un message clair : « Compte manager verrouillé (15 min) — trop de PIN erronés. » — dans `useCheckout` (erreur EF) et `useVerifyManagerPin` (l'EF auth-verify-pin renvoie déjà 403 `account_locked` ; vérifier le mapping existant `permission_missing` ne l'avale pas).

---

## 5. TEST-05/07 — Suites étendues

| Suite | Contenu | Outil |
|---|---|---|
| pgTAP `pin_lockout.test.sql` | T1 helper happy ; T2 5 échecs → locked + P0004 au 6e ; T3 reset on success ; T4 audit rows `pin.failed`/`pin.locked` ; T5 `sign_zreport_v2` PIN faux incrémente le compteur ; T6 RPC avec compte locké → P0004 ; T7 REVOKE helper (anon + authenticated EXECUTE = false) ; T8 non-régression PIN correct sur les 5 RPCs | cloud MCP `execute_sql` BEGIN/ROLLBACK |
| Domain unit `splitModes` | arrondis IDR, reste au dernier payer, sum invariant, bornes 2..5, custom validation | Vitest `@breakery/domain` |
| POS smoke `split-modes` | mode_select render ; equal 3 payers → 3 tenders sum=total ; custom remainder button ; flux items non-régressé | Vitest `@breakery/app-pos` |
| E2E browser | golden path POS : login PIN → produits au panier → Charge → Split → Equal 2 → cash+cash → SuccessModal avec total correct. + échec PIN ×1 au login (message d'erreur affiché) | Playwright MCP contre `pnpm --filter @breakery/app-pos dev`, session interactive (pas de CI) |
| Sweeps | domain / UI / POS / BO complets + `pnpm typecheck` 6/6 | turbo |

---

## 6. Migrations (NAME-block `20260622000010..0xx`)

| # | Nom | Contenu |
|---|---|---|
| `_010` | `create_verify_pin_with_lockout_helper` | helper `_verify_pin_with_lockout` + REVOKE pair inline |
| `_011` | `wire_pin_lockout_sign_zreport_v2` | CREATE OR REPLACE (signature inchangée) |
| `_012` | `wire_pin_lockout_close_fiscal_period_v1` | idem |
| `_013` | `wire_pin_lockout_create_manual_je_v1` | idem |
| `_014` | `wire_pin_lockout_approve_expense_v3` | idem |
| `_015` | `wire_pin_lockout_complete_order_v11` | idem (PIN de `p_discount_authorized_by`) |

Pas de types regen nécessaire (aucun changement de schéma/signature) — vérifier quand même en fin de Wave A. Base à vérifier via `list_migrations` (prior max NAME `20260621000020`).

---

## 7. Hors scope S39+

PAT-01/02 auth BO setSession (session dédiée), POS-16 LAN cart mirror, POS-17 course timing, split par siège (`order_items.seat_number`), ventilation per-payer des promotions (les modes equal/custom opèrent sur le total post-promo — pas besoin), refund split par méthode, F-010..013/019..024, BO-04/08/09/10/15/21, print-bridge deployment, gate CI E2E Playwright, dynamic VAT `useTaxRate`, lockout configurable par rôle (constantes 5/15min hardcodées alignées EF).

---

## 8. Critères d'acceptation

- [ ] SEC-06 — 5 PIN faux via `sign_zreport_v2` → 6e tentative P0004 `account_locked` ; pgTAP 8/8 PASS.
- [ ] SEC-06 — PIN correct sur les 5 RPCs : comportement inchangé (non-régression).
- [ ] SEC-07 — 5 PIN managers faux / 15 min / IP via `void-order` → 429 ; audit `manager_pin.failed` présent ; EFs redéployées.
- [ ] POS-15 — split equal 3 payers : 3 rows `order_payments`, somme = total exact ; split custom : validation somme + remainder ; flux items non-régressé.
- [ ] TEST — pgTAP PASS via cloud MCP ; sweeps domain/UI/POS/BO PASS ; typecheck 6/6 PASS.
- [ ] E2E — golden path browser déroulé et documenté (captures), split equal validé en conditions réelles.
- [ ] pattern-guardian : aucune violation des Critical patterns.
- [ ] INDEX rempli + CLAUDE.md §Active Workplan bumpé.
