// apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx
// Session 14 / Phase 6.A — operator view of registered LAN devices, with
// KPI strip (Total / Online / Stale / Printers) wrapped in a Card. Adding
// devices is out-of-scope for this phase (no `register_lan_device_v*` RPC
// yet) — TODO(session-15) to add the inline form.

import { useMemo } from 'react';
import { Wifi, CheckCircle2, AlertTriangle, Printer } from 'lucide-react';
import { Card, KpiTile } from '@breakery/ui';
import { LanDevicesTable } from '@/features/lan-devices/components/LanDevicesTable.js';
import { useLanDevices } from '@/features/lan-devices/hooks/useLanDevices.js';

export default function LanDevicesPage() {
  const { data } = useLanDevices();
  const rows = data ?? [];

  const kpis = useMemo(() => {
    const now = Date.now();
    let online = 0;
    let stale = 0;
    let printers = 0;
    for (const d of rows) {
      const isStale = d.last_heartbeat_at === null
        ? true
        : now - new Date(d.last_heartbeat_at).getTime() > 60_000;
      if (isStale) stale++;
      else online++;
      if (d.device_type === 'printer') printers++;
    }
    return { total: rows.length, online, stale, printers };
  }, [rows]);

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

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Total devices" value={kpis.total}    icon={Wifi}           footer="Registered in the mesh" />
        <KpiTile label="Online"        value={kpis.online}   icon={CheckCircle2}   footer="Heartbeat within 60s" />
        <KpiTile label="Stale"         value={kpis.stale}    icon={AlertTriangle}  footer="No recent heartbeat" />
        <KpiTile label="Printers"      value={kpis.printers} icon={Printer}        footer="ESC/POS printers in mesh" />
      </div>

      <Card padding="md">
        <LanDevicesTable />
      </Card>
    </div>
  );
}
