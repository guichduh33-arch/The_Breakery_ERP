# Session 26c — INDEX (PB1 Management + AR Aging)

> **Date** : 2026-05-23
> **Branche** : `swarm/session-26c` (stacked sur `swarm/session-26b`)
> **Base** : `swarm/session-26b` @ `d31b711`
> **Spec** : [`docs/workplan/specs/2026-05-23-session-26c-spec.md`](../specs/2026-05-23-session-26c-spec.md)
> **Effort réel** : ~30 min in-thread
> **Status** : 3/3 waves DONE — prêt à merger après PR #33 S26b

---

## 1. Commits

| # | Wave | Description |
|---|---|---|
| 0 | Spec | `426bd6f` — spec S26c |
| 1 | 1+2+3 | (à venir, ce commit) — PB1ManagementPage + ARAgingPage + wiring + INDEX + CLAUDE.md |

---

## 2. Pages livrées (2)

| Page | Route | Permission | Source |
|---|---|---|---|
| PB1ManagementPage | `/accounting/pb1-management` | `reports.financial.read` | RPC `calculate_pb1_payable_v1` (S26 _013) |
| ARAgingPage       | `/accounting/ar-aging`       | `reports.financial.read` | View `view_ar_aging` (S24 _012) |

### PB1ManagementPage
- Date range picker (default = mois courant complet — premier au dernier jour)
- Carte récap : Period + Tax regime (e.g. NON_PKP_BALI_PB1 10.0%) + PB1 output collected (Rp) + PB1 payable to PEMDA Bali (Rp en gold) + note ADR-003
- Bouton Print (window.print) pour assister la déclaration PB1 mensuelle

### ARAgingPage
- Pivot table : 1 ligne par client, 4 colonnes bucket (current / 31-60 / 61-90 / 90+) + total outstanding + invoices count
- Color-coded buckets : current=green, 31-60=amber, 61-90=orange, 90+=red (font-semibold)
- Empty cells affichées '—'
- Footer Total cross-customer

---

## 3. Hooks livrés (2)

| Hook | Description |
|---|---|
| `usePb1Payable(start, end)` | RPC `calculate_pb1_payable_v1(p_period_start, p_period_end)` |
| `useArAging` | SELECT `view_ar_aging` ORDER BY `b2b_company_name` |

---

## 4. Tests

- `pb1-management.smoke.test.tsx` 2/2 PASS — T1 carte récap rendu + format Intl id-ID `325.000` + regime `NON_PKP_BALI_PB1 (10.0%)` ; T2 RPC called avec period args.
- `ar-aging.smoke.test.tsx` 2/2 PASS — T1 pivot 3 rows même customer → 1 ligne avec buckets (200.000 / 750.000 / — / 120.000) + total 1.070.000 ; T2 grand total cross-customer = 1.370.000 (1070+300).

**Sweep accounting complet** : 9 fichiers smoke / **19/19 PASS** (S26b 12 + S26c 4 + S13 mappings 3) via `pnpm --filter @breakery/app-backoffice test accounting`.

---

## 5. Wiring routes + sidebar + tiles

- Routes : 2 nouvelles routes `/accounting/pb1-management` + `/accounting/ar-aging` gated par `reports.financial.read`.
- Sidebar : 2 nouvelles entries indent:1 sous la section Accounting entre Trial Balance et Mappings (Coins → PB1, CalendarDays → AR Aging).
- AccountingIndexPage : +2 tiles (PB1 + AR Aging).

---

## 6. Hors scope (déféré post-S26c)

- **BankReconciliationPage** + ReconciliationDetailPage : requires nouveau backend (table `bank_reconciliations` + EF import statement). Estimé 2-3j.
- **CALK SAK EMKM page** : layout-heavy assembly P&L + BS + notes. Estimé 1-2j.
- **Docs reference rebase** (`docs/reference/04-modules/10-accounting-double-entry.md` Partie II) : non bloquant.

---

## 7. Déviations

| ID | Description | Status |
|---|---|---|
| DEV-S26c-1.A-01 | Permission pour PB1 page = `reports.financial.read` (proxy fiscal report) plutôt que nouvelle perm `accounting.pb1.read`. Évite +1 migration | Acceptable |
| DEV-S26c-2.A-01 | useArAging utilise SELECT direct sur view (pas via RPC). View `view_ar_aging` est SECURITY INVOKER avec RLS auth_read sufficient | Acceptable |
| DEV-S26c-2.A-02 | Bucket color-coding hardcoded dans bucketCellClass switch (pas dans tailwind config) | Informationnel |

---

## 8. PR

**PR stacked sur PR #33** (base `swarm/session-26b`, head `swarm/session-26c`). Order de merge : #33 puis #34. GitHub re-base auto #34 sur master post #33.
