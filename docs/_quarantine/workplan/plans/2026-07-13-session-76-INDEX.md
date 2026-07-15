# Session 76 — INDEX (2026-07-13)

> **Périmètre :** solder l'inventaire ⚫ résiduel (§2.3 de [`../remise-a-plat/00-INDEX.md`](../remise-a-plat/00-INDEX.md)) + publier la **Description v1.3** — critères de sortie n°2, 3 et 5 de la remise à plat.
> **Branche :** `swarm/session-76` (base master `84d42246`). Plan : [`2026-07-13-session-76-plan.md`](2026-07-13-session-76-plan.md).
> **Aucune migration, aucun regen de types** — les 2 RPCs B2B câblés existaient déjà en base. Money-path intouché (pattern-guardian 14/14 PASS, 0 violation).

## Livré

| Tâche | Contenu | Commits |
|---|---|---|
| T1 | Purge `RedeemButton.tsx` (⚫#14) | `6f189bb4` |
| T2 | Purge `useKioskAuth` kds + tablette (⚫#5/#6) — core `lib/kioskAuth.ts` + variante display conservés | `c091b5dc` |
| T3 | ⚫#12 câblé : `useB2bBalanceDrift` + bandeau drift (cache ↔ ledger) sur le B2B Dashboard, gate `b2b.read`, query `enabled` seulement si permission | `78b24fc4` |
| T4 | ⚫#13 câblé : `AdjustB2bBalanceModal` PIN-gated (gate `b2b.balance.adjust`, idempotency-key UUID stable par intention, rotation au succès) monté sur la carte B2B inline d'`InfoTab` + **purge `B2BFieldsSection`** (découverte : composant mort en prod) | `90fb92ed` + `d51a17aa` + `b55b276b` |
| T5 | ⚫#16/#17 re-statués : bandeau « not applied yet » (`templates-not-wired-banner`) sur les 2 pages templates Settings | `0a744264` |
| T6 | Docs remise-à-plat : §2.3 10 lignes soldées + §5 critère 5 annoté + bandeaux S76 sur fiches 04/08/09/16/17/19 | `a7f20a1f` |
| T7 | `00-AMENDEMENTS-V13.md` réconcilié : 90 items annotés append-only contre l'état S59→S76 (31 résolus/recadrés par code) | `f01e25f8` |
| T8 | **`docs/product/DESCRIPTION.md` publié (v1.3)** — 576 lignes, 25 modules + page Orders BO, non-technique, features annulées retirées ; tag `description-v1.3` | `f7e4809f` |

Tests : nouvelles suites `adjust-b2b-balance-modal` 3/3 · `btob-dashboard` 4/4 (dont bandeau drift) · smokes templates 7/7 ; root typecheck 7/7 + build 3/3 verts au closeout.

## Décisions propriétaire (2026-07-13, en session)

1. **Purge des variantes kiosk kds/tablette** (⚫#5/#6) — re-spécifier si un jour KDS/tablette doivent tourner en mode kiosque non-staff.
2. **Templates e-mails/tickets re-statués « À venir »** (⚫#16/#17) — éditeurs conservés, bandeau honnête ; le câblage réel rejoint la Vague 3 (notifications / print-bridge versionné).
3. **Description v1.3 reconstruite depuis les fiches** — le docx v1.2 est introuvable (cf. D-2).
4. **Purge `B2BFieldsSection`** — découverte T4 (composant sans importeur de prod, la fiche client a sa carte B2B inline) ; le bouton « Adjust… » vit sur le vrai chemin (InfoTab).

## Déviations

- **DEV-S76-01** : le plan supposait `B2BFieldsSection` monté par `InfoTab` — faux (carte inline dédiée). Câblage réel sur InfoTab + purge du composant mort (décision propriétaire). Le smoke `B2BFieldsSection.smoke.test.tsx` est parti avec.
- **DEV-S76-02** : `@testing-library/user-event` absent des devDeps BO — les tests du modal utilisent `fireEvent` (convention BO existante, cf. `suppliers-crud.smoke.test.tsx`).
- **DEV-S76-03** : les commandes du plan disaient `@breakery/pos`/`@breakery/backoffice` ; les vrais noms de packages sont `@breakery/app-pos`/`@breakery/app-backoffice`.
- **DEV-S76-04** : T6 a réconcilié (strikethrough) des bullets périmés des fiches 04/08/16/17 au-delà des lignes nommées par le plan — vérifiés exacts en revue.
- **DEV-S76-05** : fix post-revue T4 — le reset des champs (dont le PIN) au reopen du modal manquait vs le miroir `RecordB2bPaymentModal` ; corrigé + test reopen-after-cancel.
- **DEV-S76-06** : 1ᵉʳ run CI de la PR #211 rouge au **lint-ratchet** — 5 erreurs eslint dans le code neuf T3/T4/T5 (`require-await` sur les mocks `rpc` async sans await ×2, `no-floating-promises` sur les 2 `invalidateQueries` d'`onSuccess`, `no-unnecessary-type-assertion` sur le retour du RPC drift) ; fixées `0088a925`, eslint 0 + btob 24/24 + typecheck re-verts. Leçon : les briefs d'implémentation n'imposaient pas de passe `pnpm exec eslint <fichiers>` avant commit — la CI est le seul filet lint (ratchet = fichiers touchés) ; à intégrer aux prochains plans.

## Dettes

- **D-1** : le PIN d'`adjust_b2b_balance_v2` part en **arg RPC** (body PostgREST) — pattern pré-existant S37/S38 ; hérite du finding **F-1 S66** (lockout `_verify_pin_with_lockout` non persisté sur les RPCs PIN-in-arg).
- **D-2** : la v1.3 est une **reconstruction** depuis les sections B des 25 fiches (docx v1.2 indisponible) — la diff v1.2→v1.3 n'est pas auditable mot à mot. Disclosed dans l'« Historique des versions » du document.
- **D-3** : erreurs Postgres brutes affichées par le modal Adjust (`invalid_pin`, `balance_underflow` P0011) — `RecordB2bPaymentModal` mappe en copy friendly ; candidat polish.
- **D-4** : le reset du modal Adjust s'exécute au **reopen**, pas au close — le PIN reste en state React pendant la fermeture (conforme au pattern miroir ; durcissement possible dans `handleClose()`).
- **D-5** : tests des bandeaux templates = présence seule (`findByTestId`), pas d'assertion sur le wording par page.
- **D-6** : gate plafond ardoise inchangé (hors périmètre) ; le bandeau drift ne lit pas `driftQuery.error` — une panne RPC dégrade silencieusement en « pas de bandeau » (pattern hérité de `useB2bDashboard`).
- **D-7** : chemin permission-refusée (`b2b.read` absent) du bandeau drift non testé.
- **D-8 (action utilisateur, héritée S71)** : la Description v1.3 décrit le nightly E2E au présent (framing endossé par la checklist) — mais les **3 secrets repo** (`VITE_SUPABASE_ANON_KEY`, `E2E_PIN_ADMIN`, `E2E_PIN_CASHIER`) restent à poser pour qu'il tourne réellement.

## État remise à plat après S76

Critères de sortie : **n°2 ✅** (plus de tuile/label mensonger — bandeaux honnêtes sur les 2 dernières surfaces) · **n°3 ✅** (Description v1.3 publiée) · **n°4 ✅** (décisions actées, depuis 2026-07-06) · **n°5 ✅** (inventaire ⚫ soldé — #16/#17 re-statués par décision) · **n°1 ⏳** (nightly pgTAP : hors périmètre S76, à re-vérifier).
