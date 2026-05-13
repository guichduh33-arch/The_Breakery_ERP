# Session 13 — Cascade docs : objectif travail → reference → backlog

> **Date** : 2026-05-13
> **Périmètre** : alignement de la documentation produit (reference + backlog) sur les 16 fichiers `docs/objectif travail/*.md` (vision fonctionnelle canonique).
> **Pré-requis** : commit `181281f` ("docs: unify reference & workplan structure with 4-part module fusion") avait déjà fait la première passe de fusion. Cette session 13 est la **passe 2** suite à dépose d'une version révisée du dossier `objectif travail/`.

---

## 1. Contexte

L'utilisateur a redéposé le dossier `docs/objectif travail/` (untracked) contenant 16 fichiers de specs cibles **fonctionnelles** (le *pourquoi* et le *quoi* métier de chaque module, sans le *comment* technique). Ces fichiers sont la **source de vérité** de la vision produit.

Les fichiers cibles couverts :

```
ACCOUNTING.md       ORDERS.md
B2B.md              POS.md
CASH_REGISTER.md    PRODUCTION.md
CUSTOMER_DISPLAY.md PROMOTIONS_AND_COMBOS.md
CUSTOMERS.md        PURCHASING_AND_SUPPLIERS.md (version révisée)
EXPENSES.md         REPORTS.md
KDS.md              SETTINGS.md
                    TABLET_ORDERING.md
                    USERS_AND_PERMISSIONS.md
```

INVENTORY.md a été retiré du dossier — déjà traité intégralement dans `181281f` et synchronisé à 100% avec `docs/reference/04-modules/06-inventory-stock.md`.

---

## 2. Méthodologie de cascade

Trois niveaux à propager pour chaque module :

```
docs/objectif travail/<MODULE>.md  (source canonique fonctionnelle)
    │
    ▼ (cascade)
docs/reference/04-modules/<NN>-<name>.md  Part I (vue fonctionnelle)
    │
    ▼ (cascade)
docs/workplan/backlog-by-module/<NN>-<name>.md (section "Backlog métier (objectif fonctionnel)")
    │
    ▼ (traçabilité)
docs/workplan/specs/2026-05-13-session-13-docs-cascade-spec.md (ce fichier)
```

### Décisions structurelles validées avec l'utilisateur (en début de session)

1. **Reference gagne sur la réalité technique** : l'objectif est la vision fonctionnelle ; la reference reste exacte sur les détails techniques (codes COA seedés, statuts réels, etc.). Quand `objectif/ACCOUNTING.md` parle de "compte 1110 Cash" et la reference de "compte 1111 Petty Cash" (le code seedé réel), on garde la reference.
2. **Backlog métier en tasks numérotées** : chaque section §N "Ce que le module doit (encore) faire — backlog métier" des fichiers objectif est convertie en tasks `TASK-NN-XXX` dans le backlog file correspondant, en évitant les doublons avec les tasks existantes.
3. **Un seul spec daté global** (ce fichier) couvre les 16 modules — plus léger que 16 specs séparés.

---

## 3. Constat du diff Part I (reference vs objectif)

Le commit `181281f` ayant déjà aligné la Part I de toutes les references 04-modules sur l'objectif initial, le diff de cette passe 2 est **minimal** :

- **Narrative et structure** : identiques ou quasi-identiques (sections 1–17 alignées section par section dans les deux sens).
- **Drift constaté** : les fichiers objectif utilisent souvent des codes COA **idéaux / pré-restructuration** (1110, 4100, 2110…) alors que le COA seedé réel utilise 1111/1112/1113, 4111, 2143 (cf. backlog TASK-10-005 documente ce fait). Conformément à la décision validée, **aucune correction rétroactive de la reference** sur ces codes — c'est l'objectif qui est en retard de réalité.
- **Sections nouvelles dans objectif** : la majorité des fichiers objectif §N "Backlog métier" contiennent des items stratégiques qui n'étaient pas dans la reference Part I. Ceux-ci alimentent directement les backlogs ci-dessous.

**Conclusion** : aucune modification de Part I des references n'a été nécessaire pendant cette passe. La cascade Part I est déjà à jour suite à `181281f`. Le travail réel s'est concentré sur l'enrichissement des backlogs.

---

## 4. Modifications par module — Récap des tasks ajoutées

Tous les ajouts sont marqués `[TODO]` et regroupés sous une nouvelle section `## Backlog métier (objectif fonctionnel)` à la fin de chaque fichier backlog, avant les sections transverses existantes.

