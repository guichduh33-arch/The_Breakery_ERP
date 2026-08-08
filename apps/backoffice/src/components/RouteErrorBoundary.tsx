// apps/backoffice/src/components/RouteErrorBoundary.tsx
//
// Audit /impeccable 2026-08-08 — il n'existait AUCUNE frontière d'erreur dans
// le monorepo. Une exception de rendu dans n'importe laquelle des ~90 pages
// démontait tout l'arbre React : l'opérateur se retrouvait devant un écran
// blanc, sans message, sans barre de navigation, sans moyen de repartir.
//
// `errorElement` de react-router n'est pas disponible ici : l'application
// monte un `<Routes>` déclaratif, pas un `createBrowserRouter`. La frontière
// est donc une classe React classique — la seule API qui intercepte une
// exception de rendu.
//
// Elle est montée AUTOUR de l'`<Outlet>`, pas autour de l'application : la
// barre de navigation et la palette de commandes survivent à la page qui
// tombe, si bien qu'on peut aller ailleurs sans recharger.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { ErrorState } from './ErrorState.js';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

class ErrorBoundaryInner extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Le détail technique va à la console, jamais à l'écran : ErrorState
    // demande explicitement de garder la copie utilisateur non technique.
    console.error('[backoffice] page crashed', error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error === null) return this.props.children;
    return (
      <ErrorState
        title="This page stopped working"
        description="Something went wrong while rendering this screen. Your data was not affected — retry, or use the navigation bar to go somewhere else."
        onRetry={() => { this.setState({ error: null }); }}
      />
    );
  }
}

/**
 * Remonte la frontière à chaque changement de route : sans cette clé, une page
 * tombée laisse l'état d'erreur en place et la destination suivante s'affiche
 * elle aussi en panne.
 */
export function RouteErrorBoundary({ children }: Props) {
  const { pathname } = useLocation();
  return <ErrorBoundaryInner key={pathname}>{children}</ErrorBoundaryInner>;
}
