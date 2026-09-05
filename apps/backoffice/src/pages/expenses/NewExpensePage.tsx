// apps/backoffice/src/pages/expenses/NewExpensePage.tsx
//
// Instance nommée de l'ARCHÉTYPE 4 — Form, « la conséquence avant
// l'engagement » (DESIGN.md § Page Archetypes). Deux colonnes : la saisie à
// gauche, la conséquence à droite — total dérivé, chaîne d'approbation qui
// s'appliquera, historique comparable. Le statut du brouillon vit dans
// l'en-tête, servi par `PageHeader`, source unique du bandeau.
//
// Le bandeau annonçait un « Fraunces heading » : Fraunces ne fait plus partie
// du système typographique (`packages/ui/src/tokens/typography.css`), et le
// titre de page rend en Instrument Sans depuis la refonte du shell.
//
// Le fil d'Ariane est la SEULE sortie de la page. Elle rendait aussi un
// « ← Back to expenses » : deux vocabulaires pour le même geste sur le même
// écran, alors que l'ossature commune ne déclare qu'un fil d'Ariane.
//
// Le comportement du formulaire est inchangé — `ExpenseForm` + la famille
// `create_expense` gardent la validation et la soumission idempotente.

import { useMemo, useState, type JSX } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore.js';
import { useCreateExpense } from '@/features/expenses/hooks/useCreateExpense.js';
import type { CreateExpenseInput } from '@/features/expenses/hooks/useCreateExpense.js';
import {
  ExpenseForm,
  emptyExpenseFormValues,
  type ExpenseFormValues,
  type DuplicateExpenseSeed,
} from '@/features/expenses/components/ExpenseForm.js';
import { ExpenseConsequenceRail } from '@/features/expenses/components/ExpenseConsequenceRail.js';
import { ExpenseStatusBadge } from '@/features/expenses/components/ExpenseStatusBadge.js';
import { PageHeader } from '@/components/PageHeader.js';
import { RestrictedState } from '@/components/RestrictedState.js';

interface NewExpenseNavigationState {
  duplicateFrom?: DuplicateExpenseSeed;
}

function Breadcrumb(): JSX.Element {
  return (
    <nav className="flex items-center gap-1 text-xs text-text-muted" aria-label="Breadcrumb">
      <Link to="/backoffice/expenses" className="hover:text-text-primary">Expenses</Link>
      <ChevronRight className="h-3 w-3 text-text-inert" aria-hidden />
      <span className="text-text-secondary">New</span>
    </nav>
  );
}

// Le statut vit dans l'en-tête (exigence de l'archétype), et il dit la vérité
// entière : c'est un brouillon, et il n'est pas encore enregistré.
function DraftMeta(): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <ExpenseStatusBadge status="draft" />
      <span className="text-xs text-text-muted">Not saved yet</span>
    </div>
  );
}

export default function NewExpensePage(): JSX.Element {
  const hasPermission = useAuthStore((s) => s.hasPermission);
  const canCreate     = hasPermission('expenses.create');
  const navigate      = useNavigate();
  const location      = useLocation();

  const [draftId] = useState<string>(() => crypto.randomUUID());
  const [idemKey] = useState<string>(() => crypto.randomUUID());
  // Session 59 / Task 6b — "Duplicate" (ExpenseDetailPage) navigates here with
  // { duplicateFrom } in navigation state. The date is always today and the
  // receipt is never carried over, regardless of what's in duplicateFrom.
  const [values, setValues] = useState<ExpenseFormValues>(() => {
    const base = emptyExpenseFormValues();
    const duplicateFrom = (location.state as NewExpenseNavigationState | null)?.duplicateFrom;
    if (duplicateFrom === undefined) return base;
    return {
      ...base,
      ...duplicateFrom,
      expense_date: base.expense_date,
      receipt_url: '',
    };
  });

  const create = useCreateExpense();

  const isSubmitting = create.isPending;
  const submitDisabled = useMemo(() => isSubmitting, [isSubmitting]);

  // Le refus garde le fil d'Ariane et le titre : sans eux, un opérateur arrivé
  // ici par un lien perdait l'écran entier et n'avait pour seule issue que le
  // bouton Retour du navigateur.
  if (!canCreate) {
    return (
      <div className="space-y-6 max-w-3xl">
        <Breadcrumb />
        <PageHeader title="New expense" />
        <RestrictedState what="creating expenses" permission="expenses.create" />
      </div>
    );
  }

  async function handleSubmit(): Promise<void> {
    try {
      const input: CreateExpenseInput = {
        category_id: values.category_id,
        amount: Number.parseFloat(values.amount),
        vat_amount: values.vat_amount === '' ? 0 : Number.parseFloat(values.vat_amount),
        payment_method: values.payment_method,
        description: values.description.trim(),
        expense_date: values.expense_date,
        idempotency_key: idemKey,
      };
      const vendor = values.vendor_name.trim();
      if (vendor !== '') input.vendor_name = vendor;
      if (values.receipt_url !== '') input.receipt_url = values.receipt_url;

      const id = await create.mutateAsync(input);
      void navigate(`/backoffice/expenses/${id}`);
    } catch {
      // surfaced via create.error
    }
  }

  return (
    // `max-w-6xl` borne la mesure du formulaire : la largeur des deux colonnes
    // devient constante de 1280 à 1920 px, et le rail garde 376 px de large
    // partout. Le back-office n'a pas de cible tablette — aucun palier sous
    // 1024 px n'est fabriqué ici.
    <div className="space-y-6 max-w-6xl">
      <Breadcrumb />

      <PageHeader
        title="New expense"
        subtitle="Capture an operational expense. Submit it later to request approval."
        actions={<DraftMeta />}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-6">
          <ExpenseForm
            draftId={draftId}
            value={values}
            onChange={setValues}
            onSubmit={() => { void handleSubmit(); }}
            onCancel={() => { void navigate('/backoffice/expenses'); }}
            submitting={submitDisabled}
            submitLabel="Save as draft"
          />

          {create.error !== null && create.error !== undefined && (
            <div role="alert" className="rounded-md border border-danger bg-danger-soft p-3 text-sm text-danger">
              Failed to save: {create.error.message}
            </div>
          )}
        </div>

        <ExpenseConsequenceRail
          categoryId={values.category_id}
          amount={values.amount}
          vatAmount={values.vat_amount}
        />
      </div>
    </div>
  );
}
