// apps/backoffice/src/pages/NotFoundPage.tsx
//
// Vraie page 404 — rendue par le catch-all des routes au lieu d'une
// redirection silencieuse vers le tableau de bord. Une URL fautive (lien
// périmé, faute de frappe) doit le DIRE, pas téléporter l'opérateur sans
// explication. Style aligné sur ErrorState / EmptyState (panneau centré,
// icône discrète, CTA de retour).

import { type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@breakery/ui';

export default function NotFoundPage(): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="grid min-h-[60vh] place-items-center px-8 py-16">
      <div className="max-w-sm space-y-4 text-center">
        <Compass className="mx-auto h-10 w-10 text-text-muted" aria-hidden />
        <div className="space-y-1">
          <p className="font-data text-xs uppercase tracking-widest text-text-muted">404</p>
          <h1 className="font-serif text-xl text-text-primary">Page not found</h1>
          <p className="text-sm text-text-secondary">
            The page you&rsquo;re looking for doesn&rsquo;t exist, or it may have moved.
          </p>
        </div>
        <Button variant="ink" onClick={() => { void navigate('/backoffice'); }}>
          Back to Today
        </Button>
      </div>
    </div>
  );
}
