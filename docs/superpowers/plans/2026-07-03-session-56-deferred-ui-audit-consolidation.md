# S56 — UI déférées + consolidation audit : plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer DEV-S54-01 (UI clôture annuelle + `period_undefined`), DEV-S52-03 (liste-factures B2B : allocation ciblée + Cancel par facture) et P2.2 reliquat (consolidation audit sur `audit_logs`).

**Architecture:** Trois chantiers indépendants. (A) UI accounting calquée sur `FiscalPeriodModal`/`useCloseFiscalPeriod` + mapping d'erreurs pattern B2B. (B) nouvel onglet Invoices + hook `useB2bInvoices` sur `view_b2b_invoices` ; les 2 hooks mutation existent déjà. (C) réécriture programmatique in-place des 26 writers SQL (2 regex + 1 corps explicite) puis DROP vue+trigger compat.

**Tech Stack:** React 18 + TS + Tailwind + @breakery/ui (BO), React-Query, Supabase cloud V3 dev (`ikcyvlovptebroadgtvd`) via MCP, pgTAP via `execute_sql` BEGIN/ROLLBACK.

**Spec:** `docs/superpowers/specs/2026-07-03-s56-deferred-ui-audit-consolidation-design.md`

## Global Constraints

- DB = cloud V3 dev **`ikcyvlovptebroadgtvd`** uniquement ; JAMAIS `supabase start`/`db reset`/`run_pgtap.sh` (Docker retiré). Migrations via MCP `apply_migration`, pgTAP via `execute_sql` (BEGIN…ROLLBACK, capture temp-table).
- **Les subagents ne peuvent PAS appeler les MCP Supabase** : ils écrivent les fichiers SQL/pgTAP ; le contrôleur applique/exécute/regen.
- Numérotation migrations : NAME-block suivant = **`20260710000087`** (max actuel `_086`).
- Réécritures RPC chantier C = **in-place `CREATE OR REPLACE`** (aucun changement de signature/comportement, précédent `_077`/`_078`) — pas de bump, pas de repointage apps.
- Copy UI en **anglais** (surface BO existante) ; erreurs en bloc `role="alert"` local, pas de toast.
- Imports BO : suffixe `.js` sur les imports relatifs (convention ESM du repo).
- Fichiers < 500 lignes ; conventional commits co-authored `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Après toute migration : regen types → `packages/supabase/src/types.generated.ts` (commit).
- Baseline env-gated (`VITE_SUPABASE_URL Required`, ~24 échecs BO) ≠ régression.

---

### Task 1: `accounting.year.close` (PermissionCode) + hook `useCloseFiscalYear`

**Files:**
- Modify: `packages/supabase/src/rls/permissions.ts:139` (bloc accounting)
- Create: `apps/backoffice/src/features/accounting/hooks/useCloseFiscalYear.ts`
- Test: `apps/backoffice/src/features/accounting/__tests__/close-fiscal-year-classify.test.ts`

**Interfaces:**
- Consumes: RPC `close_fiscal_year_v1(p_fiscal_year: number, p_manager_pin: string)` (types déjà régénérés en S54) ; `FISCAL_PERIODS_KEY` de `./useFiscalPeriods.js`.
- Produces: `useCloseFiscalYear()` (mutation `{fiscalYear: number; managerPin: string}` → `CloseFiscalYearResult`), `CloseFiscalYearError` (`.code: CloseFiscalYearErrorCode`), `classifyCloseFiscalYearError(message): CloseFiscalYearErrorCode` (exporté pour test). Task 2 en dépend.

- [ ] **Step 1.1:** Dans `permissions.ts`, après la ligne `| 'accounting.period.close'` ajouter :
```ts
  // Session 54 — Annual close (seeded by 20260710000079)
  | 'accounting.year.close'
```
- [ ] **Step 1.2:** Écrire le test (imports depuis le hook, il échouera tant que le hook n'existe pas) :
```ts
// apps/backoffice/src/features/accounting/__tests__/close-fiscal-year-classify.test.ts
import { describe, expect, it } from 'vitest';
import { classifyCloseFiscalYearError } from '../hooks/useCloseFiscalYear.js';

describe('classifyCloseFiscalYearError', () => {
  it.each([
    ['fiscal_year_invalid', 'fiscal_year_invalid'],
    ['pin_required', 'pin_required'],
    ['forbidden', 'forbidden'],
    ['invalid_pin', 'invalid_pin'],
    ['fiscal_year_periods_missing: 3 of 12 seeded for 2026', 'periods_missing'],
    ['fiscal_year_periods_open: 2 period(s) of 2026 not closed/locked', 'periods_open'],
    ['year_already_closed: 2026', 'year_already_closed'],
    ['retained_earnings_account_missing: 3200', 'retained_earnings_missing'],
    ['anything else', 'unknown'],
  ])('classifies %s → %s', (message, code) => {
    expect(classifyCloseFiscalYearError(message)).toBe(code);
  });
});
```
- [ ] **Step 1.3:** Run `pnpm --filter @breakery/backoffice test close-fiscal-year-classify` → FAIL (module absent).
- [ ] **Step 1.4:** Écrire le hook :
```ts
// apps/backoffice/src/features/accounting/hooks/useCloseFiscalYear.ts
// Session 56 — DEV-S54-01 : wraps close_fiscal_year_v1 (S54 migration _080).
// Zeroes classes 4/5/6 into 3200 Retained Earnings and seeds the 12 periods
// of year N+1. line_count=0 (no activity) is a SUCCESS with je_id=null.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';
import { FISCAL_PERIODS_KEY } from './useFiscalPeriods.js';

export type CloseFiscalYearErrorCode =
  | 'fiscal_year_invalid'
  | 'pin_required'
  | 'forbidden'
  | 'invalid_pin'
  | 'periods_missing'
  | 'periods_open'
  | 'year_already_closed'
  | 'retained_earnings_missing'
  | 'unknown';

export class CloseFiscalYearError extends Error {
  constructor(public code: CloseFiscalYearErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CloseFiscalYearError';
  }
}

export function classifyCloseFiscalYearError(message: string): CloseFiscalYearErrorCode {
  if (message.includes('fiscal_year_invalid'))                  return 'fiscal_year_invalid';
  if (message.includes('pin_required'))                         return 'pin_required';
  if (message.includes('invalid_pin'))                          return 'invalid_pin';
  if (message.includes('forbidden'))                            return 'forbidden';
  if (message.includes('fiscal_year_periods_missing'))          return 'periods_missing';
  if (message.includes('fiscal_year_periods_open'))             return 'periods_open';
  if (message.includes('year_already_closed'))                  return 'year_already_closed';
  if (message.includes('retained_earnings_account_missing'))    return 'retained_earnings_missing';
  return 'unknown';
}

export interface CloseFiscalYearArgs {
  fiscalYear: number;
  managerPin: string;
}

