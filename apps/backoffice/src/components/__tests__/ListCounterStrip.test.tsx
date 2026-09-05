// apps/backoffice/src/components/__tests__/ListCounterStrip.test.tsx
//
// Ce que ces tests verrouillent, et pourquoi.
//
// UNE BANDE QUI NE FILTRE RIEN NE RESSEMBLE PAS À UNE BANDE QUI FILTRE. Sur
// Orders, la bande des statuts (boutons) et la bande d'argent (totaux) rendaient
// le même chrome — même trait, même fond — et seul le curseur les distinguait
// (critique BO du 2026-09-04, P2). La bande informative prend le papier inerte,
// le sol des choses qui se lisent ; la bande de filtres garde le trait de
// contrôle. Le test porte sur les classes, parce que c'est la seule chose que
// jsdom voit d'un fond.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ListCounterStrip } from '@/components/ListCounterStrip.js';

describe('ListCounterStrip — chrome selon la nature de la bande', () => {
  it('une bande dont un compteur filtre porte le chrome de contrôle', () => {
    render(
      <ListCounterStrip
        data-testid="strip"
        counters={[
          { id: 'all', label: 'All', value: 12, onSelect: vi.fn() },
          { id: 'paid', label: 'Paid', value: 9, onSelect: vi.fn() },
        ]}
      />,
    );
    const strip = screen.getByTestId('strip');
    expect(strip.className).toContain('border-border-strong');
    expect(strip.className).toContain('bg-bg-elevated');
    expect(strip).not.toHaveAttribute('data-informative');
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });

  it('une bande dont aucun compteur ne filtre rend sur papier inerte, sans bouton', () => {
    render(
      <ListCounterStrip
        data-testid="strip"
        ariaLabel="Window totals"
        counters={[
          { id: 'total', label: 'Window total', value: 'Rp 1.250.000' },
          { id: 'paid', label: 'Settled', value: 'Rp 1.000.000', tone: 'success' },
        ]}
      />,
    );
    const strip = screen.getByTestId('strip');
    expect(strip.className).toContain('bg-surface-inert');
    expect(strip.className).toContain('border-border-subtle');
    expect(strip.className).not.toContain('border-border-strong');
    expect(strip).toHaveAttribute('data-informative', 'true');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    // Le groupe reste nommé : les totaux se lisent aussi au lecteur d'écran.
    expect(screen.getByRole('group', { name: 'Window totals' })).toBe(strip);
  });

  it('un seul compteur cliquable suffit à faire de la bande un groupe de contrôles', () => {
    render(
      <ListCounterStrip
        data-testid="strip"
        counters={[
          { id: 'all', label: 'All', value: 3, onSelect: vi.fn() },
          { id: 'value', label: 'Value', value: 'Rp 30.000' },
        ]}
      />,
    );
    expect(screen.getByTestId('strip').className).toContain('border-border-strong');
  });
});
