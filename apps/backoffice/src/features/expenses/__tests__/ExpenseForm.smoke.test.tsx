// apps/backoffice/src/features/expenses/__tests__/ExpenseForm.smoke.test.tsx
//
// Session 13 — Phase 3.B smoke test for ExpenseForm.
// Critique /impeccable 2026-08-13 (lot 2) — nouveau contrat de validation :
// le bouton reste ACTIF quand la saisie est incomplète ; c'est le submit qui
// révèle toutes les erreurs (câblées aux champs) et focalise le premier champ
// fautif. onSubmit n'est appelé qu'avec une saisie valide.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  ExpenseForm,
  emptyExpenseFormValues,
  type ExpenseFormValues,
} from '../components/ExpenseForm.js';

// Mock supabase to avoid env issues — the form only reads expense_categories.
vi.mock('@/lib/supabase.js', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          order: () =>
            Promise.resolve({
              data: [
                { id: 'cat-1', code: 'UTILITIES',  name: 'Utilities',  is_active: true, account_id: 'acc-1', created_at: '', updated_at: '' },
                { id: 'cat-2', code: 'RENT',       name: 'Rent',       is_active: true, account_id: 'acc-2', created_at: '', updated_at: '' },
              ],
              error: null,
            }),
        }),
      }),
    }),
    storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }) }) },
  },
}));

function renderForm(initial: ExpenseFormValues = emptyExpenseFormValues()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const onSubmit = vi.fn();
  let values = initial;
  const onChange = vi.fn((v: ExpenseFormValues) => { values = v; });
  const utils = render(
    <QueryClientProvider client={qc}>
      <ExpenseForm
        draftId="00000000-0000-0000-0000-000000000099"
        value={values}
        onChange={onChange}
        onSubmit={onSubmit}
      />
    </QueryClientProvider>,
  );
  return { ...utils, onSubmit, onChange, getValues: () => values };
}

describe('ExpenseForm — smoke', () => {
  it('renders all required fields', async () => {
    renderForm();
    // Category select renders after categories load.
    expect(await screen.findByLabelText(/Category/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Date/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^Amount \(IDR\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/VAT amount/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Payment method/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Description/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Vendor/i)).toBeInTheDocument();
  });

  it('garde le bouton actif à vide, révèle les erreurs au submit et focalise le premier champ fautif', async () => {
    const { onSubmit } = renderForm();
    // Attendre le montage du picker (catégories asynchrones) pour que le
    // focus ait une cible.
    const category = await screen.findByLabelText(/Category/i);
    const submit = screen.getByRole('button', { name: /Save as draft/i });
    expect(submit).not.toBeDisabled();

    fireEvent.click(submit);
    expect(onSubmit).not.toHaveBeenCalled();

    // Toutes les erreurs sont révélées et câblées à leur champ.
    expect(category).toHaveAttribute('aria-invalid', 'true');
    expect(category).toHaveAccessibleDescription('Required');
    const amount = screen.getByLabelText(/^Amount \(IDR\)/i);
    expect(amount).toHaveAttribute('aria-invalid', 'true');
    expect(amount).toHaveAccessibleDescription('Must be > 0');
    expect(screen.getByLabelText(/Description/i)).toHaveAccessibleDescription('Required');

    // Le focus est renvoyé au premier champ fautif (ordre visuel : catégorie).
    expect(category).toHaveFocus();
  });

  it('porte le requis sur les contrôles (pas seulement l’astérisque)', async () => {
    renderForm();
    expect(await screen.findByLabelText(/Category/i)).toBeRequired();
    expect(screen.getByLabelText(/^Amount \(IDR\)/i)).toBeRequired();
    expect(screen.getByLabelText(/Description/i)).toBeRequired();
    expect(screen.getByLabelText(/Vendor/i)).not.toBeRequired();
  });

  it('enables submit when all required fields are populated', () => {
    const values: ExpenseFormValues = {
      category_id: 'cat-1',
      amount: '850000',
      vat_amount: '0',
      payment_method: 'cash',
      description: 'Electricity bill',
      vendor_name: 'PLN',
      expense_date: '2026-06-01',
      receipt_url: '',
    };
    renderForm(values);
    const submit = screen.getByRole('button', { name: /Save as draft/i });
    expect(submit).not.toBeDisabled();
  });

  it('invokes onSubmit when the form is submitted with valid data', () => {
    const values: ExpenseFormValues = {
      category_id: 'cat-1',
      amount: '850000',
      vat_amount: '0',
      payment_method: 'cash',
      description: 'Electricity bill',
      vendor_name: 'PLN',
      expense_date: '2026-06-01',
      receipt_url: '',
    };
    const { onSubmit } = renderForm(values);
    const submit = screen.getByRole('button', { name: /Save as draft/i });
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalled();
  });
});
