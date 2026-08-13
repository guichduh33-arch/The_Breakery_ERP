// packages/ui/src/primitives/__tests__/FormField.test.tsx
//
// Le contrat du champ de formulaire accessible (critique /impeccable
// 2026-08-13, lot 2) : label rattaché, requis porté par le contrôle (pas par
// la couleur de l'astérisque), erreur et indice rattachés par aria-describedby.

import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { FormField } from '../FormField.js';
import { Input } from '../Input.js';

afterEach(cleanup);

describe('FormField', () => {
  it('rattache le label au contrôle et injecte l’id', () => {
    render(
      <FormField id="ff-name" label="Vendor name">
        <Input value="" onChange={() => undefined} />
      </FormField>,
    );
    const input = screen.getByLabelText('Vendor name');
    expect(input).toHaveAttribute('id', 'ff-name');
    expect(input).not.toBeRequired();
    expect(input).toHaveAttribute('aria-invalid', 'false');
  });

  it('porte le requis sur le contrôle et sort l’astérisque du flux vocal', () => {
    render(
      <FormField id="ff-amount" label="Amount" required>
        <Input value="" onChange={() => undefined} />
      </FormField>,
    );
    // Le nom accessible reste exactement « Amount » : l'astérisque est
    // aria-hidden, donc exclu du calcul de nom (accname).
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input).toBeRequired();
  });

  it('rattache l’erreur au contrôle (aria-invalid + aria-describedby)', () => {
    render(
      <FormField id="ff-amount" label="Amount" required error="Must be > 0">
        <Input value="" onChange={() => undefined} />
      </FormField>,
    );
    const input = screen.getByRole('textbox', { name: 'Amount' });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Must be > 0');
  });

  it('rattache l’indice, et le cumule avec l’erreur', () => {
    render(
      <FormField id="ff-vat" label="VAT" hint="0 if exempt" error="Cannot exceed amount">
        <Input value="" onChange={() => undefined} />
      </FormField>,
    );
    const input = screen.getByLabelText('VAT');
    expect(input).toHaveAccessibleDescription('0 if exempt Cannot exceed amount');
  });

  it('sans erreur, ne rend ni message ni describedby', () => {
    render(
      <FormField id="ff-desc" label="Description">
        <Input value="" onChange={() => undefined} />
      </FormField>,
    );
    const input = screen.getByLabelText('Description');
    expect(input).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByText('Must be > 0')).toBeNull();
  });
});
