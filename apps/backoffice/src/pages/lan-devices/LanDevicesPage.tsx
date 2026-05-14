// apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx
// Session 13 / Phase 5.A — operator view of registered LAN devices.

import { LanDevicesTable } from '@/features/lan-devices/components/LanDevicesTable.js';

export default function LanDevicesPage() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-serif">LAN Devices</h1>
        <p className="text-sm text-text-secondary">
          Devices participating in the on-site LAN mesh. Status is computed
          from the last heartbeat — devices that haven&apos;t pinged in 60s
          are flagged as stale.
        </p>
      </header>
      <LanDevicesTable />
    </div>
  );
}
