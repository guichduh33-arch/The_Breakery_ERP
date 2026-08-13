// apps/backoffice/src/components/AppErrorBoundary.tsx
//
// Critique /impeccable 2026-08-13 — frontière d'erreur RACINE.
//
// RouteErrorBoundary protège l'intérieur de la coquille (`<Outlet>`), mais tout
// ce qui tombe AVANT elle — le catch-all racine, BootGate, la coquille
// elle-même — démontait l'arbre entier : écran blanc, sans message, sans issue.
// Cette frontière est le dernier filet : elle rend un écran de panne plein
// viewport avec deux sorties (retenter le rendu, recharger l'application).
//
// Elle vit HORS du routeur : pas de useLocation ici, l'état d'erreur se purge
// par le bouton Retry ou par un rechargement complet.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { ErrorState } from './ErrorState.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Le détail technique va à la console, jamais à l'écran (règle ErrorState).
    console.error('[backoffice] app crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <ErrorState
        fullScreen
        title="The app stopped working"
        description="Something went wrong while starting this screen. Your data was not affected — retry, or reload the application."
        onRetry={() => { this.setState({ error: null }); }}
        secondaryAction={{ label: 'Reload', onClick: () => { window.location.reload(); } }}
      />
    );
  }
}
