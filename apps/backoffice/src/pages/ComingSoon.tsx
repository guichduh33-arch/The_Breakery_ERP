// apps/backoffice/src/pages/ComingSoon.tsx
import { Construction } from 'lucide-react';
import { PAGE_TITLE_CLS } from '@/components/PageHeader.js';

export interface ComingSoonProps {
  module: string;
}

export default function ComingSoonPage({ module }: ComingSoonProps) {
  return (
    <div className="h-full grid place-items-center text-text-secondary">
      <div className="text-center space-y-3">
        <Construction className="h-12 w-12 mx-auto opacity-50" aria-hidden />
        <h1 className={PAGE_TITLE_CLS}>{module}</h1>
        <p className="text-sm">Coming soon — this module is not built yet.</p>
      </div>
    </div>
  );
}