| Module | Backlog file | Tasks ajoutées | Items objectif skippés (déjà couverts) |
|---|---|---|---|
| **ACCOUNTING** | `10-accounting-double-entry.md` | TASK-10-014 → TASK-10-022 (9 tasks) | — |
| **B2B** | `09-b2b-wholesale.md` | TASK-09-009 → TASK-09-017 (9 tasks) | Portal client B2B (TASK-09-007) |
| **CASH_REGISTER** | `12-cash-register-shift.md` | TASK-12-008 → TASK-12-012 (5 tasks) | Cash-in/out (12-004), alerte écart (12-001), pause/reprise (12-005), auto-close (12-006) |
| **CUSTOMER_DISPLAY** | `16-display-customer.md` | TASK-16-006 → TASK-16-013 (8 tasks) | Vidéo idle (16-005) |
| **CUSTOMERS** | `08-customers-loyalty.md` | TASK-08-009 → TASK-08-012 (4 tasks) | Expiration (08-002), merge (08-004), birthday (08-005), notifications (08-006) |
| **EXPENSES** | `11-expenses.md` | TASK-11-008 → TASK-11-011 (4 tasks) | Récurrence (11-003), workflow (11-001), OCR (11-004), note de frais (11-006), export comptable (10-018) |
| **KDS** | `04-kds-kitchen.md` | TASK-04-009 → TASK-04-017 (9 tasks) | — |
| **ORDERS** | `02-pos-cart-orders.md` (section "page /orders") | TASK-02-011 → TASK-02-019 (9 tasks) | — |
| **POS** | `02-pos-cart-orders.md` (section "app POS") | TASK-02-020 → TASK-02-027 (8 tasks) | Payment QR display (16-006) |
| **PRODUCTION** | `15-production-recipes.md` | TASK-15-007 → TASK-15-012 (6 tasks) | Sous-recettes (15-001), versioning (15-005), scheduling (15-006) |
| **PROMOTIONS_AND_COMBOS** | `13-promotions-discounts.md` | TASK-13-009 → TASK-13-012 (4 tasks) | Stacking (13-002), effectiveness (13-006), segment client (13-005), A/B (13-007), parrainage (08-010) |
| **PURCHASING_AND_SUPPLIERS** | `07-purchasing-suppliers.md` | TASK-07-009 → TASK-07-014 (6 tasks) | — |
| **REPORTS** | `14-reports-analytics.md` | TASK-14-013 → TASK-14-020 (8 tasks) | Service Speed (04-009), self-approval (09-010), cohort (08-009), promotion effectiveness (13-006) |
| **SETTINGS** | `19-settings-configuration.md` | TASK-19-011 → TASK-19-014 (4 tasks) | Approval workflows (09-009/07-014/11-001), pricing horaire (13-004), multi-tenancy (19-008), export/import (19-004) |
| **TABLET_ORDERING** | `17-tablet-ordering.md` | TASK-17-007 → TASK-17-014 (8 tasks) | Queue offline (17-001/002) |
| **USERS_AND_PERMISSIONS** | `20-users-rbac.md` | TASK-20-010 → TASK-20-016 (7 tasks) | 2FA (20-008), bulk import (20-003) |

**Total ajouté** : **108 nouvelles tasks** réparties sur 14 fichiers backlog (le fichier 02-pos-cart-orders.md reçoit deux sections distinctes Orders + POS).

---

## 5. Patterns transverses identifiés

Plusieurs items stratégiques émergent dans plusieurs modules et créent des dépendances logiques que les tasks référencent explicitement via `**Dépend de**` :

### 5.1 Multi-devise (Accounting → tous les modules)

- TASK-10-019 (Accounting) est le socle.
- TASK-02-027 (POS), TASK-07-011 (Purchasing), TASK-11-009 (Expenses), TASK-19-014 (Settings toggle) en sont des consommateurs.

### 5.2 Approval workflows (transverse B2B / Purchasing / Expenses / Users)

- TASK-09-009 (B2B), TASK-07-014 (Purchasing), TASK-11-001 (Expenses), TASK-20-011 (Users) traitent chacun leur volet.
- TASK-09-010 (anti-self-approval B2B) et TASK-20-010 (escalade privilèges) ajoutent les contrôles.

### 5.3 Notifications / scheduling (transverse Customers / Settings / Reports)

- TASK-08-006 (Notifications pipeline customers) est le socle.
- TASK-19-011 (Notification scheduler) le pilote.
- TASK-14-013 (Unusual transaction patterns) consomme.

### 5.4 Export Accounting (Accounting → B2B → Expenses)

- TASK-10-018 (Accounting export Accurate/MYOB) socle.
- TASK-09-017 (B2B export), TASK-11-XXX expenses référencent.

