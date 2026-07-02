# Session 55 — INDEX (P1.5 / audit T7 : durcissement EF restant)

> Branche `swarm/session-55` · 2026-07-02→03 · Spec : `docs/superpowers/specs/2026-07-02-ef-hardening-p15-design.md` · Plan : `docs/superpowers/plans/2026-07-02-session-55-ef-hardening-p15.md` · Ferme audit **T7** (§4 P1.5 de `docs/workplan/audits/2026-06-27-audit-integral-par-module.md`).

## Périmètre livré

| Chantier | Contenu | Commits |
|---|---|---|
| **T0 Attestation** | Les 2 items « déjà faits » (rate-limit `auth-change-pin`, secret dispatch en header) n'étaient couverts **qu'en repo, pas en live** → redéployés (auth-change-pin v7, notification-dispatch v5) | — (cloud only) |
| **A. Idempotency void/cancel** | `void_order_rpc_v3→v4` (replay via `refunds.idempotency_key`, précédent refund_v2) ; `cancel_order_item_rpc_v2→v3` (+ colonne `order_items.cancel_idempotency_key` + index unique partiel) ; EFs lisent `x-idempotency-key` (helper S25) ; POS clés per-modal (pattern `RefundOrderModal`, hooks `useVoidOrder`/`useCancelOrderItem`/`useVoidServerOrder` + 4 call-sites) + smoke `void-idempotency-header` | b74b5d0, 4adb541, ed0b3f9, 9a2130f, 5caa899 |
| **B. Discount-PIN hors SQL** | Table nonce **`discount_authorizations`** (service-role only, TTL 60 s, single-use) ; **`complete_order_with_payment_v15→v16`** (consommation atomique du nonce à la place de `p_manager_pin`+`_verify_pin_with_lockout` ; DROP v15 ; ⚠️ **GRANT authenticated préservé**) ; EF `process-payment` vérifie le PIN in-EF (`_shared/manager-pin`, bucket SEC-07 partagé, `checkPermissionForRole(sales.discount)`), **dérive `p_discount_authorized_by` du PIN vérifié**, mint le nonce, retire le fallback S38 `record_pin_failure_v1` ; contrat HTTP POS inchangé | 05e6186, b9f50b8, 09ba764, 669043f |
| **Gates** | Types regen (v16/v4/v3/nonce/cancel-key) ; typecheck 6/6 ; build 2/2 ; POS 133/133 (526 pass / 2 skip) ; domain 66/66 (738) ; BO vert | b326edc |

## Migrations (`20260710000082..086`)
- `_082` void_order_rpc_v4_idempotency · `_083` cancel_order_item_rpc_v3_idempotency · `_084` revoke_reversal_v4_v3_from_authenticated · `_085` create_discount_authorizations · `_086` complete_order_v16_discount_auth_nonce.
- Bookkeeping cloud : lignes insérées convention horloge locale ; `_086` appliquée via **runner API-from-file** (voir déviations).

## Tests (tous verts live, cloud V3 dev)
- **Nouvelles suites** : `reversal_idempotency` 5/5 ; `discount_auth_nonce` 6/6 ; refresh `reversal_rpc_revoke` 11/11 (v4/v3 + authenticated).
- **Ancres repointées v16 et re-passées** : order_discount_gate 10/10 (converti nonce), canonical_line_price 13/13, combo_sale 11/11, s44_money_gates 12/12, sale_flag_aware 6/6, loyalty append-only 5/5, modifier_ingredient 24/24, combo_reversal 3/3, s44_display_symmetry 8/8.
- Vérifs privilèges live : v4/v3 `authenticated=false` ; v16 `authenticated=true`, `anon=false`.

## Review finale (whole-branch, opus) : **READY TO MERGE**
« Aucune remise ne s'applique sans nonce valide dérivé du PIN » vérifié sur tous les seams (hasDiscount EF vs v_has_discount RPC, nonce deviné, coercition string, double-void concurrent) — tout est fail-closed. 0 Critical/Important.

## Déviations numérotées
- **DEV-S55-01** — Drift repo↔cloud EF découvert en T0 : `auth-change-pin` live v6 SANS rate-limit et `notification-dispatch` live v4 lisant `?secret=` (l'audit décrivait le live, le repo avait les fixes non déployés). Redéployés depuis le source. *Leçon : après tout fix EF, vérifier la version déployée.*
- **DEV-S55-02** — Le bloc « grants canoniques 3-lignes » du plan (hérité du précédent fautif `_018`) omettait `REVOKE FROM authenticated` → v4/v3 étaient EXECUTE-ables par authenticated (confirmé live). Fix : `_084` + éditions in-place `_082`/`_083` + refresh de `reversal_rpc_revoke.test.sql` (qui référençait encore v3 droppée → erreur dure). Même classe que l'incident `20260709000010`.
- **DEV-S55-03** — Renumérotation : `_084` consommée par le fix DEV-S55-02 → table nonce `_085`, v16 `_086` (plan disait _084/_085).
- **DEV-S55-04** — Trous de sweep trouvés au run live : UUIDs non-hex `55dn` dans discount_auth_nonce + 3 suites pgTAP appelant encore `void_order_rpc_v3` (fix 09ba764).
- **DEV-S55-05** — Smoke C2 void-modal `it.skip` (classe DEV-RT-W3-01 : act() tail 8-30 s+ sous suite complète ; passe 2/2 isolé ; C1 actif ; lifecycle vérifié par review).
- **DEV-S55-06** — `_086` appliquée via script `apply-mig-via-api.ps1` (API Management + token Credential Manager, SQL lu depuis le fichier) — le corps de 38 KB dépassait la taille fiable d'un appel MCP inline. Le même runner exécute les suites pgTAP entières depuis les fichiers (détection : `finish()` vide = pass).

## Follow-ups (backlog, non bloquants — review finale)
1. Purge périodique `discount_authorizations` (croissance non bornée des nonces non consommés).
2. Coercition `hasDiscount` EF (strict number) vs `v_has_discount` v16 (`::numeric`) — fail-closed mais 3 calculs indépendants (POS/EF/RPC) à garder alignés.
3. Retirer le fallback vestigial `body.discount_authorized_by` (champ cosmétique forgeable sans discount).
4. Catch `unique_violation` du void v4 inatteignable en course réelle (le FOR UPDATE sérialise → 422 au 2ᵉ appel simultané ; replay séquentiel OK).
5. (Spec §3) `pay_existing_order_v11` / `fire_counter_order_v4` font confiance à `p_discount_authorized_by` sans PIN (état S44) — hors périmètre T7, candidat backlog.

## UI toujours déférées
DEV-S54-01 (bouton cockpit « Clôture annuelle » + erreur `period_undefined`) ; DEV-S52-03 (liste-factures B2B dans `RecordB2bPaymentModal` + Cancel par facture).
