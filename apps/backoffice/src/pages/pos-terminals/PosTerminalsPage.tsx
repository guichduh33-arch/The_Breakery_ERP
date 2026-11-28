// apps/backoffice/src/pages/pos-terminals/PosTerminalsPage.tsx
// Nommer les terminaux POS. Sans nom, le journal d'activité affiche chaque
// appareil sous « Unregistered pd_xxxxx » et on ne sait pas lequel est la
// caisse ou quelle tablette. Route gardée `reports.audit.read`, la permission
// qu'exige déjà `register_pos_device_v1`.
import { Card } from '@/components/BackofficeUi.js';
import { PageHeader } from '@/components/PageHeader.js';
import { PosTerminalsTable } from '@/features/pos-terminals/components/PosTerminalsTable.js';

export default function PosTerminalsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        className="items-start"
        title="POS terminals"
        subtitle="Tills and tablets that report to the activity log. Give each one a name so the log shows which device did what. Use “Last used by” to tell devices apart."
      />
      <Card padding="md">
        <PosTerminalsTable />
      </Card>
    </div>
  );
}