### 5.5 IA / classification auto (Accounting + Expenses)

- TASK-10-021 (IA classification Accounting) et TASK-11-011 (catégorisation expense IA) partagent le même framework.

### 5.6 Multi-établissement / Consolidation (Accounting + Customers + Settings)

- TASK-10-020 (consolidation multi-entité Accounting) socle.
- TASK-08-011 (multi-établissement Customers) et TASK-19-008 (multi-tenancy Settings) en dépendent.

### 5.7 Basket Analysis (Reports → POS)

- TASK-14-014 (Basket Analysis report) socle data.
- TASK-02-026 (Smart upsell POS) consommateur.

---

## 6. Ce que cette session **n'a pas fait** (par design)

- **Aucune modification du code applicatif** — purement documentaire.
- **Aucune modification de Part I, II ou IV des references 04-modules/** — la fusion `181281f` a déjà fait le travail.
- **Aucune création d'INDEX d'exécution** (plan dans `docs/workplan/plans/`) — ces tasks sont stratégiques et seront re-priorisées avant exécution lors d'une session d'implémentation.
- **Aucun priority sweep** sur les tasks existantes (TASK-XX-001..010) — seules les NEW tasks objectif sont ajoutées en P2/P3 typiquement.
- **Pas de couverture du module Mobile / LAN / Design System / Tests / Deployment** — pas de fichier objectif correspondant déposé. Ces modules (18, 21–25 en référence) restent gouvernés par leurs backlogs existants.

---

## 7. Validation et next steps

### 7.1 Validation par l'utilisateur en début de session

- ✅ Cible de cascade : 3 niveaux (reference + backlog + spec daté).
- ✅ Reference gagne sur la réalité technique.
- ✅ Backlog métier en tasks numérotées par module.
- ✅ Un seul spec daté global.

### 7.2 Suite recommandée

1. **Re-prioriser** chaque task ajoutée (actuellement P2/P3 par défaut) selon la roadmap commerciale Q3/Q4 2026.
2. **Identifier les 5–10 tasks à exécuter en priorité** (probablement les approval workflows TASK-09-009/07-014/11-001 + multi-devise socle TASK-10-019 + budget TASK-10-017).
3. **Créer un INDEX d'exécution** dans `docs/workplan/plans/YYYY-MM-DD-session-N-INDEX.md` quand on attaque l'implémentation.
4. **Garder ce spec en référence** : c'est le snapshot daté de la passe d'alignement docs.

---

## 8. Traçabilité fichiers modifiés

```
docs/workplan/backlog-by-module/02-pos-cart-orders.md     (+18 tasks : Orders + POS)
docs/workplan/backlog-by-module/04-kds-kitchen.md         (+9 tasks)
docs/workplan/backlog-by-module/07-purchasing-suppliers.md (+6 tasks)
docs/workplan/backlog-by-module/08-customers-loyalty.md   (+4 tasks)
docs/workplan/backlog-by-module/09-b2b-wholesale.md       (+9 tasks)
docs/workplan/backlog-by-module/10-accounting-double-entry.md (+9 tasks)
docs/workplan/backlog-by-module/11-expenses.md            (+4 tasks)
docs/workplan/backlog-by-module/12-cash-register-shift.md (+5 tasks)
docs/workplan/backlog-by-module/13-promotions-discounts.md (+4 tasks)
docs/workplan/backlog-by-module/14-reports-analytics.md   (+8 tasks)
docs/workplan/backlog-by-module/15-production-recipes.md  (+6 tasks)
docs/workplan/backlog-by-module/16-display-customer.md    (+8 tasks)
docs/workplan/backlog-by-module/17-tablet-ordering.md     (+8 tasks)
docs/workplan/backlog-by-module/19-settings-configuration.md (+4 tasks)
docs/workplan/backlog-by-module/20-users-rbac.md          (+7 tasks)
docs/workplan/specs/2026-05-13-session-13-docs-cascade-spec.md (ce fichier — création)
```

Le dossier `docs/objectif travail/` reste **untracked** (présent localement mais non commité) — le contenu est considéré comme la source canonique avant fusion, conservé en marge du repo pour les passes futures.

---

## 9. En une phrase

Session 13 a propagé la vision fonctionnelle révisée des 16 modules `objectif travail/` vers les backlogs de la workplan, ajoutant **108 tasks stratégiques** numérotées et tracées vers leur source — sans toucher au code, en respectant que la reference reste autoritative sur les détails techniques et en évitant les doublons avec les ~150 tasks tech-debt existantes.
