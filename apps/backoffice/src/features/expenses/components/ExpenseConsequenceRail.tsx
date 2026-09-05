// apps/backoffice/src/features/expenses/components/ExpenseConsequenceRail.tsx
//
// Archétype 4 — Form : « la conséquence avant l'engagement ». Le rail droit de
// NewExpensePage. Il montre, À LA FRAPPE, ce que la saisie de gauche déclenche :
// la ventilation du montant engagé, la chaîne d'approbation qui s'appliquera,
// et l'historique de la même catégorie.
//
// Ce rail PRÉVOIT, il ne DÉCIDE pas — la résolution du palier appartient à
// `submit_expense` (PRODUCT.md : « Le serveur est l'autorité, jamais le
// client. Un écran qui laisse croire qu'il décide ment sur l'architecture »).
// La réserve est écrite à côté de la prévision, pas en note de bas de page
// (DESIGN.md § Do's).
//
// Géométrie reprise du rail de synthèse de PurchaseOrderDetailPage (archétype 3)
// plutôt que réinventée : `Card variant="default" padding="md"`, coiffée d'un
// `SectionLabel as="h2" size="sm"`.

import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@breakery/ui';
import { SectionLabel } from '@/components/SectionLabel.js';
import { formatCurrency } from '@breakery/utils';
import { FOCUS_RING } from '@/components/focusRing.js';
import { useRolesList } from '@/features/users/hooks/useRolesList.js';
import { useApprovalForecast, type ApprovalForecast } from '../hooks/useApprovalForecast.js';
import { ExpenseCategoryHistory } from './ExpenseCategoryHistory.js';
import type { ExpenseThresholdRow } from '../../settings/expense-thresholds/hooks/useExpenseThresholds.js';

/**
 * La formule qui dit que ce rail prévoit et ne décide pas. Une seule source.
 * « when the draft is submitted », pas « when you submit » : le bouton sous
 * ce rail dit « Save as draft », et la chaîne n'est résolue qu'à la soumission
 * du brouillon — un geste ultérieur, pas celui-ci (critique BO du 2026-09-04).
 */
const FORECAST_RESERVE =
  'Forecast only — the server resolves the final chain when the draft is submitted.';

const DASH = '—';

const MONEY = 'font-data tabular-nums';

function parseAmount(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : null;
}