export interface CloseFiscalYearResult {
  fiscal_year:               number;
  je_id:                     string | null;
  entry_number:              string | null;
  net_result:                number;
  line_count:                number;
  retained_earnings_account: string;
  periods_seeded_next_year:  number;
}

export function useCloseFiscalYear() {
  const qc = useQueryClient();
  return useMutation<CloseFiscalYearResult, CloseFiscalYearError, CloseFiscalYearArgs>({
    mutationFn: async ({ fiscalYear, managerPin }) => {
      const { data, error } = await supabase.rpc('close_fiscal_year_v1', {
        p_fiscal_year: fiscalYear,
        p_manager_pin: managerPin,
      });
      if (error !== null) {
        throw new CloseFiscalYearError(classifyCloseFiscalYearError(error.message), error.message);
      }
      return data as unknown as CloseFiscalYearResult;
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: FISCAL_PERIODS_KEY }),
        qc.invalidateQueries({ queryKey: ['accounting'] }),
      ]);
    },
  });
}
```
- [ ] **Step 1.5:** Run `pnpm --filter @breakery/backoffice test close-fiscal-year-classify` → PASS (9 cas).
- [ ] **Step 1.6:** Commit `feat(accounting): accounting.year.close PermissionCode + useCloseFiscalYear hook (S56 DEV-S54-01)`

---

### Task 2: `AnnualCloseModal` + bouton dans `SettingsAccountingPage`

**Files:**
- Create: `apps/backoffice/src/features/accounting/components/AnnualCloseModal.tsx`
- Modify: `apps/backoffice/src/features/accounting/pages/SettingsAccountingPage.tsx`
- Test: `apps/backoffice/src/features/accounting/__tests__/annual-close-modal.smoke.test.tsx`

**Interfaces:**
- Consumes: `useCloseFiscalYear`, `CloseFiscalYearError`, `CloseFiscalYearResult` (Task 1) ; `useFiscalPeriods` ; primitives `@breakery/ui` (`Button, Input, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter`).
- Produces: `AnnualCloseModal({ onClose }: { onClose: () => void })`.

- [ ] **Step 2.1:** Écrire le composant (structure `FiscalPeriodModal`, 2 steps + vue succès) :
```tsx
// apps/backoffice/src/features/accounting/components/AnnualCloseModal.tsx
// Session 56 — DEV-S54-01 : annual fiscal-year close (close_fiscal_year_v1).
//   Step 1 : year selector (derived from fiscal_periods) + preconditions info
//   Step 2 : PIN entry + irreversible warning
//   Done   : recap (entry number, net result carried to 3200, N+1 seeded)

import { useMemo, useState, type JSX } from 'react';
import {
  Button, Input,
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useFiscalPeriods } from '../hooks/useFiscalPeriods.js';
import {
  useCloseFiscalYear,
  CloseFiscalYearError,
  type CloseFiscalYearResult,
} from '../hooks/useCloseFiscalYear.js';

const ERROR_COPY: Record<string, string> = {
  fiscal_year_invalid:       'Invalid fiscal year.',
  pin_required:              'PIN must be exactly 6 digits.',
  forbidden:                 'You do not have permission to close a fiscal year (needs accounting.year.close).',
  invalid_pin:               'Invalid manager PIN.',
  periods_missing:           'Not all 12 periods of this year exist — seed the fiscal calendar first.',
  periods_open:              'Some periods of this year are still open — close or lock all 12 periods first.',
  year_already_closed:       'This fiscal year is already closed.',
  retained_earnings_missing: 'Retained Earnings account (3200) is missing or inactive.',
  unknown:                   'Something went wrong. Please retry.',
};

