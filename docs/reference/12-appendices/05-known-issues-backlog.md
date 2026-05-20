# 05 — Known issues & backlog

> **Last verified**: 2026-05-03

Cette page **n'est pas la source de vérité** du backlog vivant. Elle pointe vers les documents canoniques et résume les issues prioritaires connues à la date de vérification.

---

## 1. Sources de vérité

| Document | Rôle | Mise à jour |
|---|---|---|
| [`CURRENT_STATE.md`](../../../CURRENT_STATE.md) | **Source vivante** : sprint progress + backlog roulant | À chaque sprint |
| [`docs/audit/`](../../audit/) | **Snapshot 2026-04-09** : 8 rapports d'audit + executive summary + IMPLEMENTATION_PLAN | Figé (audit ponctuel) |
| [`docs/reference/travail/`](../travail/) | **Backlog opérationnel** détaillé par module (objectifs + critères + estimation) | À chaque story |

> **Règle** : ne **pas dupliquer** ici les éléments listés ailleurs. Cette page est un index + résumé prioritisé.

---

## 2. Statut global V2

| Item | État |
|---|---|
| Statut déploiement | ⛔ **Jamais déployée en production**. V2 reste un cahier des charges métier (référence cible pour V3) |
| Hosting cible (si jamais déployé) | Vercel — `https://the-breakery-pos.vercel.app/` (URL réservée, non active) |
| Sentry monitoring | ✅ actif (T1 backlog complet 2026-04-09) |
| Tests | ~1770 tests, 71 fichiers, 9 pré-existants en échec (non régression) |
| ESLint | `--max-warnings 80` (objectif T9 : abaisser) |
| `select('*')` éliminés | ✅ 0 occurrence (Sprint 1 S2 + audit avril) |
| `any` types dans `src/` | ✅ 0 occurrence (Sprint 1 S7) |

---

## 3. Issues prioritaires connues — issues du backlog `CURRENT_STATE.md`

### Features (F)

| # | Item | Priorité estimée | Lien module |
|---|---|---|---|
| F1 | Expiry date tracking | Moyenne | [`04-modules/06-inventory-stock.md`](../04-modules/06-inventory-stock.md) |
| F2 | Batch / lot tracking | Moyenne | idem |
| F5 | Production yield tracking | Moyenne | [`04-modules/15-production-recipes.md`](../04-modules/15-production-recipes.md) |
| F6 | Sub-recipes support | Basse | idem |
| F7 | Cash flow statement | Moyenne | [`04-modules/10-accounting-double-entry.md`](../04-modules/10-accounting-double-entry.md) |

### Indonesian tax compliance (I)

| # | Item | Notes |
|---|---|---|
| I1 | Faktur Pajak generation | Hors PB1 — uniquement si Breakery passe au régime PPN |
| I2 | e-Faktur CSV export | Idem |
| I3 | DJP reporting integration | Idem |

> **Rappel** : V2 utilise PB1 (taxe restaurant) qui n'a **pas** de reporting DJP automatique. Les items I sont en standby tant qu'aucune obligation PPN n'est requise.

### Technical improvements (T)

| # | Item | Statut | Lien |
|---|---|---|---|
| ~~T1~~ | ~~Sentry monitoring~~ | ✅ DONE 2026-04-09 | [`05-integrations/03-sentry-monitoring.md`](../05-integrations/03-sentry-monitoring.md) |
| T2 | Staging environment | À planifier | [`10-deployment-ops/01-vercel-deployment.md`](../10-deployment-ops/01-vercel-deployment.md) |
| T3 | Rate limiting Edge Functions | À planifier | [`07-security/04-edge-function-security.md`](../07-security/04-edge-function-security.md) |
| T4 | Décomposer 7 fichiers > 500 lignes | À planifier | [`11-conventions/02-file-organization.md`](../11-conventions/02-file-organization.md) §1 |
| T5 | Renforcer RLS SELECT avec permission checks | À planifier | [`07-security/02-rls-patterns.md`](../07-security/02-rls-patterns.md) |
| T6 | Image optimization (WebP, srcset) | À planifier | — |
| T7 | Test coverage 60 % → 70 % | Continu | [`09-testing/01-test-strategy.md`](../09-testing/01-test-strategy.md) |
| T8 | ARIA attributes sur data tables | À planifier | [`11-conventions/03-react-patterns.md`](../11-conventions/03-react-patterns.md) §8 |
| T9 | ESLint max-warnings : abaisser de 80 | Continu | `eslint.config.js` |

---

## 4. Audits 2026-04-09 — 8 rapports

L'audit global a produit 8 rapports thématiques + plan d'implémentation. **Tous les fixes P0 ont été appliqués** (voir Sprint "Global Audit & Fixes" dans `CURRENT_STATE.md`).

