// apps/pos/src/features/tables/__tests__/tableActivity.test.tsx
//
// Lot B de l'audit POS Waiter du 2026-08-22 — une table payée redevient libre.
//
// Le défaut d'origine : `useTableOccupancy` et `useTableOrders` excluaient
// `completed` et `voided`, alors que le paiement pose `paid`. Une table payée
// restait occupée pour toujours. Mesuré sur la base V3 dev : 3 tables sur 11.
//
// Ce test tient les deux bouts :
//   1. `paid` appartient bien aux statuts qui libèrent ;
//   2. les DEUX hooks envoient réellement ce filtre à PostgREST.
//
// Le point (2) est celui qui compte. Une constante juste que personne n'utilise
// ne libère aucune table — c'est exactement le défaut d'origine, où la bonne
// règle vivait dans `idx_orders_active_table` pendant que le code en appliquait
// une autre.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

/** Capture chaque appel `.not(colonne, opérateur, valeur)` de la chaîne. */
const notSpy = vi.fn();

vi.mock('@/lib/supabase', () => {
  const okResult = Promise.resolve({ data: [], error: null });
  const queryChain = {
    select: () => queryChain,
    order: () => queryChain,
    not: (col: string, op: string, value: unknown) => {
      notSpy(col, op, value);
      return queryChain;
    },
    then: (...args: unknown[]) =>
      okResult.then(...(args as Parameters<typeof okResult.then>)),
  };
  return {
    supabase: {
      from: () => queryChain,
      channel: () => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() }),
      removeChannel: vi.fn(),
    },
  };
});

import { TABLE_RELEASING_STATUSES, TABLE_RELEASING_STATUSES_FILTER } from '../tableActivity';
import { useTableOccupancy } from '../hooks/useTableOccupancy';
import { useTableOrders } from '../hooks/useTableOrders';

function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return createElement(QueryClientProvider, { client: qc }, children);
}

/** L'argument `value` du `.not('status', 'in', …)`, ou undefined s'il manque. */
function capturedStatusFilter(): unknown {
  return notSpy.mock.calls.find((c) => c[0] === 'status' && c[1] === 'in')?.[2];
}

describe('libération des tables — statuts qui rendent une table libre', () => {
  beforeEach(() => {
    notSpy.mockClear();
  });

  it('`paid` libère la table — le paiement pose ce statut, pas `completed`', () => {
    expect(TABLE_RELEASING_STATUSES).toContain('paid');
    expect(TABLE_RELEASING_STATUSES).toContain('completed');
    expect(TABLE_RELEASING_STATUSES).toContain('voided');
  });

  it('une commande encore due n’est PAS libérée', () => {
    expect(TABLE_RELEASING_STATUSES).not.toContain('pending_payment');
    expect(TABLE_RELEASING_STATUSES).not.toContain('draft');
  });

  it('le filtre est au format de liste attendu par PostgREST', () => {
    expect(TABLE_RELEASING_STATUSES_FILTER).toBe('(completed,voided,paid)');
  });

  it('useTableOccupancy envoie ce filtre exact à PostgREST', async () => {
    renderHook(() => useTableOccupancy(), { wrapper });
    await waitFor(() => {
      expect(capturedStatusFilter()).toBe(TABLE_RELEASING_STATUSES_FILTER);
    });
  });

  it('useTableOrders envoie le MÊME filtre — les deux ne peuvent plus diverger', async () => {
    renderHook(() => useTableOrders(), { wrapper });
    await waitFor(() => {
      expect(capturedStatusFilter()).toBe(TABLE_RELEASING_STATUSES_FILTER);
    });
  });
});
