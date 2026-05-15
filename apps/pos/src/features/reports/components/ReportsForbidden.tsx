// apps/pos/src/features/reports/components/ReportsForbidden.tsx
//
// Session 14 — Phase 2.D — Permission-denied splash for the POS reports
// surfaces. Uses the canonical EmptyState primitive so it looks intentional
// instead of broken.

import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert } from 'lucide-react';
import { Button, EmptyState } from '@breakery/ui';

export function ReportsForbidden(): JSX.Element {
  const navigate = useNavigate();
  return (
    <div className="h-screen grid place-items-center bg-bg-base text-text-primary p-6">
      <div className="max-w-md w-full">
        <EmptyState
          icon={ShieldAlert}
          title="Reports are restricted"
          description="You do not have the reports.sales.read permission. Ask the manager to grant access."
          size="lg"
        />
        <div className="mt-6 flex justify-center">
          <Button variant="secondary" onClick={() => navigate('/pos')}>
            Back to POS
          </Button>
        </div>
      </div>
    </div>
  );
}
