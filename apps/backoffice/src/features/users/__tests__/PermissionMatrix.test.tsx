// apps/backoffice/src/features/users/__tests__/PermissionMatrix.test.tsx
//
// La matrice est une grille de cellules réduites à un signe. Ces tests figent ce
// qui la rend LISIBLE, pas sa mise en page :
//   - le signe « non accordé » porte le token réservé au non-texte, pas celui du
//     désactivé : `text-text-disabled` valait 1,90:1 sur le papier, sous les 3:1
//     des objets graphiques, alors qu'il porte TOUTE l'information de la cellule ;
//   - les en-têtes sont des en-têtes (`scope`), sinon un lecteur d'écran annonce
//     « granted » sans dire de quoi ni pour qui ;
//   - la légende existe et ne nomme QUE les deux états que la grille calcule ;
//   - la réserve sur les exceptions par personne est dite, parce que la vue ne
//     lit pas `user_permission_overrides`.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PermissionMatrix } from '@/features/users/components/PermissionMatrix.js';
import type * as MatrixModule from '@/features/users/hooks/usePermissionMatrix.js';
import type { PermissionMatrix as MatrixData } from '@/features/users/hooks/usePermissionMatrix.js';

// Le séparateur de clé du hook est un U+0001 (SOH). On l'écrit par son code
// plutôt qu'en littéral : un caractère de contrôle invisible dans un source est
// le genre de détail qu'une relecture prend pour une absence.
const SEP = String.fromCharCode(1);

function makeData(): MatrixData {
  return {
    roles: [
      { code: 'ADMIN',   name: 'Admin',   description: 'Full access', is_system: true },
      { code: 'CASHIER', name: 'Cashier', description: null,          is_system: true },
    ],
    permissions: [
      { code: 'accounting.gl.read', module: 'accounting', action: 'read',  description: 'Read General Ledger' },
      { code: 'orders.refund',      module: 'orders',     action: 'refund', description: null },
    ],
    // ADMIN a tout, CASHIER n'a rien : une ligne de chaque côté du signe.
    grants: new Set<string>([
      `ADMIN${SEP}accounting.gl.read`,
      `ADMIN${SEP}orders.refund`,
    ]),
  };
}

let data: MatrixData | undefined = makeData();
let isLoading = false;
let error: Error | null = null;

vi.mock('@/features/users/hooks/usePermissionMatrix.js', async (importOriginal) => {
  // `isGranted` doit rester la vraie : c'est elle qui décide de chaque cellule.
  const actual = await importOriginal<typeof MatrixModule>();
  return {
    ...actual,
    usePermissionMatrix: () => ({ data, isLoading, error }),
  };
});

describe('PermissionMatrix — lisibilité de la grille', () => {
  beforeEach(() => {
    data = makeData();
    isLoading = false;
    error = null;
  });

  it('le signe « non accordé » ne prend pas le token du désactivé', () => {
    render(<PermissionMatrix />);

    const denied = screen.getAllByLabelText('denied');
    expect(denied.length).toBe(2); // les 2 permissions × CASHIER

    for (const glyph of denied) {
      // `text-text-disabled` = 1,90:1 sur le papier : le glyphe porte toute
      // l'information de la cellule, il tient les 3:1 de WCAG 1.4.11 ou rien.
      expect(glyph.getAttribute('class')).not.toContain('text-text-disabled');
      expect(glyph.getAttribute('class')).toContain('text-text-subtle');
    }
  });

  it('les deux axes de la grille sont des en-têtes déclarés', () => {
    render(<PermissionMatrix />);

    const cols = screen.getAllByRole('columnheader');
    expect(cols.length).toBe(3); // « Permission » + 2 rôles
    for (const th of cols) expect(th.getAttribute('scope')).toBe('col');

    const rows = screen.getAllByRole('rowheader');
    expect(rows.length).toBe(2); // 2 permissions
    for (const th of rows) expect(th.getAttribute('scope')).toBe('row');
  });

  it('nomme les rôles par leur `name`, pas par le code brut de la table', () => {
    render(<PermissionMatrix />);

    const cols = screen.getAllByRole('columnheader');
    // cols[0] est « Permission » ; les suivantes sont les rôles.
    expect(cols[1]).toHaveTextContent('Admin');
    expect(cols[1]).not.toHaveTextContent('ADMIN');
    expect(cols[2]).toHaveTextContent('Cashier');
    expect(cols[2]).not.toHaveTextContent('CASHIER');
  });

  it('rend une légende qui nomme les deux états, et seulement eux', () => {
    render(<PermissionMatrix />);

    const legend = screen.getByTestId('matrix-legend');
    expect(legend).toBeInTheDocument();
    expect(legend).toHaveTextContent(/granted to the role/i);
    expect(legend).toHaveTextContent(/not granted/i);

    // Aucun état « hérité » n'est calculé par cette vue : l'annoncer serait un
    // mensonge d'interface.
    expect(legend).not.toHaveTextContent(/inherit/i);
  });

  it('dit que les exceptions par personne ne sont pas dans la vue', () => {
    render(<PermissionMatrix />);
    expect(screen.getByText(/not reflected here/i)).toBeInTheDocument();
  });

  it('le champ de filtre filtre réellement les lignes', () => {
    render(<PermissionMatrix />);
    expect(screen.getAllByRole('rowheader').length).toBe(2);

    fireEvent.change(screen.getByLabelText('Filter permissions'), {
      target: { value: 'refund' },
    });

    const rows = screen.getAllByRole('rowheader');
    expect(rows.length).toBe(1);
    expect(rows[0]).toHaveTextContent('orders.refund');
  });

  it('la table se nomme pour un lecteur d\'écran', () => {
    render(<PermissionMatrix />);
    // `caption` porte le rôle implicite `caption`, non exposé par testing-library :
    // on l'atteint par son texte.
    expect(screen.getByText(/rows are permissions, columns are roles/i)).toBeInTheDocument();
  });
});
