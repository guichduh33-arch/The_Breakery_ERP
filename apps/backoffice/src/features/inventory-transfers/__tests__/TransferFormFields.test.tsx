// apps/backoffice/src/features/inventory-transfers/__tests__/TransferFormFields.test.tsx
// Session 12 — Phase 3 — Unit tests for TransferFormFields.
//
// Pure presentational component — no QueryClient or mocks needed. Verifies:
//   - Renders all sections in both From and To selects.
//   - Picking a section in From disables it as an option in To (and vice-versa).
//   - Toggling sendDirectly emits a value change.
//   - Notes textarea updates emit a value change.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  TransferFormFields,
  type TransferFormFieldsValue,
} from '../components/TransferFormFields.js';
import type { Section } from '../hooks/useSections.js';

const SECTIONS: Section[] = [
  { id: 's-1', code: 'KIT', name: 'Kitchen', kind: 'production', display_order: 1 },
  { id: 's-2', code: 'BAR', name: 'Bar',     kind: 'service',    display_order: 2 },
  { id: 's-3', code: 'PAS', name: 'Pastry',  kind: 'production', display_order: 3 },
];

const EMPTY: TransferFormFieldsValue = {
  fromSectionId: '',
  toSectionId:   '',
  notes:         '',
  sendDirectly:  false,
};

describe('TransferFormFields', () => {
  it('renders all sections in both selects', () => {
    render(
      <TransferFormFields value={EMPTY} onChange={vi.fn()} sections={SECTIONS} />,
    );
    // Each section name appears twice (once per select) → 2 options each.
    expect(screen.getAllByRole('option', { name: /Kitchen \(KIT\)/i })).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: /Bar \(BAR\)/i })).toHaveLength(2);
    expect(screen.getAllByRole('option', { name: /Pastry \(PAS\)/i })).toHaveLength(2);
    // Plus the placeholder options.
    expect(screen.getByRole('option', { name: /Select source/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /Select destination/i })).toBeInTheDocument();
  });

  it('disables the From-picked section as an option in To (and vice-versa)', () => {
    const value: TransferFormFieldsValue = { ...EMPTY, fromSectionId: 's-1', toSectionId: 's-2' };
    render(
      <TransferFormFields value={value} onChange={vi.fn()} sections={SECTIONS} />,
    );
    // Kitchen appears in both selects; in the To select, it should be disabled.
    const allKitchen = screen.getAllByRole('option', { name: /Kitchen \(KIT\)/i });
    const disabledKitchen = allKitchen.filter((el) => (el as HTMLOptionElement).disabled);
    expect(disabledKitchen).toHaveLength(1);

    // Bar appears in both selects; in the From select, it should be disabled.
    const allBar = screen.getAllByRole('option', { name: /Bar \(BAR\)/i });
    const disabledBar = allBar.filter((el) => (el as HTMLOptionElement).disabled);
    expect(disabledBar).toHaveLength(1);
  });

  it('toggling the send-directly checkbox emits a value patch', () => {
    const onChange = vi.fn();
    render(
      <TransferFormFields value={EMPTY} onChange={onChange} sections={SECTIONS} />,
    );
    const cb = screen.getByLabelText(/Send directly/i);
    fireEvent.click(cb);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, sendDirectly: true });
  });

  it('typing into Notes emits a value patch on each keystroke', () => {
    const onChange = vi.fn();
    render(
      <TransferFormFields value={EMPTY} onChange={onChange} sections={SECTIONS} />,
    );
    const textarea = screen.getByLabelText(/Notes/i);
    fireEvent.change(textarea, { target: { value: 'Restock bar' } });
    expect(onChange).toHaveBeenCalledWith({ ...EMPTY, notes: 'Restock bar' });
  });

  it('changing From or To selects emits a value patch', () => {
    const onChange = vi.fn();
    render(
      <TransferFormFields value={EMPTY} onChange={onChange} sections={SECTIONS} />,
    );
    fireEvent.change(screen.getByLabelText(/From section/i), { target: { value: 's-1' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, fromSectionId: 's-1' });

    fireEvent.change(screen.getByLabelText(/To section/i), { target: { value: 's-2' } });
    expect(onChange).toHaveBeenLastCalledWith({ ...EMPTY, toSectionId: 's-2' });
  });
});