function Row({ label, value, muted }: { label: string; value: string; muted?: boolean }): JSX.Element {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={`${MONEY} ${muted === true ? 'text-text-muted' : 'text-text-primary'}`}>
        {value}
      </dd>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Ventilation du montant
// ---------------------------------------------------------------------------

interface BreakdownProps {
  amount: number | null;
  vat: number | null;
}

/**
 * ATTENTION — `amount` est le montant TTC, la TVA est DEDANS.
 * `_emit_expense_je` débite la catégorie de `amount - vat_amount`, débite la
 * TVA déductible de `vat_amount` et crédite la trésorerie de `amount` entier ;
 * `ExpenseForm` refuse d'ailleurs une TVA supérieure au montant. Additionner
 * les deux fabriquerait un total que rien n'engage.
 */
function AmountBreakdownCard({ amount, vat }: BreakdownProps): JSX.Element {
  const known = amount !== null && amount > 0;
  const vatValue = vat ?? 0;
  const vatExceeds = known && vatValue > amount;
  const net = known && !vatExceeds ? amount - vatValue : null;

  return (
    <Card variant="default" padding="md" className="space-y-3" data-testid="expense-breakdown">
      <SectionLabel as="h2" size="sm" className="text-gold">
        Amount breakdown
      </SectionLabel>

      <dl className="space-y-2 text-sm">
        <Row
          label="Net (excl. VAT)"
          value={net === null ? DASH : formatCurrency(net)}
          muted={net === null}
        />
        <Row
          label="VAT included"
          value={known ? formatCurrency(vatValue) : DASH}
          muted={!known}
        />
      </dl>

      <div className="flex items-baseline justify-between gap-3 border-t border-border-subtle pt-3">
        <SectionLabel as="span" size="sm">Total committed</SectionLabel>
        <span className={`${MONEY} text-xl ${known ? 'text-gold' : 'text-text-muted'}`} data-testid="expense-total">
          {known ? formatCurrency(amount) : DASH}
        </span>
      </div>

      {vatExceeds && (
        <p className="text-xs text-text-muted" data-testid="expense-breakdown-vat-warning">
          VAT is larger than the amount — the net cannot be derived until that is fixed.
        </p>
      )}

      <p className="text-xs text-text-muted">
        Derived from Amount and VAT — read-only. VAT is <strong>included</strong> in the
        amount you enter, it is not added to it.
      </p>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// 2. Chaîne d'approbation prévue
// ---------------------------------------------------------------------------

function bracketLabel(row: ExpenseThresholdRow): string {
  return `${formatCurrency(row.amount_min)} – ${formatCurrency(row.amount_max)}`;
}

interface ForecastBodyProps {
  forecast: ApprovalForecast;
  roleName: (code: string) => string;
}

function ForecastBody({ forecast, roleName }: ForecastBodyProps): JSX.Element {
  if (forecast.status === 'pending') {
    return (
      <div className="space-y-1" data-testid="forecast-pending">
        <p className={`${MONEY} text-xl text-text-muted`}>{DASH}</p>
        <p className="text-xs text-text-muted">
          Enter an amount to see the approval chain that will apply.
        </p>
      </div>
    );
  }

  if (forecast.status === 'unconfigured') {
    return (
      <div className="space-y-1" data-testid="forecast-unconfigured">
        <p className="text-sm text-text-primary">No threshold covers this amount.</p>
        <p className="text-xs text-text-muted">
          This is not &ldquo;no approval needed&rdquo;: the server refuses a submission it
          cannot price. Add a bracket in{' '}
          <Link
            to="/backoffice/settings/expense-thresholds"
            className={`text-gold underline underline-offset-2 ${FOCUS_RING}`}
          >
            Expense thresholds
          </Link>
          .
        </p>
      </div>
    );
  }

  if (forecast.status === 'auto-approve') {
    return (
      <div className="space-y-1" data-testid="forecast-auto">
        <p className="text-sm text-text-primary">Approved on submit — no approval step.</p>
        <p className="text-xs text-text-muted">
          The journal entry posts straight away; nobody is asked to sign.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2" data-testid="forecast-chain">
      <p className="text-sm text-text-primary">
        <span className={MONEY}>{forecast.steps.length}</span>{' '}
        {forecast.steps.length === 1 ? 'approval step' : 'approval steps'} before it posts.
      </p>
      <ol className="space-y-2">
        {forecast.steps.map((step, idx) => (
          <li key={`${step.label}-${idx}`} className="flex items-start gap-2" data-testid={`forecast-step-${idx}`}>
            <span className={`${MONEY} mt-0.5 text-xs text-text-muted`}>{idx + 1}</span>
            <span className="min-w-0">
              <span className="block text-sm text-text-primary">{step.label}</span>
              <span className="block text-xs text-text-muted">
                {step.role_codes.map(roleName).join(', ')}
              </span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

interface ForecastCardProps {
  categoryId: string;
  amount: number | null;
}

function ApprovalForecastCard({ categoryId, amount }: ForecastCardProps): JSX.Element {
  const { forecast, isLoading, isError } = useApprovalForecast({ categoryId, amount });
  const { data: roles } = useRolesList();

  // Un code brut (`SUPER_ADMIN`) n'est pas une chose qu'on montre à un
  // opérateur quand la table `roles` porte un nom propre.
  const roleName = (code: string): string =>
    (roles ?? []).find((r) => r.code === code)?.name ?? code;

  return (
    <Card variant="default" padding="md" className="space-y-3" data-testid="expense-forecast">
      <SectionLabel as="h2" size="sm" className="text-gold">
        Approval forecast
      </SectionLabel>

      {isLoading && (
        <p className="text-xs text-text-muted">Loading approval thresholds…</p>
      )}

      {isError && (
        <p className="text-xs text-text-muted" data-testid="forecast-error">
          Approval thresholds could not be loaded — this rail says nothing rather than
          guessing.
        </p>
      )}

      {!isLoading && !isError && (
        <>
          <ForecastBody forecast={forecast} roleName={roleName} />

          {forecast.matched !== null && (
            <p className="text-xs text-text-muted" data-testid="forecast-bracket">
              Bracket <span className={MONEY}>{bracketLabel(forecast.matched)}</span> ·{' '}
              {forecast.matched.category_id === null
                ? 'general rule (all categories)'
                : `${forecast.matched.category_name ?? 'this category'} rule`}
            </p>
          )}

          {forecast.overridden !== null && (
            <p className="text-xs text-text-muted" data-testid="forecast-override">
              A general rule covers this amount too; the category rule wins because the
              server orders category rules first.
            </p>
          )}

          {forecast.caveat !== null && (
            <p className="text-xs text-text-muted" data-testid="forecast-caveat">
              {forecast.caveat}
            </p>
          )}

          <p className="border-t border-border-subtle pt-3 text-xs text-text-muted" data-testid="forecast-reserve">
            {FORECAST_RESERVE}
          </p>
        </>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rail
// ---------------------------------------------------------------------------

export interface ExpenseConsequenceRailProps {
  categoryId: string;
  /** Montant brut du champ, encore en chaîne. */
  amount: string;
  /** Montant de TVA brut du champ, encore en chaîne. */
  vatAmount: string;
}

export function ExpenseConsequenceRail({
  categoryId,
  amount,
  vatAmount,
}: ExpenseConsequenceRailProps): JSX.Element {
  const parsedAmount = parseAmount(amount);
  const parsedVat = parseAmount(vatAmount);

  return (
    <aside className="space-y-6" aria-label="Consequence of this expense">
      <AmountBreakdownCard amount={parsedAmount} vat={parsedVat} />

      <ApprovalForecastCard categoryId={categoryId} amount={parsedAmount} />

      <Card variant="default" padding="md">
        {categoryId === '' ? (
          <div className="space-y-3">
            <SectionLabel as="h2" size="sm" className="text-gold">
              Recent in this category
            </SectionLabel>
            <p className="text-xs text-text-muted" data-testid="expense-history-nocategory">
              Pick a category to compare this amount with earlier expenses.
            </p>
          </div>
        ) : (
          <ExpenseCategoryHistory categoryId={categoryId} />
        )}
      </Card>
    </aside>
  );
}
