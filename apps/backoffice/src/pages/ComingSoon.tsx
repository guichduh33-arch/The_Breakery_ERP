// apps/backoffice/src/pages/ComingSoon.tsx
import { Construction } from 'lucide-react';

export interface ComingSoonProps {
  module: string;
}

export default function ComingSoonPage({ module }: ComingSoonProps) {
  return (
    <div className="h-full grid place-items-center text-text-secondary">
      <div className="text-center space-y-3">
        <Construction className="h-12 w-12 mx-auto opacity-50" aria-hidden />
        <h1 className="font-serif text-2xl text-text-primary">{module}</h1>
        <p className="text-sm">Coming soon — module en cours d'implémentation.</p>
      </div>
    </div>
  );
}
