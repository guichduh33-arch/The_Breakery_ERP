// apps/backoffice/src/features/inventory-production/__tests__/production-revert-reachable.test.tsx
//
// LE P0 DE L'ARCHÉTYPE 9 — l'annulation d'une fournée doit être ATTEIGNABLE.
//
// Avant le 2026-08-21, tout existait sauf le branchement : la RPC
// `revert_production_v2`, le hook `useRevertProduction` et
// `RevertProductionDialog` étaient écrits, et le seul composant qui montait le
// dialogue (`ProductionRecordList`) n'avait aucun importeur. Le responsable
// production qui saisissait 200 croissants au lieu de 20 n'avait AUCUN écran
// pour se corriger — stock déduit, écriture comptable passée.
//
// Ce fichier verrouille l'affordance (exigence ADR-021 déc. 2 : une action qui
// vient d'exister se fige par un test) :
//   · elle est rendue sur une ligne NON annulée ;
//   · elle est ABSENTE d'une ligne déjà annulée — le serveur la refuserait
//     (`already_reverted`) ;
//   · sans `inventory.production.delete` elle est DÉSACTIVÉE AVEC SA RAISON,
//     jamais masquée (ADR-008 D8 : la permission suffit, pas de PIN) ;
//   · elle ouvre bien le dialogue de contre-écriture, qui nomme ce que
//     l'enregistrement va produire avant de le produire.
//
// Et l'invariant de lecture de l'archétype : le marqueur `LOCKED` et sa raison
// se rendent au-dessus du journal, et une ligne annulée n'est pas fanée mais
// NOMMÉE.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ProductionTodayPanel } from '../components/ProductionTodayPanel.js';

let currentPerms = new Set<string>(['inventory.read']);
vi.mock('@/stores/authStore.js', () => ({
  useAuthStore: (sel: (s: { hasPermission: (p: string) => boolean }) => unknown) =>
    sel({ hasPermission: (p: string) => currentPerms.has(p) }),
}));

const resolvers: Record<string, () => { data: unknown; error: unknown }> = {};

vi.mock('@/lib/supabase.js', () => {
  const methods = ['select', 'eq', 'in', 'is', 'order', 'gte', 'lte', 'limit'] as const;
  function makeChain(table: string) {
    const resolve = () => (resolvers[table] ?? (() => ({ data: [], error: null })))();
    const chain: Record<string, unknown> = {};
    for (const m of methods) chain[m] = () => chain;
    (chain as { then: unknown }).then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
      Promise.resolve(resolve()).then(onF, onR);
    return chain;
  }
  return {
    supabase: {
      from: (table: string) => makeChain(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
    },
  };
});

const DAY = new Date(2026, 7, 20, 9, 0, 0);
const SECTION = 'st-pastry';

/** Une fournée vivante et une fournée déjà contre-passée, même station. */
const RECORDS = [
  {
    id: 'pr-1', production_number: 'PRD-0001', product_id: 'p-1',
    quantity_produced: 200, quantity_waste: 0,
    production_date: new Date(2026, 7, 20, 6, 30).toISOString(),
    section_id: SECTION, batch_number: 'B-1',
    materials_consumed: true, stock_updated: true, je_posted: true,
    reverted_at: null, notes: null,
  },
  {
    id: 'pr-2', production_number: 'PRD-0002', product_id: 'p-2',
    quantity_produced: 12, quantity_waste: 0,
    production_date: new Date(2026, 7, 20, 7, 0).toISOString(),
    section_id: SECTION, batch_number: 'B-2',
    materials_consumed: true, stock_updated: true, je_posted: true,
    reverted_at: new Date(2026, 7, 20, 8, 0).toISOString(), notes: null,
  },
];

function renderPanel() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ProductionTodayPanel sectionId={SECTION} selectedDate={DAY} />
    </QueryClientProvider>,
  );
}

describe('Production log — la contre-écriture est atteignable', () => {
  beforeEach(() => {
    currentPerms = new Set(['inventory.read', 'inventory.production.delete']);
    resolvers.production_records = () => ({ data: RECORDS, error: null });
    resolvers.products = () => ({
      data: [{ id: 'p-1', name: 'Croissant' }, { id: 'p-2', name: 'Pain au chocolat' }],
      error: null,
    });
  });

  it('rend l\'action sur une ligne non annulée, et pas sur une ligne annulée', async () => {
    renderPanel();
    const action = await screen.findByTestId('revert-production-PRD-0001');
    expect(action).toBeEnabled();
    expect(screen.queryByTestId('revert-production-PRD-0002')).not.toBeInTheDocument();
  });

  it('ouvre le dialogue de contre-écriture, qui annonce ce qu\'il va produire', async () => {
    renderPanel();
    fireEvent.click(await screen.findByTestId('revert-production-PRD-0001'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Revert production PRD-0001');
    expect(dialog).toHaveTextContent(/Stock will be restored and a counter-JE posted/i);
  });

  it('sans inventory.production.delete : DÉSACTIVÉE AVEC SA RAISON, jamais masquée', async () => {
    currentPerms = new Set(['inventory.read']);
    renderPanel();
    const action = await screen.findByTestId('revert-production-PRD-0001');
    // Présente — c'est tout le point : une action absente ne s'explique pas.
    expect(action).toBeDisabled();
    // La raison est lisible à la souris ET par un lecteur d'écran.
    expect(action).toHaveAttribute('title', expect.stringContaining('permission'));
    const describedBy = action.getAttribute('aria-describedby');
    expect(describedBy).not.toBeNull();
    expect(document.getElementById(describedBy ?? '')).toHaveTextContent(/permission/i);
  });

  it('porte le marqueur LOCKED de l\'archétype, avec sa raison et son issue', async () => {
    renderPanel();
    expect(await screen.findByTestId('production-log-locked')).toHaveTextContent(/locked/i);
    // La phrase est découpée par la concaténation : `toHaveTextContent`, jamais
    // `getByText`, qui ne lit que les nœuds texte directs.
    const reason = screen.getByTestId('production-log-lock-reason');
    expect(reason).toHaveTextContent(/cannot be edited/i);
    expect(reason).toHaveTextContent(/only reverted/i);
  });

  it('nomme la ligne annulée au lieu de la faner, et la sort des totaux', async () => {
    renderPanel();
    const row = await screen.findByTestId('production-row-PRD-0002');
    expect(row).toHaveTextContent(/Reverted/i);
    // Pas d'opacité : dans un registre, une contre-passation est un fait.
    expect(row.className).not.toMatch(/opacity-/);
    // Les 12 pièces annulées ne comptent pas dans le total produit.
    expect(screen.getByTestId('kpi-produced')).toHaveTextContent('200');
    await waitFor(() => {
      expect(screen.getByTestId('production-log-reverted-note')).toHaveTextContent(
        /1 reverted batch is excluded/i,
      );
    });
  });
});
