// apps/backoffice/src/features/customers/__tests__/B2BFieldsSection.smoke.test.tsx
// Session 13 / Phase 3.C — RTL smoke for B2BFieldsSection.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { B2BFieldsSection, type B2BFieldValues } from '../components/B2BFieldsSection.js';

const baseValues: B2BFieldValues = {
  b2b_company_name: 'PT Smoke',
  b2b_tax_id: '00.000.000.0-000.000',
  b2b_payment_terms_days: 30,
  b2b_credit_limit: 5_000_000,
  b2b_current_balance: 250_000,
};

describe('B2BFieldsSection', () => {
  it('renders all four editable fields plus outstanding AR', () => {
    render(<B2BFieldsSection values={baseValues} canEdit={true} onChange={() => {}} />);
    expect(screen.getByLabelText(/company name/i)).toHaveValue('PT Smoke');
    expect(screen.getByLabelText(/tax id/i)).toHaveValue('00.000.000.0-000.000');
    expect(screen.getByLabelText(/payment terms/i)).toHaveValue('30');
    expect(screen.getByLabelText(/credit limit/i)).toHaveValue('5000000');
    expect(screen.getByTestId('b2b-balance').textContent).toMatch(/Rp\s+250\.000/);
  });

  it('emits onChange with parsed payment-terms-days number', () => {
    const onChange = vi.fn();
    render(<B2BFieldsSection values={baseValues} canEdit={true} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/payment terms/i), { target: { value: '45' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ b2b_payment_terms_days: 45 }));
  });

  it('emits null when credit_limit cleared', () => {
    const onChange = vi.fn();
    render(<B2BFieldsSection values={baseValues} canEdit={true} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText(/credit limit/i), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ b2b_credit_limit: null }));
  });

  it('renders read-only when canEdit=false', () => {
    render(<B2BFieldsSection values={baseValues} canEdit={false} onChange={() => {}} />);
    expect(screen.getByText(/read-only/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/company name/i)).toHaveAttribute('readonly');
  });
});