| Rapport | Lien | Focus | Statut P0 |
|---|---|---|---|
| 00 | [Executive summary](../../audit/00-executive-summary.md) | Vue d'ensemble | — |
| 01 | [Architecture & security audit](../../audit/01-architecture-security-audit.md) | RLS, Edge Fn, CSP/HSTS, secrets | ✅ |
| 02 | [Accounting & business audit](../../audit/02-accounting-business-audit.md) | JE completeness, COA, double-entry | ✅ |
| 03 | [Code quality & schema audit](../../audit/03-code-quality-schema-audit.md) | TS strict, fichiers > 500 lignes, drift schema | 🚧 (T4 reste) |
| 04 | [Reports & testing audit](../../audit/04-reports-testing-audit.md) | 47+ reports, gaps, tests | 🚧 |
| 05 | [UI/UX & design audit](../../audit/05-uiux-design-audit.md) | Cohérence Luxe Dark, a11y | 🚧 |
| 06 | [Documentation audit](../../audit/06-documentation-audit.md) | Doc coverage, drift docs/code | 🚧 (cette refonte `v2-reference/`) |
| 07 | [Product backlog audit](../../audit/07-product-backlog-audit.md) | Hygiène backlog, priorisation | — |
| 08 | [Operations & LAN audit](../../audit/08-operations-lan-audit.md) | LAN hub/client, BroadcastChannel, retry | ✅ |

**Plan d'implémentation** : [`docs/audit/IMPLEMENTATION_PLAN.md`](../../audit/IMPLEMENTATION_PLAN.md).
**UX gap analysis 2026-05-01** : [`docs/audit/ux-gap-analysis-2026-05-01.md`](../../audit/ux-gap-analysis-2026-05-01.md).
**Inventory screenshots V2** : [`docs/audit/v2-screenshots-inventory-2026-05-01.md`](../../audit/v2-screenshots-inventory-2026-05-01.md).

---

## 5. Tests pré-existants en échec — non-régressions

| Fichier | Tests échoués | Cause |
|---|---|---|
| `src/services/__tests__/authService.test.ts` | 9 | Edge Functions auth nécessitent une instance Supabase live (non mockable simplement) |

> Vérifier régulièrement qu'on n'introduit **pas d'autres** échecs : `npx vitest run --reporter=verbose 2>&1 \| grep "FAIL"`. Si seul `authService.test.ts` apparaît → OK. Détail dans [`09-testing/04-known-failures.md`](../09-testing/04-known-failures.md).

---

## 6. V3 reconstruction — readiness backlog accepté

Items issus de l'évaluation `bmad-check-implementation-readiness` (2026-04-24), **acceptés en backlog** non bloquants pour le sprint 0 V3 :

### U-06 — Accessibility debt register

4 gaps a11y acceptés post-P1 (revisite trimestrielle) :

- Voice control non testé (risque faible : apps tactiles opérationnelles)
- Mode high-contrast Windows non explicitement stylé
- Mode left-handed non implémenté (sidebars systématiquement à gauche)
- Tests screen magnifier non effectués

### U-05 — BackOffice mockups coverage

UX V3 : **10 / 12 écrans** mockés pour P1A. Les 2 manquants à identifier avant sprint planning de `epic-016` / `epic-017`. Candidats : `/settings/printing`, `/users/activity-journal`.

### Q-08 — UX cross-links audit

Vérifier que les ancres référencées dans les sections § 11 des epics V3 pointent vers de vrais headings dans `ux-design-specification/`.

---

## 7. Backlog opérationnel par module — `docs/reference/travail/`

Pour les besoins d'implémentation par module, consulter :

```
docs/reference/travail/
├── 00-README.md                    # Format des fiches travail
├── pos/                            # Backlog POS
├── kds/                            # Backlog KDS
├── inventory/                      # Backlog Inventory
├── accounting/                     # Backlog comptable
├── reports/                        # Backlog reports & analytics
├── lan/                            # Backlog LAN devices
├── settings/                       # Backlog settings
└── ...                             # Un dossier par module
```

> 26 fichiers de travail au total. Format : objectifs + critères d'acceptation + estimation pts + dépendances. Voir le README pour la convention.

---

## 8. Process pour ajouter un item au backlog

1. **Story rapide** ou **fix isolé** → ajouter dans la section appropriée de `CURRENT_STATE.md` avec préfixe (F / I / T / U / S / C selon catégorie)
2. **Story BMAD complète** (V3) → suivre pipeline `bmad-create-story` → `bmad-dev-story` → `architect-guard` → `bmad-code-review`
3. **Fix audit P0** → créer entrée dans `docs/audit/IMPLEMENTATION_PLAN.md` + référencer dans `CURRENT_STATE.md`
4. **Item travail opérationnel** → fiche dans `docs/reference/travail/{module}/`

---

## 9. Liens directs

- [`CURRENT_STATE.md`](../../../CURRENT_STATE.md) — **source vivante** sprint + backlog
- [`docs/audit/`](../../audit/) — 8 rapports + plan d'implémentation
- [`docs/reference/travail/`](../travail/) — backlog opérationnel par module
- [`docs/reference/12-appendices/06-cross-reference-with-v3.md`](./06-cross-reference-with-v3.md) — mapping V2 → V3
- [`docs/reference/09-testing/04-known-failures.md`](../09-testing/04-known-failures.md) — tests cassés connus
- `CLAUDE.md` racine — section "Current Backlog"
