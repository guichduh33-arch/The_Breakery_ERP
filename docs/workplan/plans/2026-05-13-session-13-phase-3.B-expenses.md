# Session 13 — Phase 3.B — Expenses module — Sub-plan

> **Status** : in-progress (2026-05-14)
> **Executor** : `coder` (`expenses`)
> **Migration block** : `20260517000120..000122`
> **Complexity** : M (~14-18 h)

## Scope
Deliver Expenses module (#11) end-to-end:

- 3 cloud migrations + Storage bucket setup.
- `create_expense_v1`, `submit_expense_v1`, `approve_expense_v1` (emits JE), `pay_expense_v1`, `reject_expense_v1` RPCs.
- BO feature folder (hooks + components) + 3 pages (List, New, Detail).
- Routes + Sidebar entry.
- pgTAP suite (T_EXP_01..10) + Vitest live cycle test + BO smoke test.

## Prereq verification (DONE)

- ✓ `accounting_mappings.EXPENSE_DEFAULT` → 6190 (Other Operating Expense) already seeded.
- ✗ `EXPENSE_AP` / `EXPENSE_VAT_INPUT` / `EXPENSE_CASH_OUT` NOT seeded — need to add via `apply_migration` (NOT modify 1.A).
- ✓ `journal_entries.reference_type CHECK` includes `'expense'` and `'expense_payment'` (Phase 1.A 000003).
- ✓ JE helpers: `next_journal_entry_number`, `check_fiscal_period_open`, `resolve_mapping_account`, `round_idr`.
- ✓ Permission rows: `expenses.create|read|update|delete|approve` already seeded → need to ADD `expenses.pay` and `expenses.manage` only.
- ✓ Roles MANAGER+ already have create/approve/update/read.
- ✗ Storage bucket `expense-receipts` not yet created.
- ✓ V3 CoA uses 6xxx for OpEx: 6111 Salary, 6112 Rent, 6113 Utilities, 6114 Supplies, 6115 Marketing, 6116 Maintenance, 6190 Other. Other categories (Transport, Insurance, Tax, Bank Fees, Office) → fall back to 6190 unless we extend CoA (NOT in scope of Phase 3.B; keep simple: seed 12 categories with best-fit code; Insurance/Transport/Bank Fees/Tax/Office point at 6190 with a clarifying description).

## Migration plan

| # | File | What |
|---|---|---|
| 120 | `20260517000120_init_expenses.sql` | Tables `expense_categories` + `expenses` ; seed 12 categories ; seq + UNIQUE expense_number ; RLS ; perm inserts (`expenses.pay`, `expenses.manage`) ; role_permissions grants. |
| 121 | `20260517000121_init_storage_bucket_expense_receipts.sql` | Create private bucket `expense-receipts` ; RLS policies on `storage.objects` for SELECT/INSERT/UPDATE/DELETE on path `expenses/{expense_id}/*`. |
| 122 | `20260517000122_create_expense_rpcs.sql` | 5 RPCs ; auto-balanced JE on approve ; idempotency ; SECURITY DEFINER ; perm gate via `has_permission(auth.uid(), 'expenses.X')`. |

### 12 category seed → account_code mapping

| Code | Name | account_code |
|---|---|---|
| UTILITIES | Utilities | 6113 |
| RENT | Rent | 6112 |
| SALARIES | Salaries | 6111 |
| SUPPLIES | Supplies | 6114 |
| MAINTENANCE | Maintenance | 6116 |
| MARKETING | Marketing | 6115 |
| TRANSPORT | Transport | 6190 |
| INSURANCE | Insurance | 6190 |
| TAX | Tax | 6190 |
| BANK_FEES | Bank Fees | 6190 |
| OFFICE | Office | 6190 |
| OTHER | Other | 6190 |

### Mappings added (separate INSERT, not edit 1.A)

| key | account_code | description |
|---|---|---|
| `EXPENSE_AP` | 2141 | Expense on credit -> CR AP |
| `EXPENSE_CASH_OUT` | 1110 | Expense paid cash/transfer/card -> CR Cash |
| `EXPENSE_VAT_INPUT` | 1151 | Expense VAT component -> DR VAT Input |

## RPC signatures

```sql
create_expense_v1(
  p_category_id UUID,
  p_amount DECIMAL,
  p_vat_amount DECIMAL DEFAULT 0,
  p_payment_method TEXT,
  p_description TEXT,
  p_vendor_name TEXT DEFAULT NULL,
  p_expense_date DATE,
  p_receipt_url TEXT DEFAULT NULL,
  p_idempotency_key UUID DEFAULT NULL
) RETURNS UUID  -- new expense id (or existing on replay)

submit_expense_v1(p_expense_id UUID) RETURNS VOID
approve_expense_v1(p_expense_id UUID, p_approval_notes TEXT DEFAULT NULL) RETURNS jsonb
pay_expense_v1(p_expense_id UUID, p_payment_method TEXT) RETURNS jsonb
reject_expense_v1(p_expense_id UUID, p_reason TEXT) RETURNS VOID
```

## JE rules (approve_expense_v1)

- `payment_method = 'credit'`:
  - DR `category.account_id` (amount – vat_amount)  [or `EXPENSE_DEFAULT` if category has no account]
  - DR `EXPENSE_VAT_INPUT` (vat_amount) if vat_amount > 0
  - CR `EXPENSE_AP` (amount) → AP liability
- `payment_method ∈ {cash, transfer, card}`:
  - DR `category.account_id` (amount – vat_amount)
  - DR `EXPENSE_VAT_INPUT` (vat_amount) if vat_amount > 0
  - CR `EXPENSE_CASH_OUT` (amount) → Cash
- Set `expenses.je_id`. `journal_entries.reference_type='expense'`, `.reference_id=expense.id`, `.status='posted'`.
- `pay_expense_v1` (only valid if payment_method was 'credit'):
  - DR `EXPENSE_AP` (amount) / CR `EXPENSE_CASH_OUT` (amount) ; `reference_type='expense_payment'`.

## Tests

- pgTAP T_EXP_01..10:
  1. `expenses` + `expense_categories` exist with correct columns.
  2. 12 categories seeded, each with active account.
  3. `next_expense_number()` generates `EXP-YYYYMMDD-NNNN` monotonic.
  4. RLS SELECT works for auth.
  5. `create_expense_v1` happy path (status='draft').
  6. `submit_expense_v1` draft→submitted.
  7. `approve_expense_v1` cash → JE balanced (DR category / CR Cash).
  8. `approve_expense_v1` credit + VAT → 3-line JE balanced (DR cat + DR VAT / CR AP).
  9. `pay_expense_v1` on credit-approved → 2nd JE balanced.
  10. Idempotency: same idempotency_key replay returns same id.

- Vitest live: create → submit → approve → JE balanced → pay full cycle + permission gate (cashier forbidden).
- BO smoke: ExpenseForm renders with required fields.

## DoD checklist

- [ ] 3 migrations applied via MCP, storage bucket created.
- [ ] Types regen committed.
- [ ] `pnpm typecheck` green.
- [ ] pgTAP + Vitest live + BO smoke pass.
- [ ] Sidebar `Expenses` entry visible (gated by `expenses.read`).
- [ ] Commits with Claude co-author.

## Deviations
See `docs/workplan/refs/2026-05-14-session-13-wave-3-deviations.md` (NEW).

