// apps/backoffice/src/features/products/components/StubPanel.tsx
//
// Session 14 / Phase 4.B — Tabs that don't yet have a designed UX (Variants,
// Costing, Purchase, History) render a polished EmptyState with a hint that
// the surface arrives in a future session. Avoids leaving raw "todo" copy
// on user-visible screens.

import { Construction } from 'lucide-react';
import type { JSX } from 'react';
import { EmptyState } from '@breakery/ui';

interface Props {
  title:       string;
  description: string;
}

export function StubPanel({ title, description }: Props): JSX.Element {
  return (
    <EmptyState
      icon={Construction}
      title={title}
      description={description}
      size="lg"
    />
  );
}
