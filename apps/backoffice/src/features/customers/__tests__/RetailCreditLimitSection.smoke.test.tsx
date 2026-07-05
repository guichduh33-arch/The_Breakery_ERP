// apps/backoffice/src/features/customers/__tests__/RetailCreditLimitSection.smoke.test.tsx
// Session 62 Task 6 — RTL smoke for RetailCreditLimitSection.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RetailCreditLimitSection } from '../components/RetailCreditLimitSection.js';

describe('RetailCreditLimitSection', () => {
  it('renders the current limit and emits the parsed number on Save', () => {
    const onSave = vi.fn();
    render(<RetailCreditLimitSection value={500_000} canEdit={true} onSave={onSave} />);
    const input = screen.getByLabelText(/plafond ardoise/i);
    expect(input).toHaveValue('500000');

    fireEvent.change(input, { target: { value: '750000' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(750_000);
  });

  it('emits null when the field is cleared (unlimited)', () => {
    const onSave = vi.fn();
    render(<RetailCreditLimitSection value={500_000} canEdit={true} onSave={onSave} />);
    fireEvent.change(screen.getByLabelText(/plafond ardoise/i), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it('does not call onSave when the value is unchanged', () => {
    const onSave = vi.fn();
    render(<RetailCreditLimitSection value={500_000} canEdit={true} onSave={onSave} />);
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('renders read-only with no Save button when canEdit=false', () => {
    const onSave = vi.fn();
    render(<RetailCreditLimitSection value={500_000} canEdit={false} onSave={onSave} />);
    expect(screen.getByLabelText(/plafond ardoise/i)).toHaveAttribute('readonly');
    expect(screen.queryByRole('button', { name: /save/i })).not.toBeInTheDocument();
  });
});
