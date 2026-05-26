import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DrilldownLink } from '../DrilldownLink.js';

describe('DrilldownLink', () => {
  it('renders <Link> with correct href for valid entity', () => {
    render(
      <MemoryRouter>
        <DrilldownLink entity="product" id="p-1" label="Croissant" />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Croissant/ });
    expect(link.getAttribute('href')).toBe('/backoffice/products/p-1');
  });

  it('renders plain <span> when target is null (empty id)', () => {
    render(
      <MemoryRouter>
        <DrilldownLink entity="order" id="" label="—" />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('appends filter query params', () => {
    render(
      <MemoryRouter>
        <DrilldownLink
          entity="account"
          id="acc-1"
          label="Cash"
          filter={{ date_from: '2026-01-01', date_to: '2026-01-31' }}
        />
      </MemoryRouter>,
    );
    const link = screen.getByRole('link', { name: /Cash/ });
    expect(link.getAttribute('href')).toBe(
      '/backoffice/accounting/general-ledger?account_id=acc-1&date_from=2026-01-01&date_to=2026-01-31',
    );
  });
});
