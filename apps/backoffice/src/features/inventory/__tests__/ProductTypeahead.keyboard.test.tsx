// apps/backoffice/src/features/inventory/__tests__/ProductTypeahead.keyboard.test.tsx
//
// Régression WCAG 2.1.1 (niveau A). La sélection était câblée sur `onMouseDown`
// seul : `Entrée` sur une option émet un `click`, jamais un `mousedown`, donc
// choisir un produit au clavier était impossible — et avec lui, enregistrer une
// réception ou une perte. Ces tests tiennent le motif combobox à descendant
// actif ; ils échouent sur l'implémentation d'avant le 2026-08-09.
//
// Le bloc « durcissement » couvre les conditions limites : liste qui change sous
// la surbrillance, messages d'état, annonce au lecteur d'écran.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductTypeahead } from '../components/ProductTypeahead.js';

const MOCK_PRODUCTS = [
  { id: 'p-1', sku: 'BEV-AMER', name: 'Café Americano', current_stock: 100 },
  { id: 'p-2', sku: 'BEV-LATT', name: 'Café Latte',     current_stock:  42 },
];

// Le motif `ilike` traverse le mock : la liste rétrécit réellement quand on
// affine, ce qui est la seule façon d'éprouver une surbrillance qui survit — ou
// non — au changement de résultats.
const state = vi.hoisted(() => ({ pattern: '' }));

interface RpcResult { data: unknown; error: { message: string } | null }
interface MockChain {
  select: () => MockChain;
  eq:     () => MockChain;
  is:     () => MockChain;
  ilike:  (col: string, pattern: string) => MockChain;
  order:  () => MockChain;
  limit:  () => Promise<RpcResult>;
}

vi.mock('@/lib/supabase.js', () => {
  const chain: MockChain = {
    select: () => chain,
    eq:     () => chain,
    is:     () => chain,
    ilike:  (_col, pattern) => { state.pattern = pattern; return chain; },
    order:  () => chain,
    limit:  () => {
      const needle = state.pattern.replaceAll('%', '').toLowerCase();
      const data = MOCK_PRODUCTS.filter((p) => p.name.toLowerCase().includes(needle));
      return Promise.resolve({ data, error: null });
    },
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
  return { input, onChange };
}

/** Ouvre la liste sur les deux produits et attend leur rendu. */
async function openList(input: HTMLElement): Promise<void> {
  fireEvent.change(input, { target: { value: 'caf' } });
  await screen.findByRole('option', { name: /Americano/i });
  await screen.findByRole('option', { name: /Latte/i });
}

describe('ProductTypeahead — clavier', () => {
  it('sélectionne au clavier : Flèche bas puis Entrée', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-1' }));
  });

  it('descend jusqu’à la seconde option avant de valider', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-2' }));
  });

  it('boucle de la dernière option à la première', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'ArrowUp' });   // rien → dernière
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // dernière → première
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-1' }));
  });

  it('Début et Fin sautent aux extrémités', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    fireEvent.keyDown(input, { key: 'End' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'p-2' }));
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

describe('ProductTypeahead — durcissement', () => {
  it('abandonne la surbrillance quand le produit surligné quitte les résultats', async () => {
    const { input, onChange } = renderTypeahead();
    await openList(input);

    // Surligne Americano, puis affine jusqu'à ce qu'il disparaisse.
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(input).toHaveAttribute('aria-activedescendant');

    fireEvent.change(input, { target: { value: 'latte' } });
    await waitFor(() => {
      expect(screen.queryByRole('option', { name: /Americano/i })).not.toBeInTheDocument();
    });

    // Le rang 0 existe toujours (c'est Latte désormais) : une surbrillance
    // ancrée sur l'indice aurait validé le MAUVAIS produit. Ancrée sur
    // l'identité, elle se retire.
    expect(input).not.toHaveAttribute('aria-activedescendant');

    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('ne laisse jamais aria-activedescendant pointer un id absent du DOM', async () => {
    const { input } = renderTypeahead();
    await openList(input);
    fireEvent.keyDown(input, { key: 'End' });

    const id = input.getAttribute('aria-activedescendant');
    expect(id).not.toBeNull();
    expect(document.getElementById(id!)).not.toBeNull();
  });

  it('annonce le nombre de résultats dans une région de statut', async () => {
    const { input } = renderTypeahead();
    await openList(input);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('2 results available.');

    fireEvent.change(input, { target: { value: 'latte' } });
    await waitFor(() => { expect(status).toHaveTextContent('1 result available.'); });
  });

  it('n’expose pas les messages d’état comme des options sélectionnables', async () => {
    const { input } = renderTypeahead();
    fireEvent.change(input, { target: { value: 'zzz' } });

    await screen.findByText(/No products match/i);
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });
});
