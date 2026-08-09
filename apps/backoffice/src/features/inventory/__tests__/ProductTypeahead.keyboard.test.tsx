// apps/backoffice/src/features/inventory/__tests__/ProductTypeahead.keyboard.test.tsx
//
// Régression WCAG 2.1.1 (niveau A). La sélection était câblée sur `onMouseDown`
// seul : `Entrée` sur une option émet un `click`, jamais un `mousedown`, donc
// choisir un produit au clavier était impossible — et avec lui, enregistrer une
// réception ou une perte. Ces tests tiennent le motif combobox à descendant
// actif ; ils échouent sur l'implémentation d'avant le 2026-08-09.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductTypeahead } from '../components/ProductTypeahead.js';

const MOCK_PRODUCTS = [
  { id: 'p-1', sku: 'BEV-AMER', name: 'Americano',  current_stock: 100 },
  { id: 'p-2', sku: 'BEV-LATT', name: 'Latte',      current_stock:  42 },
];

interface RpcResult { data: unknown; error: { message: string } | null }
interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  ilike:  () => MockChain;
  order:  () => MockChain;
  limit:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  const chain: MockChain = {
    select: () => chain,
    eq:     () => chain,
    is:     () => chain,
    ilike:  () => chain,
    order:  () => chain,
    limit:  () => Promise.resolve({ data: MOCK_PRODUCTS, error: null }),
  };
  return { supabase: { from: () => chain, rpc: () => Promise.resolve({ data: null, error: null }) } };
});

function renderTypeahead() {
  const onChange = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ProductTypeahead value={null} onChange={onChange} />
    </QueryClientProvider>,
  );
  const input = screen.getByPlaceholderText(/Search by name/i);
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: 'a' } });
  return { input, onChange };
}

/** Ouvre la liste et attend que les options soient rendues. */
async function openList(input: HTMLElement): Promise<void> {
  fireEvent.change(input, { target: { value: 'am' } });
  await screen.findByRole('option', { name: /Americano/i });
}

describe('ProductTypeahead — clavier', () => {
  it('sélectionne au clavier : Flèche bas puis Entrée', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-1', name: 'Americano' }));
  });

  it('descend jusqu’à la seconde option avant de valider', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-2', name: 'Latte' }));
  });

  it('boucle de la dernière option à la première', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'ArrowUp' }); // -1 → dernière
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // dernière → première (modulo)
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-1' }));
  });

  it('expose la surbrillance par aria-activedescendant, jamais par le focus', async () => {
    const { input } = renderTypeahead();
    await openList(input);

    expect(input).toHaveAttribute('aria-expanded', 'true');
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const active = screen.getByRole('option', { name: /Americano/i });
    expect(input.getAttribute('aria-activedescendant')).toBe(active.id);
    expect(active).toHaveAttribute('aria-selected', 'true');
    // Le focus ne quitte jamais le champ : c'est ce qui rend la fermeture
    // différée au blur inoffensive au clavier.
    expect(document.activeElement).not.toBe(active);
  });

  it('Échap referme la liste sans rien sélectionner', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Americano/i })).not.toBeInTheDocument();
    });
    expect(input).toHaveAttribute('aria-expanded', 'false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Entrée sans option surlignée laisse passer la soumission du formulaire', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    input.dispatchEvent(event);

    expect(onChange).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('la souris continue de sélectionner (garde-fou du passage button → role=option)', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.mouseDown(screen.getByRole('option', { name: /Latte/i }));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-2' }));
  });
});
