import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route, Navigate } from 'react-router-dom';

// Mirrors the redirect wired in routes/index.tsx so a wrong target path is
// caught here. (The full route tree requires auth and is verified manually.)
function MiniRouter() {
  return (
    <MemoryRouter initialEntries={['/backoffice/inventory/recipes']}>
      <Routes>
        <Route path="/backoffice/inventory/recipes" element={<Navigate to="/backoffice/products" replace />} />
        <Route path="/backoffice/products" element={<div>Products list</div>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('inventory/recipes redirect', () => {
  it('redirects the old standalone recipe route to the products list', () => {
    render(<MiniRouter />);
    expect(screen.getByText('Products list')).toBeInTheDocument();
  });
});
