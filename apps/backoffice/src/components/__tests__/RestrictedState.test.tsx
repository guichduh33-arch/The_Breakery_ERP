// apps/backoffice/src/components/__tests__/RestrictedState.test.tsx
//
// Ce que ces tests verrouillent, et pourquoi.
//
// 1. LE CODE DE PERMISSION EST ÉCRIT À L'ÉCRAN. C'est la raison d'être du
//    composant : un « restricted » qui ne nomme pas le droit manquant laisse
//    l'utilisateur sans recours. Six écrans rendaient une phrase du genre
//    « You do not have permission to view this purchase order. » — vraie, et
//    inutilisable : elle ne dit pas quoi demander.
// 2. CE N'EST PAS UNE ERREUR. Pas de `role="alert"` (le test du Dashboard
//    l'exige déjà pour son propre état) et pas d'encre rouge : DESIGN.md § Do's
//    dit « restricted », pas « error ». Un droit manquant n'est pas une panne.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RestrictedState } from '@/components/RestrictedState.js';

describe('RestrictedState', () => {
  it('nomme ce qui est restreint ET la permission qui débloque', () => {
    render(<RestrictedState what="this purchase order" permission="purchasing.po.read" />);
    // `getByText` ne lit que les nœuds texte DIRECTS : le code vit dans un
    // <span className="font-data">, donc on assertionne sur le conteneur.
    const card = screen.getByRole('status');
    expect(card).toHaveTextContent('Access to this purchase order is restricted.');
    expect(card).toHaveTextContent('purchasing.po.read');
    expect(card).toHaveTextContent(/ask an administrator/i);
  });

  it("n'est jamais annoncé comme une erreur", () => {
    const { container } = render(
      <RestrictedState what="dashboard metrics" permission="reports.read" />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Aucune classe d'encre rouge du thème — ni `text-red*`, ni `text-danger*`,
    // ni les fonds correspondants. Le refus reste en gris.
    expect(container.querySelector('[class*="red"]')).toBeNull();
    expect(container.querySelector('[class*="danger"]')).toBeNull();
  });

  // Lot 9 — la variante RÔLE. `AdminGate` n'a pas de code de permission à
  // nommer ; ce qu'il exige est un rôle, et c'est cela qu'il doit écrire.
  describe('variante rôle', () => {
    it('nomme le rôle requis, pas un code de permission', () => {
      render(<RestrictedState what="this page" role="ADMIN" />);
      const card = screen.getByRole('status');
      expect(card).toHaveTextContent('Access to this page is restricted.');
      expect(card).toHaveTextContent('It requires the Admin role.');
      expect(card).toHaveTextContent(/ask an administrator/i);
    });

    // Les rôles sont ALTERNATIFS — un seul suffit —, là où les permissions sont
    // exigées conjointement. « and » ici serait un contresens : personne ne
    // porte deux rôles à la fois.
    it('relie plusieurs rôles par « or » et garde le singulier', () => {
      render(<RestrictedState what="this page" role={['ADMIN', 'SUPER_ADMIN']} />);
      const card = screen.getByRole('status');
      expect(card).toHaveTextContent('It requires the Admin or Super admin role.');
      expect(card).not.toHaveTextContent(' and ');
      expect(card).not.toHaveTextContent('roles.');
    });

    // `SUPER_ADMIN` est un identifiant de base. L'écran des utilisateurs écrit
    // « Super admin » ; c'est ce libellé que l'opérateur doit pouvoir citer.
    it('montre le libellé humain, jamais le code brut', () => {
      const { container } = render(<RestrictedState what="this page" role="SUPER_ADMIN" />);
      expect(screen.getByRole('status')).toHaveTextContent('Super admin');
      expect(container.textContent).not.toContain('SUPER_ADMIN');
    });
  });

  it('accorde la phrase quand plusieurs droits sont exigés conjointement', () => {
    render(
      <RestrictedState
        what="this report"
        permission={['reports.inventory.read', 'reports.financial.read']}
      />,
    );
    const card = screen.getByRole('status');
    expect(card).toHaveTextContent('reports.inventory.read');
    expect(card).toHaveTextContent('reports.financial.read');
    expect(card).toHaveTextContent(/permissions\. Ask an administrator to grant them\./);
  });
});
