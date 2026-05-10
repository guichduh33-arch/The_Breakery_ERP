// packages/ui/src/components/__tests__/TenderListBuilder.test.tsx
// Session 10 — TenderRow + TenderListBuilder smoke.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TenderListBuilder } from '../TenderListBuilder.js';
import { TenderRow } from '../TenderRow.js';

describe('TenderRow', () => {
  it('renders method label + amount', () => {
    render(<TenderRow method="cash" amount={50_000} />);
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText(/50,000/)).toBeInTheDocument();
  });

  it('shows recv/chg when cash overpay set', () => {
    render(<TenderRow method="cash" amount={50_000} cashReceived={70_000} changeGiven={20_000} />);
    expect(screen.getByText(/recv/i)).toBeInTheDocument();
    expect(screen.getByText(/chg/i)).toBeInTheDocument();
  });

  it('renders remove X when onRemove is set', () => {
    const onRemove = vi.fn();
    render(<TenderRow method="card" amount={40_000} onRemove={onRemove} />);
    fireEvent.click(screen.getByLabelText(/remove card tender/i));
    expect(onRemove).toHaveBeenCalledOnce();
  });
});

describe('TenderListBuilder', () => {
  it('shows empty hint when no tenders', () => {
    render(<TenderListBuilder tenders={[]} remaining={100_000} />);
    expect(screen.getByText(/no tenders yet/i)).toBeInTheDocument();
  });

  it('lists tenders + remaining', () => {
    render(
      <TenderListBuilder
        tenders={[
          { method: 'cash', amount: 60_000 },
          { method: 'card', amount: 40_000 },
        ]}
        remaining={0}
      />,
    );
    expect(screen.getByText('Cash')).toBeInTheDocument();
    expect(screen.getByText('Card')).toBeInTheDocument();
    expect(screen.getByText(/Remaining/i)).toBeInTheDocument();
  });

  it('forwards remove clicks to the parent', () => {
    const onRemove = vi.fn();
    render(
      <TenderListBuilder
        tenders={[{ method: 'cash', amount: 60_000 }, { method: 'card', amount: 40_000 }]}
        remaining={0}
        onRemoveTender={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText(/remove card tender/i));
    expect(onRemove).toHaveBeenCalledWith(1);
  });
});
