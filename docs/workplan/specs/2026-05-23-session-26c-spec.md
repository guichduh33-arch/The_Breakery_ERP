# Session 26c — Comptable Cockpit (deferred reports — PB1 + AR Aging)

> **Date** : 2026-05-23
> **Branche** : `swarm/session-26c` (stacked sur `swarm/session-26b`)
> **Base** : `swarm/session-26b` @ `d31b711` (PR #33 ouvert vers master)
> **Effort estimé** : ~0.5 j (2 read-only report pages)
> **Migration block** : **aucune migration prévue** — consume existing RPC `calculate_pb1_payable_v1` (S26 _013) + view `view_ar_aging` (S24 _012)

---

## 1. Objectifs

Livrer les **2 pages BO les plus simples** du backlog déféré S26c (PB1 + AR Aging) en consumer pur de RPCs/views existantes. Les 2 autres pages hors scope (BankReconciliationPage + CALK SAK EMKM) restent déférées à une session ultérieure car elles requièrent du backend dédié (table `bank_reconciliations` + EF d'import statement bancaire pour la première, layout-heavy document assembly pour la seconde).

Cette session ferme la moitié rapide du scope S26c. Wave 4 tests complets reste hors scope (couvert par les smoke tests des 2 pages).

---

## 2. Scope (Waves)

### Wave 1 — PB1ManagementPage (~0.25j)

| Item | Détail |
|---|---|
| Route | `/accounting/pb1-management` |
| Permission | `reports.financial.read` (proxy — PB1 est un rapport fiscal) |
| Hook | `usePb1Payable(start, end)` → RPC `calculate_pb1_payable_v1(p_period_start, p_period_end)` |
| Page | Date range picker (default = current month) + carte récapitulative (pb1_output / pb1_payable / tax_rate / tax_regime / note) + bouton "Print" placeholder (window.print). Pas de submit, juste un helper visuel pour assister la déclaration PB1 mensuelle. |
| Tests | `pb1-management.smoke.test.tsx` : renders + RPC call shape + affiche pb1_output formaté. |

**Naming** : la page s'appelle `PB1ManagementPage` (PB1 majuscules) — pas `VATManagementPage` (ancien terme PKP) ni `Pb1Management` (snake-style). Cohérent avec ADR-003 NON-PKP.

### Wave 2 — ARAgingPage (~0.25j)

| Item | Détail |
|---|---|
| Route | `/accounting/ar-aging` |
| Permission | `reports.financial.read` |
| Hook | `useArAging` (SELECT direct `view_ar_aging` ordered by `b2b_company_name`) |
| Page | Table groupée par client (b2b_company_name) avec colonnes bucket (current / 31-60 / 61-90 / 90+) en pivot + total outstanding par client + grand total bottom. Buckets color-coded (current=green, 31-60=amber, 61-90=orange, 90+=red). |
| Tests | `ar-aging.smoke.test.tsx` : renders + pivot pour 1 client avec 2 buckets + grand total. |

### Wave 3 — Wiring routes + sidebar (~5 min)

| Item | Détail |
|---|---|
| Routes | 2 nouvelles routes `/accounting/pb1-management` + `/accounting/ar-aging` gated par `reports.financial.read` |
| Sidebar | 2 nouvelles entries indent:1 sous la section Accounting (entre Trial Balance et Mappings) avec icônes Coins (PB1) et CalendarDays (AR Aging) |

---

## 3. RPCs / views consommées (toutes existantes)

| Source | Signature | Wave |
|---|---|---|
| RPC `calculate_pb1_payable_v1` | `(p_period_start DATE, p_period_end DATE) → JSONB` (S26 _013) | 1 |
| View `view_ar_aging` | `customer_id, b2b_company_name, customer_name, bucket, invoice_count, total_outstanding, min_age_days, max_age_days` (S24 _012) | 2 |

---

## 4. Hors scope (déféré post-S26c)

- **BankReconciliationPage + ReconciliationDetailPage** : requiert nouvelle table `bank_reconciliations` + EF d'import statement bancaire + workflow matching/unmatching. Estimé 2-3j.
- **CALK SAK EMKM page** : document layout-heavy assemblant P&L + BS + notes annexes. Estimé 1-2j.
- **Wave 4 tests complets** : couverture full des 11 pages (couvert partiellement par smoke per-page).
- **Wave 5 docs ref rebase** : `docs/reference/04-modules/10-accounting-double-entry.md` Partie II.

---

## 5. PR

PR stacked sur PR #33 (base `swarm/session-26b`). À mergerer dans l'ordre #33 → #34. GitHub re-base auto le S26c PR sur master une fois #33 mergé.
