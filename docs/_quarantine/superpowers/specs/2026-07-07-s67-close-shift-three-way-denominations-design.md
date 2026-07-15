# S67 — Clôture de caisse ②③ : comptage 3 volets + comptage par coupure

> **Date :** 2026-07-07 · **Branche :** `swarm/session-67` · **Source :** fiche 12 remise-à-plat D2.2 (B1.4) + D2.3 (B1.1/B2.5), suite de S66 (D2.1, `close_shift_v4`).
> **Décisions propriétaire (brainstorm 2026-07-07) :** 3 volets **fixes** cash / QRIS / carte, avec **carte = `card` + `edc` fusionnés** (un seul chiffre saisi, le détail par méthode reste dans `totals_by_payment_method` du snapshot Z) ; **aucune JE automatique** sur les écarts QRIS/carte (trace + gardes seulement — un écart non-cash est souvent un décalage de settlement J+1, la correction comptable reste manuelle) ; comptage par coupure à l'**open ET au close**, **opt-in** via `business_config` (défaut OFF) ; signature v5 en **args scalaires** + jsonb pour la grille de coupures.

## 1. Principe

Deux livraisons dans la même session, toutes deux portées par un bump `close_shift_v4 → v5` :

- **D2.2 — comptage en 3 volets.** La clôture rapproche désormais, en plus du cash physique, les totaux **QRIS** et **carte** relevés des terminaux de paiement. L'attendu de chaque volet est calculé serveur (miroir du calcul cash existant : `SUM(order_payments)` des orders `paid` de la session, `method = 'qris'` pour QRIS, `method IN ('card','edc')` pour carte). La variance par volet est persistée, figée dans le snapshot Z, et **alimente les gardes note/PIN existantes** — mais seul l'écart cash continue de générer sa JE (1110 ↔ 4910/5910, inchangée).
- **D2.3 — comptage par coupure.** Quand `business_config.shift_denomination_count_enabled` est ON, la saisie du cash (à l'ouverture **et** au comptage de clôture) passe par une grille de coupures IDR à total automatique. Le serveur exige et vérifie la grille à la clôture (`B2.5 « obligatoire en option »`). Les grilles sont stockées sur `pos_sessions` (`opening_denominations` / `closing_denominations`) et la grille de clôture est figée dans le snapshot Z.

Le **blind count** (LOT 4) est intégralement préservé : aucune valeur attendue n'est visible pendant la saisie des 3 volets ni de la grille ; expected/variance ne se révèlent qu'à l'étape review.

Le **replay idempotent** (session non-open) sort **avant** toutes les gardes, comme en S60/S66 — un replay n'exige ni note, ni PIN, ni grille.

## 2. DB (migrations `_121..124`, cloud V3 via MCP)

1. **`_121`** — colonnes :
   - `business_config` + `shift_denomination_count_enabled BOOLEAN NOT NULL DEFAULT FALSE`.
   - `pos_sessions` + `counted_qris NUMERIC NULL`, `counted_card NUMERIC NULL` (CHECK nommés ≥ 0), `opening_denominations JSONB NULL`, `closing_denominations JSONB NULL` (grille `{"100000": 3, "50000": 1, …}` — clés = valeur faciale en IDR, valeurs = nombre d'unités).
2. **`_122`** — **`close_shift_v4 → v5`** : corps repris du **live** (`pg_get_functiondef`, règle DEV-S57-02), **DROP v4 même migration**, trio S20 (REVOKE PUBLIC + anon, GRANT authenticated). Nouveaux args, tous `DEFAULT NULL` :
   - `p_counted_qris NUMERIC` / `p_counted_card NUMERIC` — **NULL = volet non compté** (méthode désactivée S64, ou rollout progressif) : pas de variance calculée, pas de garde sur ce volet. Valeur < 0 → `counted_method_invalid` (P0001).
   - `p_denominations JSONB` — grille du comptage cash de clôture.
   - **Gardes note/PIN étendues** : le prédicat de chaque garde devient un **OR sur les 3 volets** — pour chaque volet compté, `ABS(variance_volet) >= seuil_abs OR (expected_volet > 0 AND ABS(variance_volet)/expected_volet >= seuil_pct)` (mêmes seuils `business_config` qu'aujourd'hui, pas de seuils par méthode — YAGNI ; skip du pct si expected = 0, miroir du code actuel). Le DETAIL des erreurs `variance_note_required` / `pin_approval_required` **nomme le(s) volet(s) fautif(s)**.
   - **Validation coupures** (ordre : après les checks d'input, avant les gardes) :
     - flag config ON et `p_denominations` NULL → **`denominations_required`** (P0001) ;
     - si fournie (flag ON **ou** OFF — une grille volontaire est toujours vérifiée) : clés ∈ liste canonique IDR (cf. §3) sinon **`invalid_denomination`** (P0001) ; valeurs entières ≥ 0 sinon `invalid_denomination` ; `Σ(coupure × quantité) == p_counted_cash` sinon **`denomination_total_mismatch`** (P0001, DETAIL avec les deux totaux).
   - Persist : `counted_qris`, `counted_card`, `closing_denominations` posés dans l'UPDATE de clôture existant. JE cash **inchangée** ; **aucune JE QRIS/carte**. Metadata `audit_logs` `shift.close` + retour jsonb étendus : `counted_qris/card`, `expected_qris/card`, `variance_qris/card`, `denominations_provided BOOLEAN`.
3. **`_123`** — **`_build_zreport_snapshot` in-place** (corps live, même signature, REVOKE conservés) : + clé `reconciliation` `{cash: {expected, counted, variance}, qris: {…}, card: {…}}` (volet non compté → counted/variance `null`) + clé `denominations` (grille de clôture, `null` si absente). Lu depuis `pos_sessions` — l'UPDATE de clôture précède l'appel au helper dans le corps du RPC, donc les valeurs sont déjà posées. Expected QRIS/carte recalculés dans le helper (mêmes requêtes que le RPC).
4. **`_124`** — settings RPCs : branche `'pos'` de `get_settings_by_category_v1` + case `set_setting_v1` pour `shift_denomination_count_enabled` (validation boolean, audit old/new hérité) — **in-place depuis les corps live** (S66 a modifié ces corps : ne jamais repartir d'un fichier).
5. Types regénérés (`types.generated.ts`) + commit.

## 3. Domain (`packages/domain`, IO-free)

Nouveau `packages/domain/src/cash/denominations.ts` :
- `IDR_DENOMINATIONS: readonly number[]` — liste canonique : 100 000, 50 000, 20 000, 10 000, 5 000, 2 000, 1 000, 500, 200, 100 (billets + pièces courants ; la liste du RPC `_122` est le miroir exact — toute évolution se fait dans les deux).
- `sumDenominations(grid: Record<string, number>): number` + garde de validation (clé connue, quantité entière ≥ 0).
- Tests unitaires co-localisés `__tests__/`.

## 4. POS

- **`CloseShiftModal`** — étape **count** (blind intact) : trois saisies dans l'ordre cash → QRIS → carte.
  - Cash : numpad actuel, **ou `DenominationGrid` si flag ON** (le total auto remplace la saisie libre — non éditable directement).
  - QRIS / carte : inputs numériques dédiés 44 px (`inputMode="numeric"` — le numpad reste réservé au cash) — « total relevé du terminal ». Un volet est **masqué** si sa méthode est désactivée (`useEnabledPaymentMethods` S64 : QRIS masqué si `qris` absent ; carte masquée si `card` ET `edc` absents) → l'arg part à NULL.
  - Étape **review** : tableau par volet (expected / counted / variance colorée par ligne) + **un seul `VarianceWarningBadge` global calé sur le pire volet** (header, place existante) ; gardes note/PIN UI au prédicat étendu (miroir client du OR 3 volets) ; section Manager approval S66 inchangée.
- **`OpenShiftModal`** : flag ON → `DenominationGrid` remplace le montant unique + quick amounts (total auto) ; l'insert direct (`useShift.ts`, RLS `pos.session.open`) porte `opening_denominations`. **Pas d'enforcement serveur à l'open** (pas de RPC d'ouverture — assumé client-only, comme le reste du modal).
- **Nouveau `DenominationGrid`** (`features/shift/components/`) : une ligne par coupure (libellé Rp formaté, stepper −/+ 44 px + saisie directe de la quantité), total `tabular-nums` en pied. Consomme `IDR_DENOMINATIONS`/`sumDenominations` du domain.
- **`useCloseShift`** → `close_shift_v5` (+ `counted_qris`, `counted_card`, `denominations` optionnels) + mapping des nouveaux codes : `denominations_required`, `denomination_total_mismatch`, `invalid_denomination`, `counted_method_invalid`.
- **`useShiftCloseSummary`** : lit déjà `business_config` → + `denominationCountEnabled` propagé à `Pos.tsx` → modals.

## 5. BO + PDF

- **`SettingsGeneralPage`** : + toggle « Denomination count required » (catégorie `pos`, via `_124`), à côté des seuils de variance.
- **Détail Z-report BO** + **template Z de l'EF `generate-zreport-pdf`** : rendent `reconciliation` (3 lignes expected/counted/variance) et la grille `denominations` **quand les clés existent** — rétro-compatibles avec les snapshots antérieurs (clé absente → section omise, aucun crash).

## 6. Tests

- **pgTAP `close_shift_three_way.test.sql`** (live, BEGIN/ROLLBACK, pattern temp-table S-runner) :
  1. args nouveaux NULL + flag OFF → comportement v4 à l'identique (non-régression) ;
  2. counted qris/card fournis → persist + `reconciliation` dans le snapshot + variances dans le retour ;
  3. écart QRIS seul au-dessus du seuil note (cash équilibré) → `variance_note_required` ;
  4. écart carte seul au-dessus du seuil PIN → `pin_approval_required` ;
  5. flag ON sans grille → `denominations_required` ;
  6. grille dont le total ≠ counted_cash → `denomination_total_mismatch` ;
  7. clé de coupure inconnue / quantité non entière → `invalid_denomination` ;
  8. `p_counted_qris < 0` → `counted_method_invalid` ;
  9. happy path flag ON : grille valide → closed + `closing_denominations` + snapshot ;
  10. replay idempotent exempté de toutes les gardes (grille comprise).
- **Repoint v4 → v5** : `close_shift_pin_gate` (11 asserts), `close_shift_note_enforced` (7), `cash_register` (12), Vitest live-RPC `cash-register-close`.
- **Smoke Vitest POS** : CloseShiftModal (3 volets visibles/masqués selon methods, grille si flag, gardes) ; OpenShiftModal (grille si flag) ; unit `DenominationGrid` + domain `denominations`.
- **Money-path v17/v11/fire_v4 non touchée** (close_shift hors money-path) ; ancre `s44_money_gates` 12/12 au closeout.

## 7. Hors périmètre

Rapport « écarts par caissier » BO (D2.4), double signature caissier + manager (B2.3), alerte d'écart pré-clôture (D1.2), passage de relais / fermeture auto (D3.1), dépôt bancaire (D3.2), rétention 10 ans des Z (D3.3), seuils de variance par méthode (YAGNI), JE automatique sur écart non-cash (décision propriétaire : non), enforcement serveur de la grille à l'ouverture (pas de RPC d'open).