export function AnnualCloseModal({ onClose }: { onClose: () => void }): JSX.Element {
  const periods = useFiscalPeriods();
  const closeYear = useCloseFiscalYear();

  const [step, setStep]     = useState<1 | 2>(1);
  const [year, setYear]     = useState<string>('');
  const [pin, setPin]       = useState('');
  const [error, setError]   = useState<string | null>(null);
  const [result, setResult] = useState<CloseFiscalYearResult | null>(null);

  // Distinct years with closed/locked counts (period_start is 'YYYY-MM-DD').
  const yearStats = useMemo(() => {
    const map = new Map<number, { total: number; sealed: number }>();
    for (const p of periods.data ?? []) {
      const y = Number(p.period_start.slice(0, 4));
      const s = map.get(y) ?? { total: 0, sealed: 0 };
      s.total += 1;
      if (p.status === 'closed' || p.status === 'locked') s.sealed += 1;
      map.set(y, s);
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0]);
  }, [periods.data]);

  function handleNext() {
    setError(null);
    if (year === '') { setError('Pick a fiscal year.'); return; }
    setStep(2);
  }

  function handleSubmit() {
    setError(null);
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('PIN must be exactly 6 digits.');
      return;
    }
    closeYear.mutate(
      { fiscalYear: Number(year), managerPin: pin },
      {
        onSuccess: (r) => setResult(r),
        onError:   (e) => setError(
          e instanceof CloseFiscalYearError
            ? (ERROR_COPY[e.code] ?? e.message)
            : ERROR_COPY['unknown'] as string,
        ),
      },
    );
  }

  return (
    <Dialog open={true} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Annual close</DialogTitle>
          <DialogDescription>
            {result !== null ? 'Done' : `Step ${step} of 2`}
          </DialogDescription>
        </DialogHeader>

        {result !== null && (
          <div className="space-y-3" data-testid="ac-modal-success">
            {result.je_id === null ? (
              <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-sm">
                No class 4/5/6 activity in {result.fiscal_year} — nothing to carry
                forward. The {result.periods_seeded_next_year} periods of{' '}
                {result.fiscal_year + 1} were seeded.
              </div>
            ) : (
              <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-sm space-y-1">
                <div>
                  {result.net_result >= 0 ? 'Profit carried forward' : 'Loss carried forward'}{' '}
                  to <span className="font-mono">3200 Retained Earnings</span> :{' '}
                  <span className="font-mono">{formatIdr(Math.abs(result.net_result))}</span>
                </div>
                <div className="text-xs text-text-secondary">
                  Journal entry <span className="font-mono">{result.entry_number}</span>
                  {' • '}{result.periods_seeded_next_year} periods of {result.fiscal_year + 1} seeded
                </div>
              </div>
            )}
          </div>
        )}

        {result === null && step === 1 && (
          <div className="space-y-4">
            <label className="flex flex-col text-sm">
              Fiscal year
              <select
                value={year}
                onChange={(e) => setYear(e.target.value)}
                className="mt-1 rounded-md border border-border-subtle bg-bg-elevated px-3 py-2 text-sm"
                data-testid="ac-modal-year-select"
              >
                <option value="">— select a year —</option>
                {yearStats.map(([y, s]) => (
                  <option key={y} value={String(y)}>
                    {y} ({s.sealed}/{s.total} periods closed or locked)
                  </option>
                ))}
              </select>
            </label>
            <div className="rounded border border-border-subtle bg-bg-overlay px-3 py-2 text-xs space-y-1">
              <div>Preconditions : all 12 periods of the year closed or locked, and no prior annual close.</div>
              <div>Effect : classes 4/5/6 are zeroed into <span className="font-mono">3200 Retained Earnings</span> (JE dated Dec 31) and the 12 periods of the next year are seeded.</div>
            </div>
          </div>
        )}

        {result === null && step === 2 && (
          <div className="space-y-4">
            <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              You are about to <strong>CLOSE fiscal year {year}</strong>. This posts a
              year-close journal entry and cannot be undone via UI.
            </div>
            <label className="flex flex-col text-sm">
              Manager PIN (6 digits)
              <Input
                type="password"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                data-testid="ac-modal-pin"
              />
            </label>
          </div>
        )}

        {error !== null && (
          <div
            role="alert"
            className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red"
            data-testid="ac-modal-error"
          >
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={closeYear.isPending}>
            {result !== null ? 'Close' : 'Cancel'}
          </Button>
          {result === null && step === 1 && (
            <Button onClick={handleNext} data-testid="ac-modal-next">Next →</Button>
          )}
          {result === null && step === 2 && (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={closeYear.isPending}>
                ← Back
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={closeYear.isPending}
                data-testid="ac-modal-submit"
              >
                {closeYear.isPending ? 'Closing…' : 'Confirm annual close'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```
- [ ] **Step 2.2:** Dans `SettingsAccountingPage.tsx` :
  - Import : `import { CalendarCheck } from 'lucide-react';` (ajouter à la ligne d'import lucide existante `Lock, ChevronRight`) et `import { AnnualCloseModal } from '../components/AnnualCloseModal.js';`
  - Après `const canClose = …` (L20) ajouter :
```ts
  const canCloseYear = useAuthStore((s) => s.hasPermission('accounting.year.close'));
  const [showAnnual, setShowAnnual] = useState(false);
```
  - Dans le header (bloc `{canClose && (…)}` L40-49), envelopper les deux boutons dans un fragment et ajouter après le bouton « Close a period » :
```tsx
        {canCloseYear && (
          <Button
            variant="secondary"
            onClick={() => setShowAnnual(true)}
            className="inline-flex items-center gap-2"
            data-testid="ac-open-btn"
          >
            <CalendarCheck className="h-4 w-4" aria-hidden />
            Annual close
          </Button>
        )}
```
    (les deux boutons vivent dans le même `<div className="flex items-center gap-2">` ajouté autour.)
  - Avant la fermeture du composant, à côté du `{showAll && …}` :
```tsx
      {showAnnual && <AnnualCloseModal onClose={() => setShowAnnual(false)} />}
```
- [ ] **Step 2.3:** Écrire le smoke test (miroir des smokes accounting existants — mock `@/lib/supabase.js` et `authStore`) : (a) avec `hasPermission('accounting.year.close')=true` le bouton `ac-open-btn` est rendu et ouvre le modal (year-select visible) ; (b) avec `false` le bouton est absent ; (c) step 2 avec PIN `123456` mocké en erreur `year_already_closed: 2026` affiche le libellé `This fiscal year is already closed.` dans `ac-modal-error`.
- [ ] **Step 2.4:** Run `pnpm --filter @breakery/backoffice test annual-close` → PASS ; `pnpm --filter @breakery/backoffice test accounting` → pas de régression hors baseline env-gated.
- [ ] **Step 2.5:** Commit `feat(accounting): AnnualCloseModal + Annual close button in SettingsAccountingPage (S56 DEV-S54-01)`

---

### Task 3: `period_undefined` — libellé JE manuelle + fix classify des 3 hooks B2B

**Files:**
- Modify: `apps/backoffice/src/features/accounting/components/CreateManualJEModal.tsx:122`
- Modify: `apps/backoffice/src/features/btob/hooks/useRecordB2bPayment.ts:58-67`
- Modify: `apps/backoffice/src/features/btob/hooks/useCancelB2bOrder.ts:47-57`
- Modify: `apps/backoffice/src/features/btob/hooks/useCreateB2bOrder.ts:76-90`
- Test: `apps/backoffice/src/features/btob/__tests__/period-undefined-classify.test.ts`

**Interfaces:**
- Consumes: message serveur exact `period_undefined: no fiscal period covers <date>` (P0004, migration `_077`).
- Produces: les 3 `classify` deviennent exportés (`export function classify…`) et reconnaissent `period_undefined` ; `CreateManualJEModal` affiche un libellé dédié.

- [ ] **Step 3.1:** Écrire le test :
```ts
// apps/backoffice/src/features/btob/__tests__/period-undefined-classify.test.ts
import { describe, expect, it } from 'vitest';
import { classify as classifyPayment } from '../hooks/useRecordB2bPayment.js';
import { classify as classifyCancel } from '../hooks/useCancelB2bOrder.js';
import { classify as classifyOrder } from '../hooks/useCreateB2bOrder.js';

const MSG = 'period_undefined: no fiscal period covers 2027-01-05';

describe('period_undefined classification (S54 fail-closed guard)', () => {
  it('useRecordB2bPayment', () => expect(classifyPayment(MSG)).toBe('fiscal_period_closed'));
  it('useCancelB2bOrder',    () => expect(classifyCancel(MSG)).toBe('fiscal_period_closed'));
  it('useCreateB2bOrder',    () => expect(classifyOrder(MSG)).toBe('fiscal_period_closed'));
});
```
- [ ] **Step 3.2:** Run → FAIL (`classify` non exporté + retombe en `unknown`).
- [ ] **Step 3.3:** Dans CHACUN des 3 hooks : (a) `function classify(` → `export function classify(` ; (b) remplacer la ligne `if (message.includes('fiscal_period'))           return 'fiscal_period_closed';` par :
```ts
  if (message.includes('fiscal_period'))           return 'fiscal_period_closed';
  // S54 fail-closed guard: 'period_undefined: no fiscal period covers <date>'
  if (message.includes('period_undefined') || message.includes('no fiscal period')) {
    return 'fiscal_period_closed';
  }
```
- [ ] **Step 3.4:** Dans `CreateManualJEModal.tsx`, remplacer `onError:   (e) => setError(e.message),` (L122) par :
```ts
        onError:   (e) => setError(
          e.message.includes('period_undefined')
            ? 'No fiscal period covers this date — run the annual close to seed the next year.'
            : e.message,
        ),
```
- [ ] **Step 3.5:** Run `pnpm --filter @breakery/backoffice test period-undefined-classify` → PASS (3) ; `pnpm --filter @breakery/backoffice test b2b` → pas de régression.
- [ ] **Step 3.6:** Commit `fix(backoffice): classify period_undefined as fiscal_period_closed + manual-JE label (S56 DEV-S54-01)`

---

### Task 4: hook `useB2bInvoices` (lecture `view_b2b_invoices`)

**Files:**
- Create: `apps/backoffice/src/features/btob/hooks/useB2bInvoices.ts`

**Interfaces:**
- Consumes: vue `view_b2b_invoices` (S52 `_070`) — colonnes `invoice_id, order_number, customer_id, b2b_company_name, customer_name, invoice_total, invoice_date, paid_at, order_status, age_days, is_unpaid, amount_paid, outstanding`.
- Produces: `useB2bInvoices(customerId?: string, unpaidOnly?: boolean, enabled?: boolean)` → `B2bInvoiceRow[]` ; `B2B_INVOICES_QUERY_KEY = ['b2b-invoices']` (préfixe déjà invalidé par `useCancelB2bOrder:76`). Tasks 5 et 6 en dépendent.

- [ ] **Step 4.1:** Écrire le hook :
```ts
// apps/backoffice/src/features/btob/hooks/useB2bInvoices.ts
// Session 56 — DEV-S52-03 : per-invoice list from view_b2b_invoices (S52 _070).
// outstanding = invoice_total − Σ b2b_payment_allocations.amount_applied.
// Ordered oldest-first to match the server-side FIFO allocation order.

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase.js';

export interface B2bInvoiceRow {
  invoice_id:       string;
  order_number:     string;
  customer_id:      string;
  b2b_company_name: string | null;
  customer_name:    string | null;
  invoice_total:    number;
  invoice_date:     string;
  paid_at:          string | null;
  order_status:     string;
  age_days:         number;
  is_unpaid:        boolean;
  amount_paid:      number;
  outstanding:      number;
}

export const B2B_INVOICES_QUERY_KEY = ['b2b-invoices'] as const;

export function useB2bInvoices(customerId?: string, unpaidOnly = false, enabled = true) {
  return useQuery<B2bInvoiceRow[]>({
    queryKey: [...B2B_INVOICES_QUERY_KEY, customerId ?? 'all', unpaidOnly],
    staleTime: 15_000,
    enabled,
    queryFn: async () => {
      let q = supabase
        .from('view_b2b_invoices')
        .select('invoice_id, order_number, customer_id, b2b_company_name, customer_name, invoice_total, invoice_date, paid_at, order_status, age_days, is_unpaid, amount_paid, outstanding')
        .order('invoice_date', { ascending: true })
        .limit(500);
      if (customerId !== undefined && customerId !== '') q = q.eq('customer_id', customerId);
      if (unpaidOnly) q = q.gt('outstanding', 0);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as B2bInvoiceRow[];
    },
  });
}
```
- [ ] **Step 4.2:** `pnpm --filter @breakery/backoffice typecheck` → 0 erreur (la vue est dans `types.generated.ts` depuis S52).
- [ ] **Step 4.3:** Commit `feat(b2b): useB2bInvoices hook over view_b2b_invoices (S56 DEV-S52-03)`

---

### Task 5: `RecordB2bPaymentModal` — sélection de factures + récap allocations

**Files:**
- Modify: `apps/backoffice/src/features/btob/components/RecordB2bPaymentModal.tsx`
- Modify: `apps/backoffice/src/features/btob/hooks/useRecordB2bPayment.ts:98-105`
- Test: `apps/backoffice/src/features/btob/__tests__/record-payment-invoice-selection.smoke.test.tsx`

**Interfaces:**
- Consumes: `useB2bInvoices` + `B2bInvoiceRow` (Task 4) ; `useRecordB2bPayment` (`invoiceIds?: string[]` déjà supporté, retour `allocations[]`).
- Produces: prop optionnel **`initialInvoiceIds?: string[]`** sur `RecordB2bPaymentModalProps` (consommé par Task 6) ; invalidation `['b2b-invoices']` dans `useRecordB2bPayment`.

- [ ] **Step 5.1:** Dans `useRecordB2bPayment.ts` `onSuccess` (L99-104), ajouter à la liste `Promise.all` :
```ts
        qc.invalidateQueries({ queryKey: ['b2b-invoices'] }),
```
- [ ] **Step 5.2:** Modifier `RecordB2bPaymentModal.tsx` :
  - Props : `initialInvoiceIds?: string[]` ajouté à `RecordB2bPaymentModalProps` (L24-29).
  - Imports : `useB2bInvoices` + `type B2bInvoiceRow` ; `type RecordB2bPaymentResult` depuis le hook.
  - États supplémentaires (après L59) :
```ts
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [result, setResult] = useState<RecordB2bPaymentResult | null>(null);
```
  - Reset à l'ouverture (dans le `useEffect(open)` L61-72) : `setSelectedIds(initialInvoiceIds ?? []); setResult(null);` (et dépendance `initialInvoiceIds`).
  - Requête factures ouvertes du client : `const invoices = useB2bInvoices(customerId, true, open && customerId !== '');`
  - Au changement de client (`onChange` du select client) : `setSelectedIds([]);` en plus du `setCustomerId`.
  - Toggle (l'ordre de coche = ordre d'allocation ; le montant se pré-remplit avec Σ outstanding de la sélection) :
```ts
  function toggleInvoice(inv: B2bInvoiceRow): void {
    setSelectedIds((prev) => {
      const next = prev.includes(inv.invoice_id)
        ? prev.filter((id) => id !== inv.invoice_id)
        : [...prev, inv.invoice_id];
      const sum = (invoices.data ?? [])
        .filter((r) => next.includes(r.invoice_id))
        .reduce((acc, r) => acc + Number(r.outstanding), 0);
      if (next.length > 0) setAmount(String(sum));
      return next;
    });
  }
```
  - UI : sous le bloc client (après L170), quand `customerId !== ''` :
```tsx
          {customerId !== '' && (
            <div className="space-y-1">
              <span className="text-xs uppercase tracking-widest text-text-secondary">
                Open invoices {selectedIds.length > 0 ? `(${selectedIds.length} selected — allocation order)` : '(none selected → FIFO)'}
              </span>
              {invoices.isLoading ? (
                <p className="text-xs text-text-muted">Loading invoices…</p>
              ) : (invoices.data ?? []).length === 0 ? (
                <p className="text-xs text-text-muted">No open invoices for this customer.</p>
              ) : (
                <ul className="max-h-44 overflow-y-auto divide-y divide-border-subtle rounded-md border border-border-subtle">
                  {(invoices.data ?? []).map((inv) => (
                    <li key={inv.invoice_id}>
                      <label className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-xs">
                        <span className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selectedIds.includes(inv.invoice_id)}
                            onChange={() => toggleInvoice(inv)}
                            data-testid={`rp-invoice-${inv.order_number}`}
                          />
                          <span className="font-mono text-text-primary">{inv.order_number}</span>
                          <span className="text-text-muted">{inv.age_days}d</span>
                        </span>
                        <span className="font-mono text-text-primary">{formatIdr(Number(inv.outstanding))}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
              {selectedIds.length > 0 && amountValid && (() => {
                const sum = (invoices.data ?? [])
                  .filter((r) => selectedIds.includes(r.invoice_id))
                  .reduce((acc, r) => acc + Number(r.outstanding), 0);
                return numericAmount > sum ? (
                  <p className="text-[10px] text-amber-500">
                    Amount exceeds the selected invoices — the excess will be allocated FIFO across the remaining ones.
                  </p>
                ) : null;
              })()}
            </div>
          )}
```
  - Soumission (L98-106) : ajouter `...(selectedIds.length > 0 ? { invoiceIds: selectedIds } : {}),` et remplacer `handleClose();` par `setResult(res);` où `const res = await recordMut.mutateAsync({ … });`
  - Vue succès : quand `result !== null`, remplacer le corps du form par le récap (garder le Dialog) :
```tsx
          {result !== null ? (
            <div className="space-y-3" data-testid="rp-success">
              <div className="rounded-md border border-border-subtle bg-bg-overlay p-3 text-sm">
                Payment <span className="font-mono">{result.payment_number}</span> recorded.
              </div>
              <ul className="divide-y divide-border-subtle rounded-md border border-border-subtle text-xs">
                {result.allocations.map((a) => (
                  <li key={a.invoice_id} className="flex items-center justify-between px-3 py-2">
                    <span className="font-mono">{a.invoice_id.slice(0, 8)}…</span>
                    <span className="flex items-center gap-2">
                      <span className="font-mono">{formatIdr(a.amount_applied)}</span>
                      {a.fully_settled && (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-semibold text-green-700">settled</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="flex justify-end">
                <Button type="button" variant="primary" onClick={handleClose}>Done</Button>
              </div>
            </div>
          ) : ( /* …form existant… */ )}
```
- [ ] **Step 5.3:** Smoke test : mock `supabase.rpc` + `from('view_b2b_invoices')` ; (a) cocher 2 factures dans l'ordre B→A → `mutateAsync` reçoit `invoiceIds: [B, A]` (ordre de coche) et le montant s'est pré-rempli avec la somme des outstanding ; (b) aucune coche → pas de clé `invoiceIds` dans l'appel ; (c) succès → `rp-success` liste les allocations.
- [ ] **Step 5.4:** Run `pnpm --filter @breakery/backoffice test record-payment-invoice` → PASS ; `test b2b` → pas de régression.
- [ ] **Step 5.5:** Commit `feat(b2b): invoice multi-select (targeted allocation) + allocations recap in RecordB2bPaymentModal (S56 DEV-S52-03)`

---

### Task 6: onglet « Invoices » + `CancelB2bOrderModal` + pré-remplissage Outstanding

**Files:**
- Create: `apps/backoffice/src/features/btob/components/CancelB2bOrderModal.tsx`
- Create: `apps/backoffice/src/features/btob/components/B2bInvoicesTab.tsx`
- Modify: `apps/backoffice/src/pages/btob/B2BPaymentsPage.tsx`
- Test: `apps/backoffice/src/features/btob/__tests__/b2b-invoices-tab.smoke.test.tsx`

**Interfaces:**
- Consumes: `useB2bInvoices`/`B2bInvoiceRow` (Task 4) ; `useCancelB2bOrder`, `CancelB2bOrderError` (existant) ; `useB2bCustomers` ; `RecordB2bPaymentModal` avec `initialCustomerId` + `initialInvoiceIds` (Task 5) ; `EmptyState`, `Button` de `@breakery/ui` ; `FileText`, `XCircle` de lucide.
- Produces: `B2bInvoicesTab({ search, canRecord, canCancel, onRecord }: { search: string; canRecord: boolean; canCancel: boolean; onRecord: (customerId: string, invoiceIds?: string[]) => void })` ; `CancelB2bOrderModal({ open, orderId, orderNumber, onClose })`.

- [ ] **Step 6.1:** Écrire `CancelB2bOrderModal.tsx` :
```tsx
// apps/backoffice/src/features/btob/components/CancelB2bOrderModal.tsx
// Session 56 — DEV-S52-03 : cancel an unpaid b2b_pending invoice.
// Wraps cancel_b2b_order_v1 (reverse JE + sale_void stock + balance).
// Blocked server-side when any allocation exists (order_has_payments).
// One modal opening = one idempotency key (rotated on close, S55 pattern).

import { useRef, useState, type JSX } from 'react';
import {
  Button,
  Dialog, DialogContent, DialogTitle, DialogDescription,
} from '@breakery/ui';
import { useCancelB2bOrder, CancelB2bOrderError } from '../hooks/useCancelB2bOrder.js';

const ERROR_COPY: Record<string, string> = {
  order_has_payments:    'This invoice already has a payment allocated — handle the payment first.',
  order_not_cancellable: 'Only unpaid b2b_pending invoices can be cancelled.',
  reason_required:       'A reason of at least 3 characters is required.',
  permission_denied:     'You do not have permission to cancel B2B invoices (needs b2b.order.cancel).',
  fiscal_period_closed:  'The fiscal period of this invoice is closed.',
  unknown:               'Something went wrong. Please retry.',
};

export interface CancelB2bOrderModalProps {
  open:        boolean;
  orderId:     string;
  orderNumber: string;
  onClose:     () => void;
}

export function CancelB2bOrderModal({ open, orderId, orderNumber, onClose }: CancelB2bOrderModalProps): JSX.Element {
  const cancelMut = useCancelB2bOrder();
  const idempotencyKeyRef = useRef<string>(crypto.randomUUID());
  const [reason, setReason] = useState('');
  const [error, setError]   = useState<string | null>(null);

  function handleClose(): void {
    idempotencyKeyRef.current = crypto.randomUUID(); // new modal = new key
    setReason('');
    setError(null);
    onClose();
  }

  async function handleConfirm(): Promise<void> {
    setError(null);
    if (reason.trim().length < 3) {
      setError(ERROR_COPY['reason_required'] as string);
      return;
    }
    try {
      await cancelMut.mutateAsync({
        orderId,
        reason: reason.trim(),
        idempotencyKey: idempotencyKeyRef.current,
      });
      handleClose();
    } catch (err) {
      const code = err instanceof CancelB2bOrderError ? err.code : 'unknown';
      setError(ERROR_COPY[code] ?? (err as Error).message);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md">
        <DialogTitle>Cancel invoice {orderNumber}</DialogTitle>
        <DialogDescription className="sr-only">
          Cancels an unpaid B2B invoice: reverses its journal entry, restores stock and decreases the customer balance.
        </DialogDescription>
        <div className="space-y-3">
          <div className="rounded border border-red bg-red-soft px-3 py-2 text-xs text-red">
            This reverses the invoice journal entry, restores stock and decreases the
            customer balance. It cannot be undone via UI.
          </div>
          <label className="flex flex-col text-sm">
            Reason (min. 3 characters)
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border border-border-subtle bg-bg-input p-2 text-sm text-text-primary"
              data-testid="cb2b-reason"
            />
          </label>
          {error !== null && (
            <div role="alert" className="rounded border border-red bg-red-soft px-3 py-2 text-sm text-red" data-testid="cb2b-error">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={handleClose} disabled={cancelMut.isPending}>
              Keep invoice
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() => { void handleConfirm(); }}
              disabled={cancelMut.isPending || reason.trim().length < 3}
              data-testid="cb2b-confirm"
            >
              {cancelMut.isPending ? 'Cancelling…' : 'Cancel invoice'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```
- [ ] **Step 6.2:** Écrire `B2bInvoicesTab.tsx` — liste + filtres + actions :
```tsx
// apps/backoffice/src/features/btob/components/B2bInvoicesTab.tsx
// Session 56 — DEV-S52-03 : per-invoice surface (view_b2b_invoices).
// Filters: customer + unpaid-only (default ON) + page-level search.
// Row actions: Record payment (pre-checks the invoice), Cancel (b2b_pending,
// nothing allocated, gate b2b.order.cancel).

import { useMemo, useState, type JSX } from 'react';
import { FileText, XCircle } from 'lucide-react';
import { Button, EmptyState } from '@breakery/ui';
import { formatIdr } from '@breakery/utils';
import { useB2bInvoices, type B2bInvoiceRow } from '../hooks/useB2bInvoices.js';
import { useB2bCustomers } from '../hooks/useB2bCustomers.js';
import { CancelB2bOrderModal } from './CancelB2bOrderModal.js';

function statusBadge(inv: B2bInvoiceRow): { label: string; cls: string } {
  if (Number(inv.outstanding) === 0) return { label: 'paid',    cls: 'bg-green-100 text-green-700' };
  if (Number(inv.amount_paid) > 0)   return { label: 'partial', cls: 'bg-amber-100 text-amber-900' };
  return { label: 'unpaid', cls: 'bg-red-soft text-red' };
}

export interface B2bInvoicesTabProps {
  search:    string;
  canRecord: boolean;
  canCancel: boolean;
  onRecord:  (customerId: string, invoiceIds?: string[]) => void;
}

export function B2bInvoicesTab({ search, canRecord, canCancel, onRecord }: B2bInvoicesTabProps): JSX.Element {
  const customers = useB2bCustomers();
  const [customerId, setCustomerId] = useState('');
  const [unpaidOnly, setUnpaidOnly] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<B2bInvoiceRow | null>(null);

  const invoices = useB2bInvoices(customerId || undefined, unpaidOnly);

  const rows = useMemo(() => {
    const q = search.toLowerCase();
    return (invoices.data ?? []).filter((r) =>
      q === '' ||
      r.order_number.toLowerCase().includes(q) ||
      (r.b2b_company_name ?? '').toLowerCase().includes(q) ||
      (r.customer_name ?? '').toLowerCase().includes(q));
  }, [invoices.data, search]);

  return (
    <div className="border-t border-border-subtle">
      <div className="flex flex-wrap items-center gap-3 p-4">
        <select
          value={customerId}
          onChange={(e) => setCustomerId(e.target.value)}
          className="h-9 rounded-md border border-border-subtle bg-bg-input px-3 text-sm text-text-primary"
          aria-label="Filter by customer"
          data-testid="inv-customer-filter"
        >
          <option value="">All customers</option>
          {customers.data?.map((c) => (
            <option key={c.id} value={c.id}>{c.b2b_company_name ?? c.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={unpaidOnly}
            onChange={(e) => setUnpaidOnly(e.target.checked)}
            data-testid="inv-unpaid-toggle"
          />
          Unpaid only
        </label>
      </div>

      {invoices.isLoading ? (
        <div className="p-6 text-sm text-text-secondary">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={FileText} title="No invoices" description="B2B invoices will appear here." size="md" />
      ) : (
        <ul className="divide-y divide-border-subtle" data-testid="inv-list">
          {rows.map((inv) => {
            const badge = statusBadge(inv);
            const cancellable = inv.order_status === 'b2b_pending' && Number(inv.amount_paid) === 0;
            return (
              <li key={inv.invoice_id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-text-primary">{inv.order_number}</span>
                    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ${badge.cls}`}>
                      {badge.label}
                    </span>
                  </div>
                  <div className="text-xs text-text-secondary">
                    {inv.b2b_company_name ?? inv.customer_name ?? 'Unknown'}
                    {' • '}{new Date(inv.invoice_date).toLocaleDateString()}
                    {' • '}{inv.age_days}d
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs">
                    <div className="font-mono text-base text-text-primary">{formatIdr(Number(inv.outstanding))}</div>
                    <div className="text-text-muted">
                      of {formatIdr(Number(inv.invoice_total))} • paid {formatIdr(Number(inv.amount_paid))}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {canRecord && Number(inv.outstanding) > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onRecord(inv.customer_id, [inv.invoice_id])}
                        data-testid={`inv-record-${inv.order_number}`}
                      >
                        Record payment
                      </Button>
                    )}
                    {canCancel && cancellable && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setCancelTarget(inv)}
                        className="text-red"
                        data-testid={`inv-cancel-${inv.order_number}`}
                      >
                        <XCircle className="mr-1 h-3.5 w-3.5" aria-hidden /> Cancel
                      </Button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {cancelTarget !== null && (
        <CancelB2bOrderModal
          open
          orderId={cancelTarget.invoice_id}
          orderNumber={cancelTarget.order_number}
          onClose={() => setCancelTarget(null)}
        />
      )}
    </div>
  );
}
```
- [ ] **Step 6.3:** Modifier `B2BPaymentsPage.tsx` :
  - `type TabKey = 'received' | 'outstanding' | 'invoices' | 'aging';`
  - Imports : `FileText` (lucide), `B2bInvoicesTab`.
  - États : remplacer `const [recordOpen, setRecordOpen] = useState<boolean>(false);` par :
```ts
  const [recordOpen, setRecordOpen] = useState<boolean>(false);
  const [recordCustomerId, setRecordCustomerId] = useState<string | undefined>(undefined);
  const [recordInvoiceIds, setRecordInvoiceIds] = useState<string[] | undefined>(undefined);
  const canCancel = hasPermission('b2b.order.cancel');

  function openRecord(customerId?: string, invoiceIds?: string[]): void {
    setRecordCustomerId(customerId);
    setRecordInvoiceIds(invoiceIds);
    setRecordOpen(true);
  }
```
  - Bouton header : `onClick={() => openRecord()}`.
  - `TabsList` : ajouter après Outstanding :
```tsx
            <TabsTrigger value="invoices">
              <FileText className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Invoices
            </TabsTrigger>
```
  - Nouveau `TabsContent` avant `aging` :
```tsx
          <TabsContent value="invoices">
            <B2bInvoicesTab
              search={search}
              canRecord={canRecord}
              canCancel={canCancel}
              onRecord={openRecord}
            />
          </TabsContent>
```
  - `OutstandingRow` : signature `{ client, canRecord, onRecord }: { client: B2bClientRow; canRecord: boolean; onRecord: (customerId: string) => void }` ; dans le bloc de droite ajouter :
```tsx
        {canRecord && (
          <Button variant="ghost" size="sm" onClick={() => onRecord(client.id)} data-testid={`out-record-${client.id}`}>
            Record payment
          </Button>
        )}
```
    et le call-site devient `<OutstandingRow key={c.id} client={c} canRecord={canRecord} onRecord={openRecord} />`.
  - Mount du modal (L244) :
```tsx
      <RecordB2bPaymentModal
        open={recordOpen}
        initialCustomerId={recordCustomerId}
        initialInvoiceIds={recordInvoiceIds}
        onClose={() => setRecordOpen(false)}
      />
```
- [ ] **Step 6.4:** Smoke test `b2b-invoices-tab.smoke.test.tsx` : mock query (2 factures : une `b2b_pending` non payée, une partiellement payée) ; (a) les 2 lignes rendent outstanding/badges ; (b) le bouton Cancel n'apparaît que sur la `b2b_pending` non payée et seulement si `canCancel` ; (c) clic Cancel → modal, raison < 3 car. → bouton confirm disabled ; (d) `onRecord` reçoit `(customer_id, [invoice_id])`.
- [ ] **Step 6.5:** Run `pnpm --filter @breakery/backoffice test b2b-invoices-tab` → PASS ; `pnpm --filter @breakery/backoffice test b2b` → pas de régression.
- [ ] **Step 6.6:** Commit `feat(b2b): Invoices tab + per-invoice Cancel + prefilled Record payment (S56 DEV-S52-03)`

---

### Task 7 (contrôleur seul): migration `_087` — repoint des 26 writers vers `audit_logs`

**Files:**
- Create: `supabase/migrations/20260710000087_repoint_audit_writers_to_audit_logs.sql`

**Interfaces:**
- Consumes: état live vérifié — 26 fonctions, 25 avec liste `(action, subject_table, subject_id, payload, actor_profile_id)`, 1 (`soft_delete_customer`) avec `(actor_profile_id, action, subject_table, subject_id, payload)` ; `duplicate_recipe_v1` LIT aussi la vue (replay : `SELECT payload INTO v_existing FROM audit_log … ORDER BY occurred_at DESC`).
- Produces: zéro fonction live écrivant/lisant la vue. Task 8 en dépend.

- [ ] **Step 7.1 (contrôleur):** Dump live : `execute_sql` → `SELECT pg_get_functiondef('public.duplicate_recipe_v1(uuid,uuid,uuid)'::regprocedure);`
- [ ] **Step 7.2 (contrôleur):** Écrire la migration :
  1. **Corps explicite `duplicate_recipe_v1`** (COR du dump) avec 3 retouches exactes : `SELECT payload INTO v_existing\n      FROM audit_log` → `SELECT metadata AS payload INTO v_existing\n      FROM audit_logs` ; `ORDER BY occurred_at DESC` → `ORDER BY created_at DESC` ; l'INSERT selon la règle regex ci-dessous. (L'alias `metadata AS payload` préserve les références `v_existing.payload` du corps.)
  2. **DO block** pour les 25 restantes :
```sql
-- 20260710000087_repoint_audit_writers_to_audit_logs.sql
-- S56 P2.2 (audit T6) : consolidation audit — les 26 dernières RPCs écrivant
-- via la vue compat audit_log sont repointées sur la table audit_logs.
-- In-place CREATE OR REPLACE (précédent _077/_078) : signatures, grants et
-- comportements inchangés — seul le nom de la cible et la liste de colonnes
-- changent (mapping du trigger compat reproduit à l'identique).
-- duplicate_recipe_v1 (lecteur + écrivain) est traité explicitement au-dessus.

DO $do$
DECLARE
  r      record;
  v_def  text;
  v_new  text;
  v_cnt  int := 0;
BEGIN
  FOR r IN
    SELECT p.oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosrc ~* 'INSERT\s+INTO\s+(public\.)?audit_log\M'
  LOOP
    v_def := pg_get_functiondef(r.oid);
    v_new := regexp_replace(
      v_def,
      'INSERT\s+INTO\s+(?:public\.)?audit_log\s*\(\s*action\s*,\s*subject_table\s*,\s*subject_id\s*,\s*payload\s*,\s*actor_profile_id\s*\)',
      'INSERT INTO audit_logs (action, entity_type, entity_id, metadata, actor_id)',
      'gi');
    v_new := regexp_replace(
      v_new,
      'INSERT\s+INTO\s+(?:public\.)?audit_log\s*\(\s*actor_profile_id\s*,\s*action\s*,\s*subject_table\s*,\s*subject_id\s*,\s*payload\s*\)',
      'INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)',
      'gi');
    IF v_new = v_def THEN
      RAISE EXCEPTION 'unexpected audit_log INSERT column list in %', r.oid::regprocedure;
    END IF;
    EXECUTE v_new;
    v_cnt := v_cnt + 1;
  END LOOP;
  IF v_cnt <> 25 THEN
    RAISE EXCEPTION 'expected 25 remaining writers (26 minus duplicate_recipe_v1), rewrote %', v_cnt;
  END IF;
  -- Post-condition dure : plus aucun accès à la vue depuis une fonction.
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND (p.prosrc ~* 'INSERT\s+INTO\s+(public\.)?audit_log\M'
        OR p.prosrc ~* '(FROM|JOIN)\s+(public\.)?audit_log\M')
  ) THEN
    RAISE EXCEPTION 'audit_log view still referenced by at least one function';
  END IF;
END
$do$;
```
  (Ordre dans le fichier : COR `duplicate_recipe_v1` D'ABORD, DO block ENSUITE — sinon le compte est 26 et le corps explicite serait écrasé par la version regex qui ne fixe pas le SELECT.)
- [ ] **Step 7.3 (contrôleur):** `apply_migration(name='repoint_audit_writers_to_audit_logs', …)`.
- [ ] **Step 7.4 (contrôleur):** Vérif live immédiate : la requête regex du Step 7.2 post-condition → 0 ligne ; puis smoke rapide `execute_sql` BEGIN…ROLLBACK : seed produit + `record_stock_movement_v1` → nouvelle ligne `audit_logs` (`action='stock.movement'`) ; `duplicate_recipe_v1` replay (2 appels même `p_idempotency_key`) → 2ᵉ appel renvoie l'enveloppe du 1ᵉʳ.
- [ ] **Step 7.5:** Commit `feat(db): repoint 26 audit writers from compat view to audit_logs (S56 P2.2)`

---

### Task 8: pgTAP `audit_consolidation` + migration `_088` — drop vue/trigger compat

**Files:**
- Create: `supabase/tests/audit_consolidation.test.sql` (subagent)
- Create: `supabase/migrations/20260710000088_drop_audit_log_compat_view.sql` (subagent ; contrôleur applique)

**Interfaces:**
- Consumes: état post-`_087` (zéro référence fonctionnelle à la vue).
- Produces: vue `audit_log`, trigger `audit_log_compat_insert`, fonction `audit_log_insert_trigger()` supprimés ; COMMENTs sémantiques sur `audit_logs.metadata`/`payload`.

- [ ] **Step 8.1 (gate avant drop):** `grep -rnw 'audit_log' apps packages supabase/functions supabase/tests --include='*' | grep -v 'audit_logs'` → attendu : 0 usage code (hors commentaires/docs). Si un lecteur apparaît → STOP, repli « vue read-only + REVOKE INSERT », déviation DEV-S56-xx.
- [ ] **Step 8.2:** Écrire la migration :
```sql
-- 20260710000088_drop_audit_log_compat_view.sql
-- S56 P2.2 : démantèlement de la couche compat S13. Zéro writer (cf. _087,
-- assertion dure) et zéro lecteur (grep repo + live) — la table audit_logs
-- est désormais l'unique surface de l'audit-trail.
DROP TRIGGER IF EXISTS audit_log_compat_insert ON public.audit_log;
DROP FUNCTION IF EXISTS public.audit_log_insert_trigger();
DROP VIEW IF EXISTS public.audit_log;

COMMENT ON COLUMN public.audit_logs.metadata IS
  'Free-form audit context (who/what/params). Target of the legacy view''s payload mapping — all RPC writers write here.';
COMMENT ON COLUMN public.audit_logs.payload IS
  'Structured before/after diff (S19, 20260523000019). Distinct from metadata — do not fold.';
```
- [ ] **Step 8.3 (contrôleur):** `apply_migration(name='drop_audit_log_compat_view', …)`.
- [ ] **Step 8.4:** Écrire `supabase/tests/audit_consolidation.test.sql` (pattern temp-table capture, `plan(6)`) :
  - T1 : `SELECT count(*) = 0 FROM pg_proc p JOIN pg_namespace n … WHERE n.nspname='public' AND p.prosrc ~* 'INSERT\s+INTO\s+(public\.)?audit_log\M'` → true.
  - T2 : idem lecture `(FROM|JOIN)\s+(public\.)?audit_log\M` → true.
  - T3 : `to_regclass('public.audit_log') IS NULL` → true (vue droppée).
  - T4 : `SELECT count(*) = 0 FROM pg_proc WHERE proname = 'audit_log_insert_trigger'` → true.
  - T5 : flux échantillon — seed produit + section + identité (miroir du seed de `supabase/tests/inventory.test.sql`) ; appel `record_stock_movement_v1(…, p_movement_type='adjustment_in', …)` ; assert : `audit_logs` gagne 1 ligne `action='stock.movement'` avec `metadata->>'movement_type'` non nul et `entity_type='stock_movements'` (adapter l'assertion aux clés réellement observées via un run préliminaire — PAS de valeurs devinées).
  - T6 : RLS `audit_logs` intact : `SELECT count(*) FROM pg_policies WHERE tablename='audit_logs'` = 1 (policy `admin_read`, cmd SELECT).
- [ ] **Step 8.5 (contrôleur):** Run la suite via `execute_sql` (BEGIN…ROLLBACK) → 6/6. Puis re-run des ancres des familles réécrites : `supabase/tests/inventory.test.sql`, `supabase/tests/close_fiscal_year_v1.test.sql` (19/19), `supabase/tests/b2b_settlement.test.sql` (14/14), `supabase/tests/s26_db_hardening.test.sql` (15/15) → 0 `not ok`.
- [ ] **Step 8.6:** Commit `feat(db): drop audit_log compat view/trigger + audit_consolidation pgTAP suite (S56 P2.2)`

---

### Task 9: regen types + gates transverses

**Files:**
- Modify: `packages/supabase/src/types.generated.ts` (regen — la vue `audit_log` disparaît des types)

- [ ] **Step 9.1 (contrôleur):** `generate_typescript_types` → écrire `packages/supabase/src/types.generated.ts`.
- [ ] **Step 9.2:** `grep -rn "audit_log[^s]" apps packages --include='*.ts' --include='*.tsx'` → 0 résultat (aucun consommateur du type de la vue).
- [ ] **Step 9.3:** `pnpm typecheck` → 0 erreur ; `pnpm build` → succès.
- [ ] **Step 9.4:** Suites ciblées : `pnpm --filter @breakery/backoffice test accounting` + `test b2b` (baseline env-gated ≠ régression).
- [ ] **Step 9.5:** Commit `chore(types): regen after S56 migrations _087.._088`

---

### Task 10: Closeout

**Files:**
- Create: `docs/workplan/plans/2026-07-03-session-56-INDEX.md`
- Modify: `CLAUDE.md` (Active Workplan)

- [ ] **Step 10.1:** INDEX S56 : périmètre (DEV-S54-01, DEV-S52-03, P2.2 reliquat), migrations `_087`/`_088`, inventaire 26 writers (25 regex + 1 explicite), suites, déviations numérotées (DEV-S56-xx).
- [ ] **Step 10.2:** CLAUDE.md : S56 → « Merged (latest) » ; retirer les lignes DEV-S54-01/DEV-S52-03 de « In flight » ; noter « audit-trail = table `audit_logs` uniquement, vue compat droppée S56 » ; « In flight » → prochaine vague (triage P2 restant).
- [ ] **Step 10.3:** PR `swarm/session-56 → master` (squash), body résumé + `🤖 Generated with [Claude Code](https://claude.com/claude-code)`, co-author Claude.

## Self-review (fait à l'écriture)

- **Couverture spec** : A1-A5 → Tasks 1-3 ; B1-B5 → Tasks 4-6 ; C (repoint + drop + pgTAP + D7 COMMENTs) → Tasks 7-8 ; gates/critères transverses → Task 9 ; closeout → Task 10. ✅
- **Placeholders** : T5 de la suite pgTAP exige un run préliminaire pour fixer les clés d'assertion — explicitement demandé, pas de valeur devinée. ✅
- **Cohérence types** : `useCloseFiscalYear` (Task 1) ↔ `AnnualCloseModal` (Task 2) — mêmes noms/types ; `useB2bInvoices(customerId?, unpaidOnly?, enabled?)` (Task 4) ↔ Tasks 5/6 ; `initialInvoiceIds` produit en Task 5, consommé en Task 6 ; `openRecord(customerId?, invoiceIds?)` ↔ `onRecord`. ✅
- **Ordre `_087`** : corps explicite `duplicate_recipe_v1` AVANT le DO block, compte attendu 25 — justifié dans le fichier. ✅
