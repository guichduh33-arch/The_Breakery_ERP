// apps/backoffice/src/pages/lan-devices/LanDevicesPage.tsx
// S14 (read-only + KPIs) → 2026-07-06 : + CRUD (form modal), + ScanPanel
// print-bridge (spec 2026-07-06). Route gated lan.devices.read (inchangé) ;
// écritures gated lan.devices.manage.
import { useMemo, useState } from 'react';
import { Wifi, CheckCircle2, AlertTriangle, Printer, Plus } from 'lucide-react';
import { Button, Card, KpiTile, SectionLabel } from '@breakery/ui';
import { useAuthStore } from '@/stores/authStore.js';
import { LanDevicesTable } from '@/features/lan-devices/components/LanDevicesTable.js';
import { ScanPanel } from '@/features/lan-devices/components/ScanPanel.js';
import { LanDeviceFormModal } from '@/features/lan-devices/components/LanDeviceFormModal.js';
import { useLanDevices, type LanDeviceRow } from '@/features/lan-devices/hooks/useLanDevices.js';

export default function LanDevicesPage() {
  const { data } = useLanDevices();
  const canManage = useAuthStore((s) => s.hasPermission('lan.devices.manage'));
  const rows = data ?? [];

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<LanDeviceRow | null>(null);
  const [prefill, setPrefill] = useState<{ ip_address: string; port: number } | null>(null);

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

  function openCreate(): void { setEditing(null); setPrefill(null); setModalOpen(true); }
  function openEdit(device: LanDeviceRow): void { setEditing(device); setPrefill(null); setModalOpen(true); }
  function openFromScan(p: { ip_address: string; port: number }): void {
    setEditing(null); setPrefill(p); setModalOpen(true);
  }

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-serif">LAN Devices</h1>
          <p className="text-sm text-text-secondary">
            Devices participating in the on-site LAN mesh. Status is computed
            from the last heartbeat — devices that haven&apos;t pinged in 60s
            are flagged as stale.
          </p>
        </div>
        {canManage && (
          <Button onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden /> Add device
          </Button>
        )}
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiTile label="Total devices" value={kpis.total}    icon={Wifi}           footer="Registered in the mesh" />
        <KpiTile label="Online"        value={kpis.online}   icon={CheckCircle2}   footer="Heartbeat within 60s" />
        <KpiTile label="Stale"         value={kpis.stale}    icon={AlertTriangle}  footer="No recent heartbeat" />
        <KpiTile label="Printers"      value={kpis.printers} icon={Printer}        footer="ESC/POS printers in mesh" />
      </div>

      {canManage && (
        <Card padding="md" className="space-y-3">
          <SectionLabel size="sm" as="h2">Network scan</SectionLabel>
          <ScanPanel devices={rows} onAdd={openFromScan} />
        </Card>
      )}

      <Card padding="md">
        <LanDevicesTable onEdit={openEdit} />
      </Card>

      <LanDeviceFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        device={editing}
        prefill={prefill}
        allDevices={rows}
      />
    </div>
  );
}
